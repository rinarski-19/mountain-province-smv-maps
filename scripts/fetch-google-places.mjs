#!/usr/bin/env node
// Fetch richer POIs from Google Places API (New) and write them into the
// same basemap landmark overlay the app already renders:
//
//   public/data/<slug>_landmarks.geojson
//
// This is intentionally separate from *_custom_landmarks.geojson. Custom
// landmarks are LGU/editor-authored pins; this file is refreshable reference
// data from Google Places so it can be regenerated.
//
// Usage:
//   node scripts/fetch-google-places.mjs besao
//   node scripts/fetch-google-places.mjs besao --barangay "Kin-iway"
//   npm run landmarks:google -- besao
//
// Requires one of:
//   GOOGLE_MAPS_API_KEY
//   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
//
// The key must have Places API (New) enabled.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";
import { getMunicipalityConfig } from "../lib/municipalities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MAX_NEARBY_RADIUS_M = 50000;
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.iconMaskBaseUri",
  "places.iconBackgroundColor",
].join(",");

const CATEGORY_QUERIES = [
  {
    label: "public-services",
    types: [
      "hospital",
      "doctor",
      "dentist",
      "pharmacy",
      "school",
      "primary_school",
      "secondary_school",
      "university",
      "church",
      "local_government_office",
      "government_office",
      "city_hall",
      "police",
      "fire_station",
      "post_office",
      "library",
      "courthouse",
    ],
  },
  {
    label: "food",
    types: [
      "restaurant",
      "cafe",
      "bakery",
      "bar",
      "meal_takeaway",
      "meal_delivery",
    ],
  },
  {
    label: "shops",
    types: [
      "store",
      "convenience_store",
      "food_store",
      "general_store",
      "grocery_store",
      "supermarket",
      "shopping_mall",
      "department_store",
      "hardware_store",
      "electronics_store",
      "clothing_store",
      "home_goods_store",
      "furniture_store",
      "shoe_store",
      "book_store",
      "drugstore",
    ],
  },
  {
    label: "services",
    types: [
      "bank",
      "atm",
      "gas_station",
      "parking",
      "bus_station",
      "transit_station",
      "taxi_stand",
      "lodging",
      "hotel",
      "travel_agency",
      "real_estate_agency",
      "insurance_agency",
    ],
  },
  {
    label: "recreation-tourism",
    types: [
      "tourist_attraction",
      "museum",
      "park",
      "campground",
      "sports_activity_location",
      "sports_club",
      "stadium",
      "gym",
      "cemetery",
    ],
  },
];

const TEXT_SWEEP_QUERIES = [
  "water refilling station",
  "studio",
  "store",
  "restaurant",
  "eatery",
  "government office",
  "police station",
  "fire station",
  "basketball court",
  "school",
  "church",
];

const KIND_BY_TYPE = {
  hospital: "hospital",
  doctor: "clinic",
  dentist: "clinic",
  pharmacy: "clinic",
  drugstore: "clinic",
  school: "school",
  primary_school: "school",
  secondary_school: "school",
  university: "school",
  church: "worship",
  local_government_office: "govt",
  government_office: "govt",
  city_hall: "govt",
  police: "govt",
  fire_station: "govt",
  post_office: "govt",
  library: "govt",
  courthouse: "govt",
  supermarket: "market",
  food_store: "market",
  general_store: "market",
  grocery_store: "market",
  convenience_store: "market",
  gas_station: "transport",
  bus_station: "transport",
  transit_station: "transport",
  taxi_stand: "transport",
  parking: "transport",
  tourist_attraction: "tourism",
  museum: "tourism",
  park: "tourism",
  campground: "tourism",
  sports_activity_location: "tourism",
  sports_club: "tourism",
  lodging: "tourism",
  hotel: "tourism",
};

const KIND_LABELS = {
  business: "Business",
  govt: "Government",
  hospital: "Hospital",
  clinic: "Clinic",
  school: "School",
  worship: "Worship",
  market: "Market",
  tourism: "Tourism",
  transport: "Transport",
};

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      if (process.env[key]) continue;
      let value = line.slice(idx + 1).trim();
      value = value.replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

function usage() {
  console.log(`Usage:
  node scripts/fetch-google-places.mjs <municipality-slug> [--barangay <name-or-slug>] [--rank popularity|distance|both] [--text-sweep] [--dry-run]

Examples:
  npm run landmarks:google -- besao
  npm run landmarks:google -- besao --barangay "Kin-iway"
  npm run landmarks:google -- besao --rank popularity
  npm run landmarks:google -- besao --text-sweep

Output:
  public/data/<slug>_landmarks.geojson`);
}

