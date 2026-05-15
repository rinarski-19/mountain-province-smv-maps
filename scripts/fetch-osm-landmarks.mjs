#!/usr/bin/env node
// Fetch named landmarks (hospitals, schools, churches, town halls,
// markets, etc.) from OpenStreetMap inside a municipality and write
// them as a Point FeatureCollection at public/data/<m>_landmarks.geojson.
//
// Each output Feature is a Point with:
//   - name           : OSM name tag (always present — we filter unnamed)
//   - kind           : normalised landmark type (see KIND_LABELS below)
//   - osm_id         : "node/123" or "way/456"
//   - barangay_slug  : which barangay it falls in (best-effort)
//   - barangay_name  : human-readable barangay name
//
// The LeafletMap component renders these on the labels-pane so their
// names always sit ABOVE the SMV polygon fills — fixing the issue
// where a C-1 hatch buries "Luis Hora Memorial Hospital".
//
// Usage:
//   node scripts/fetch-osm-landmarks.mjs bauko
//   node scripts/fetch-osm-landmarks.mjs bontoc
//   ...

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "mountain-province-smv-app/1.0 (landmarks fetcher; LGU consultation use)";

// Per-municipality wiring — matches fetch-osm-roads.mjs.
const MUNICIPALITY_CONFIG = {
  bauko: { module: "../lib/bauko.js", slugFnExport: "slugForName" },
  barlig: { module: "../lib/barlig.js", slugFnExport: "slugForBarligName" },
  tadian: { module: "../lib/tadian.js", slugFnExport: "slugForTadianName" },
  sagada: { module: "../lib/sagada.js", slugFnExport: "slugForSagadaName" },
  bontoc: { module: "../lib/bontoc.js", slugFnExport: "slugForBontocName" },
};

// OSM tag → normalised "kind" + display label. Anything not in this map
// is dropped. Kept tight on purpose: civic + religious + commercial
// landmarks people use for wayfinding, no convenience POIs (kiosks,
// petrol stations, ATMs) which would clutter the map.
const KIND_BY_TAG = {
  // amenity=*
  hospital: { kind: "hospital", label: "Hospital" },
  clinic: { kind: "clinic", label: "Clinic" },
  school: { kind: "school", label: "School" },
  university: { kind: "school", label: "University" },
  college: { kind: "school", label: "College" },
  kindergarten: { kind: "school", label: "Kindergarten" },
  place_of_worship: { kind: "worship", label: "Church" },
  townhall: { kind: "govt", label: "Town hall" },
  fire_station: { kind: "govt", label: "Fire station" },
  police: { kind: "govt", label: "Police" },
  library: { kind: "govt", label: "Library" },
  post_office: { kind: "govt", label: "Post office" },
  marketplace: { kind: "market", label: "Market" },
  // shop=*
  supermarket: { kind: "market", label: "Supermarket" },
  // tourism=*
  museum: { kind: "tourism", label: "Museum" },
  attraction: { kind: "tourism", label: "Attraction" },
  // historic=*
  monument: { kind: "tourism", label: "Monument" },
  memorial: { kind: "tourism", label: "Memorial" },
  // building=*
  government: { kind: "govt", label: "Government building" },
  // amenity=community_centre
  community_centre: { kind: "govt", label: "Community center" },
};

// Allow-list of which OSM tags carry which keys we look for.
const QUERY_TAGS = [
  ["amenity", ["hospital", "clinic", "school", "university", "college",
    "kindergarten", "place_of_worship", "townhall", "fire_station", "police",
    "library", "post_office", "marketplace", "community_centre"]],
  ["shop", ["supermarket"]],
  ["tourism", ["museum", "attraction"]],
  ["historic", ["monument", "memorial"]],
  ["building", ["government"]],
];

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  const cfg = MUNICIPALITY_CONFIG[slug];
  if (!cfg) {
    console.error(
      `Unknown municipality slug: ${slug || "(missing)"}\n` +
        `Known: ${Object.keys(MUNICIPALITY_CONFIG).join(", ")}`
    );
    process.exit(1);
  }

  const lib = await import(cfg.module);
  const slugForName = lib[cfg.slugFnExport];
  if (typeof slugForName !== "function") {
    throw new Error(`lib module ${cfg.module} missing ${cfg.slugFnExport}.`);
  }

  const outlinePath = path.join(PUBLIC_DATA, `${slug}.geojson`);
  const barangaysPath = path.join(PUBLIC_DATA, `${slug}_barangays.geojson`);
  for (const p of [outlinePath, barangaysPath]) {
    if (!fs.existsSync(p)) {
      console.error(
        `Missing ${p}. Run \`npm run boundaries:fetch:${slug}\` first.`
      );
      process.exit(1);
    }
  }
  const outlineFeature = JSON.parse(fs.readFileSync(outlinePath, "utf8"))
    .features?.[0];
  const barangaysFC = JSON.parse(fs.readFileSync(barangaysPath, "utf8"));

  const barangaysWithSlugs = barangaysFC.features
    .map((feat) => {
      const name = feat.properties?.name;
      const s = name ? slugForName(name) : null;
      return s ? { feature: feat, slug: s, name } : null;
    })
    .filter(Boolean);
  console.log(`Loaded ${barangaysWithSlugs.length} barangay polygons.`);

  // Build the Overpass query — one block per (key, value) pair, joined.
  const [west, south, east, north] = turf.bbox(outlineFeature);
  const tagBlocks = [];
  for (const [key, values] of QUERY_TAGS) {
    for (const v of values) {
      tagBlocks.push(`node["${key}"="${v}"](${south},${west},${north},${east});`);
      tagBlocks.push(`way["${key}"="${v}"](${south},${west},${north},${east});`);
      tagBlocks.push(`relation["${key}"="${v}"](${south},${west},${north},${east});`);
    }
  }
  const overpassQuery =
    `[out:json][timeout:90];\n(\n${tagBlocks.join("\n")}\n);\nout center tags;`;

  console.log("Querying Overpass for landmarks…");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "data=" + encodeURIComponent(overpassQuery),
  });
  if (!res.ok) {
    throw new Error(`Overpass returned ${res.status} ${res.statusText}`);
  }
  const overpass = await res.json();
  const elements = overpass.elements || [];
  console.log(`Got ${elements.length} raw OSM elements.`);

  const features = [];
  let dropUnnamed = 0;
  let dropUnclassified = 0;
  let dropOutsideMuni = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    if (!tags.name) {
      dropUnnamed += 1;
      continue;
    }
    // Find the most specific matching kind.
    let kindRow = null;
    for (const [key, values] of QUERY_TAGS) {
      const v = tags[key];
      if (v && values.includes(v) && KIND_BY_TAG[v]) {
        kindRow = KIND_BY_TAG[v];
        break;
      }
    }
    if (!kindRow) {
      dropUnclassified += 1;
      continue;
    }
    // Get a representative point. Nodes have lat/lon directly; ways/
    // relations have a `center` from `out center` we can use.
    let lat, lon;
    if (el.type === "node") {
      lat = el.lat;
      lon = el.lon;
    } else if (el.center) {
      lat = el.center.lat;
      lon = el.center.lon;
    }
    if (lat == null || lon == null) continue;
    const pt = turf.point([lon, lat]);
    if (!turf.booleanPointInPolygon(pt, outlineFeature)) {
      dropOutsideMuni += 1;
      continue;
    }
    // Best-effort barangay assignment — first matching containment wins.
    let brgy = null;
    for (const b of barangaysWithSlugs) {
      try {
        if (turf.booleanPointInPolygon(pt, b.feature)) {
          brgy = b;
          break;
        }
      } catch {}
    }
    features.push({
      type: "Feature",
      properties: {
        name: tags.name,
        kind: kindRow.kind,
        kind_label: kindRow.label,
        osm_id: `${el.type}/${el.id}`,
        barangay_slug: brgy?.slug ?? null,
        barangay_name: brgy?.name ?? null,
      },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }

  // Deduplicate — Overpass returns the same place for both `node` and
  // `way` queries when an OSM editor mapped both. Prefer `way` over
  // `node` (way has bigger physical footprint = more accurate center).
  const byKey = new Map();
  for (const f of features) {
    const k = `${f.properties.name}|${f.properties.kind}|${f.geometry.coordinates[0].toFixed(4)},${f.geometry.coordinates[1].toFixed(4)}`;
    if (!byKey.has(k)) {
      byKey.set(k, f);
    } else {
      // Replace if the new one is a way and the existing is a node.
      const existing = byKey.get(k);
      if (
        f.properties.osm_id.startsWith("way/") &&
        existing.properties.osm_id.startsWith("node/")
      ) {
        byKey.set(k, f);
      }
    }
  }
  const deduped = [...byKey.values()];

  const fc = { type: "FeatureCollection", features: deduped };
  const outPath = path.join(PUBLIC_DATA, `${slug}_landmarks.geojson`);
  fs.writeFileSync(outPath, JSON.stringify(fc) + "\n", "utf8");

  // Summary by kind.
  const byKind = {};
  for (const f of deduped) {
    byKind[f.properties.kind] = (byKind[f.properties.kind] ?? 0) + 1;
  }
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(
    `\nWrote ${outPath} (${deduped.length} landmarks, ${sizeKb} KB)\n` +
      `  dropped ${dropUnnamed} unnamed, ${dropUnclassified} unclassified, ${dropOutsideMuni} outside outline, ${features.length - deduped.length} duplicates`
  );
  for (const [k, n] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(10)} ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