function parseArgs(argv) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const slug = (args.shift() || "").trim().toLowerCase();
  const out = {
    slug,
    barangay: null,
    dryRun: false,
    rank: "both",
    textSweep: false,
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--barangay" || arg === "-b") {
      out.barangay = args.shift() || "";
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--text-sweep") {
      out.textSweep = true;
    } else if (arg === "--rank") {
      out.rank = String(args.shift() || "").toLowerCase();
      if (!["popularity", "distance", "both"].includes(out.rank)) {
        throw new Error("--rank must be popularity, distance, or both");
      }
    } else if (arg === "--fast") {
      out.rank = "popularity";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function readFeatureCollection(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. Run boundaries fetch first.`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error(`${file} is not a GeoJSON FeatureCollection.`);
  }
  return data;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function searchAreaForFeature(feature, label) {
  const [west, south, east, north] = turf.bbox(feature);
  const center = {
    longitude: (west + east) / 2,
    latitude: (south + north) / 2,
  };
  const diagonalKm = turf.distance([west, south], [east, north], {
    units: "kilometers",
  });
  const radius = Math.min(
    MAX_NEARBY_RADIUS_M,
    Math.max(250, Math.ceil((diagonalKm * 1000 * 0.58) / 100) * 100)
  );
  return { label, center, radius, feature };
}

function kindForPlace(place) {
  const types = [place.primaryType, ...(place.types || [])].filter(Boolean);
  for (const type of types) {
    if (KIND_BY_TYPE[type]) return KIND_BY_TYPE[type];
  }
  return "business";
}

function normalizedPlaceName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function placeQualityScore(feature) {
  const props = feature?.properties || {};
  let score = Number(props.user_rating_count || 0);
  if (props.kind && props.kind !== "business") score += 200;
  if (props.google_primary_type) score += 50;
  if (Array.isArray(props.google_types) && props.google_types.includes("point_of_interest")) {
    score += 20;
  }
  if (Array.isArray(props.google_types) && props.google_types.includes("street_address")) {
    score -= 100;
  }
  return score;
}

function barangayForPoint(point, barangays) {
  for (const barangay of barangays) {
    try {
      if (turf.booleanPointInPolygon(point, barangay.feature)) {
        return barangay;
      }
    } catch {}
  }
  return null;
}

async function searchNearby({ apiKey, area, query, rankPreference }) {
  const body = {
    includedTypes: query.types,
    maxResultCount: 20,
    rankPreference,
    locationRestriction: {
      circle: {
        center: {
          latitude: area.center.latitude,
          longitude: area.center.longitude,
        },
        radius: area.radius,
      },
    },
  };
  const response = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Places ${response.status} for ${area.label}/${query.label}: ${text.slice(0, 500)}`
    );
  }
  const json = await response.json();
  return Array.isArray(json.places) ? json.places : [];
}

async function searchText({ apiKey, area, textQuery, municipality }) {
  const body = {
    textQuery: `${textQuery} in ${area.label}, ${municipality.name}, Mountain Province, Philippines`,
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: {
          latitude: area.center.latitude,
          longitude: area.center.longitude,
        },
        radius: area.radius,
      },
    },
  };
  const response = await fetch(PLACES_TEXT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Places Text Search ${response.status} for ${area.label}/${textQuery}: ${text.slice(0, 500)}`
    );
  }
  const json = await response.json();
  return Array.isArray(json.places) ? json.places : [];
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.slug) {
    usage();
    process.exit(1);
  }

  const municipality = getMunicipalityConfig(args.slug);
  if (!municipality || municipality.slug !== args.slug) {
    throw new Error(`Unknown municipality slug: ${args.slug}`);
  }

  const outlineFile = path.join(
    PUBLIC_DATA,
    path.basename(municipality.dataFiles?.outline || `/data/${args.slug}.geojson`)
  );
  const barangaysFile = path.join(
    PUBLIC_DATA,
    path.basename(
      municipality.dataFiles?.barangays || `/data/${args.slug}_barangays.geojson`
    )
  );
  const outline = readFeatureCollection(outlineFile).features?.[0];
  const barangaysFC = readFeatureCollection(barangaysFile);
  if (!outline) throw new Error(`No outline feature in ${outlineFile}.`);

  const barangays = barangaysFC.features.map((feature) => ({
    feature,
    name: feature.properties?.name || "",
    slug:
      municipality.schedule?.slugForName?.(feature.properties?.name || "") ||
      slugify(feature.properties?.name || ""),
  }));

  let areas;
  if (args.barangay) {
    const wanted = slugify(args.barangay);
    const match = barangays.find(
      (b) => b.slug === wanted || slugify(b.name) === wanted
    );
    if (!match) {
      throw new Error(
        `Unknown barangay "${args.barangay}". Known: ${barangays.map((b) => b.name).join(", ")}`
      );
    }
    areas = [searchAreaForFeature(match.feature, match.name)];
  } else {
    areas = barangays.map((b) => searchAreaForFeature(b.feature, b.name));
  }

  const rankPreferences =
    args.rank === "both"
      ? ["POPULARITY", "DISTANCE"]
      : [args.rank.toUpperCase()];
  const nearbyRequestCount =
    areas.length * CATEGORY_QUERIES.length * rankPreferences.length;
  const textRequestCount = args.textSweep
    ? areas.length * TEXT_SWEEP_QUERIES.length
    : 0;
  const requestCount = nearbyRequestCount + textRequestCount;
  console.log(
    `Google Places fetch for ${municipality.name}: ${nearbyRequestCount} Nearby Search request(s)` +
      (textRequestCount ? ` + ${textRequestCount} Text Search request(s)` : "") +
      ` = ${requestCount} total request(s).`
  );
  if (args.dryRun) {
    for (const area of areas) {
      console.log(
        `  ${area.label}: ${area.center.latitude.toFixed(6)}, ${area.center.longitude.toFixed(6)} radius ${area.radius}m`
      );
    }
    return;
  }

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Places API (New) must be enabled for the key."
    );
  }

  const byId = new Map();
  let rawCount = 0;
  let textRawCount = 0;

  const addPlace = (place) => {
    const location = place.location;
    if (!location || location.latitude == null || location.longitude == null) return;
    const point = turf.point([location.longitude, location.latitude]);
    if (!turf.booleanPointInPolygon(point, outline)) return;
    const barangay = barangayForPoint(point, barangays);
    const kind = kindForPlace(place);
    const primaryTypeLabel =
      place.primaryTypeDisplayName?.text || place.primaryType || null;
    const name = place.displayName?.text?.trim();
    if (!name) return;
    const id =
      place.id ||
      `${name}:${location.longitude.toFixed(6)},${location.latitude.toFixed(6)}`;
    if (byId.has(id)) return;
    const feature = {
      type: "Feature",
      properties: {
        name,
        kind,
        kind_label: KIND_LABELS[kind] || "Business",
        source: "google_places",
        google_place_id: place.id || null,
        google_primary_type: place.primaryType || null,
        google_primary_type_label: primaryTypeLabel,
        google_types: place.types || [],
        google_maps_uri: place.googleMapsUri || null,
        google_icon_mask_base_uri: place.iconMaskBaseUri || null,
        google_icon_background_color: place.iconBackgroundColor || null,
        formatted_address: place.formattedAddress || null,
        business_status: place.businessStatus || null,
        rating: place.rating ?? null,
        user_rating_count: place.userRatingCount ?? null,
        barangay_slug: barangay?.slug ?? null,
        barangay_name: barangay?.name ?? null,
      },
      geometry: {
        type: "Point",
        coordinates: [location.longitude, location.latitude],
      },
    };

    const normalizedName = normalizedPlaceName(name);
    for (const [existingId, existing] of byId.entries()) {
      if (normalizedPlaceName(existing.properties?.name) !== normalizedName) continue;
      const distanceMeters = turf.distance(
        feature.geometry.coordinates,
        existing.geometry.coordinates,
        { units: "kilometers" }
      ) * 1000;
      if (distanceMeters > 60) continue;
      if (placeQualityScore(feature) > placeQualityScore(existing)) {
        byId.delete(existingId);
        byId.set(id, feature);
      }
      return;
    }

    byId.set(id, feature);
  };

  for (const area of areas) {
    for (const query of CATEGORY_QUERIES) {
      for (const rankPreference of rankPreferences) {
        console.log(`Fetching ${area.label} / ${query.label} / ${rankPreference}…`);
        const places = await searchNearby({ apiKey, area, query, rankPreference });
        rawCount += places.length;
        for (const place of places) {
          addPlace(place);
        }
      }
    }
  }

  if (args.textSweep) {
    for (const area of areas) {
      for (const textQuery of TEXT_SWEEP_QUERIES) {
        console.log(`Text searching ${area.label} / ${textQuery}…`);
        const places = await searchText({ apiKey, area, textQuery, municipality });
        textRawCount += places.length;
        for (const place of places) {
          addPlace(place);
        }
      }
    }
  }

  const features = [...byId.values()].sort((a, b) => {
    const brgyA = a.properties.barangay_name || "";
    const brgyB = b.properties.barangay_name || "";
    return (
      brgyA.localeCompare(brgyB) ||
      a.properties.kind.localeCompare(b.properties.kind) ||
      a.properties.name.localeCompare(b.properties.name)
    );
  });

  const outPath = path.join(PUBLIC_DATA, `${args.slug}_landmarks.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features }) + "\n",
    "utf8"
  );

  const byKind = {};
  for (const feature of features) {
    byKind[feature.properties.kind] = (byKind[feature.properties.kind] || 0) + 1;
  }
  console.log(
      `\nWrote ${outPath}\n` +
      `  raw Nearby Search results: ${rawCount}\n` +
      (args.textSweep ? `  raw Text Search results: ${textRawCount}\n` : "") +
      `  unique in municipality: ${features.length}\n` +
      `  file size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`
  );
  for (const [kind, count] of Object.entries(byKind).sort()) {
    console.log(`  ${kind.padEnd(10)} ${count}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
