#!/usr/bin/env node
// Fetch barangay boundaries for a Mountain Province municipality from the
// public GeoRiskPH ArcGIS service (backed by PSA data) and derive the
// municipality outline from the union of those barangays.
//
// Usage:
//   node scripts/fetch-psa-boundaries.mjs            # defaults to bauko
//   node scripts/fetch-psa-boundaries.mjs barlig
//   node scripts/fetch-psa-boundaries.mjs --municipality barlig
//
// Adding another municipality is just an entry in MUNICIPALITY_PARAMS —
// outputs land at public/data/<slug>.geojson and
// public/data/<slug>_barangays.geojson.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const SOURCE_URL =
  "https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4/query";
const SOURCE_LABEL =
  "PSA Barangay Boundary via GeoRiskPH ArcGIS REST service";
const PROVINCE = "Mountain Province";

// Parameters per municipality. expectedBarangays is the count we assert
// against PSA's response — bumps prevent silent partial fetches when the
// upstream layer changes. Add a row to enable a new municipality.
const MUNICIPALITY_PARAMS = {
  bauko: {
    cityName: "Bauko",
    pcode: "PH144402",
    expectedBarangays: 22,
    displayName: "Bauko",
  },
  barlig: {
    cityName: "Barlig",
    pcode: "PH144401000",
    expectedBarangays: 11,
    displayName: "Barlig",
  },
  tadian: {
    cityName: "Tadian",
    pcode: "PH144410000",
    expectedBarangays: 19,
    displayName: "Tadian",
  },
  sagada: {
    cityName: "Sagada",
    pcode: "PH144409000",
    expectedBarangays: 19,
    displayName: "Sagada",
  },
  bontoc: {
    cityName: "Bontoc",
    pcode: "PH144404000",
    expectedBarangays: 16,
    displayName: "Bontoc",
  },
};

const slug = parseSlugFromArgs(process.argv.slice(2));
const params = MUNICIPALITY_PARAMS[slug];
if (!params) {
  const known = Object.keys(MUNICIPALITY_PARAMS).join(", ");
  console.error(
    `Unknown municipality slug: ${slug}\nKnown slugs: ${known}\n` +
      `Add an entry to MUNICIPALITY_PARAMS in this script to enable a new one.`
  );
  process.exit(1);
}

const barangaysOut = path.join(PUBLIC_DATA, `${slug}_barangays.geojson`);
const municipalityOut = path.join(PUBLIC_DATA, `${slug}.geojson`);

const queryParams = new URLSearchParams({
  where: `prov_name = '${PROVINCE}' AND city_name = '${params.cityName}'`,
  outFields: "*",
  returnGeometry: "true",
  outSR: "4326",
  f: "geojson",
});

const res = await fetch(`${SOURCE_URL}?${queryParams}`);
if (!res.ok) {
  throw new Error(`Boundary fetch failed: ${res.status} ${res.statusText}`);
}

const raw = await res.json();
if (!raw || raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
  throw new Error("Boundary fetch did not return a GeoJSON FeatureCollection.");
}
if (raw.features.length !== params.expectedBarangays) {
  throw new Error(
    `Expected ${params.expectedBarangays} ${params.displayName} barangays, got ${raw.features.length}.`
  );
}

const barangays = raw.features
  .map((feature) => {
    const props = feature.properties ?? {};
    const name = props.brgy_name;
    if (!name) throw new Error("Fetched feature is missing brgy_name.");
    return {
      type: "Feature",
      properties: {
        name,
        level: "barangay",
        pcode: props.brgy_code ? `PH${props.brgy_code}` : null,
        psgc_10d: props.psgc_10d ?? null,
        parent_municipality: props.city_name ?? params.displayName,
        parent_province: props.prov_name ?? PROVINCE,
        parent_region: props.reg_name ?? "Cordillera Administrative Region",
        source: SOURCE_LABEL,
        source_url: SOURCE_URL,
        source_props: {
          objectid: props.objectid,
          reg_code: props.reg_code,
          prov_code: props.prov_code,
          city_code: props.city_code,
          brgy_code: props.brgy_code,
        },
      },
      geometry: feature.geometry,
    };
  })
  .sort((a, b) => {
    const aCode = a.properties.psgc_10d ?? a.properties.name;
    const bCode = b.properties.psgc_10d ?? b.properties.name;
    return String(aCode).localeCompare(String(bCode));
  });

const municipality = turf.union(turf.featureCollection(barangays));
if (!municipality?.geometry) {
  throw new Error(`Could not derive ${params.displayName} municipality outline.`);
}

const municipalityFC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: params.displayName,
        level: "municipality",
        pcode: params.pcode,
        parent_province: PROVINCE,
        parent_region: "Cordillera Administrative Region",
        source: SOURCE_LABEL,
        source_url: SOURCE_URL,
        derived_from: `Union of ${params.displayName} barangay boundaries`,
      },
      geometry: municipality.geometry,
    },
  ],
};

fs.mkdirSync(PUBLIC_DATA, { recursive: true });
fs.writeFileSync(
  barangaysOut,
  `${JSON.stringify({ type: "FeatureCollection", features: barangays })}\n`
);
fs.writeFileSync(municipalityOut, `${JSON.stringify(municipalityFC)}\n`);

console.log(`Wrote ${barangaysOut} (${barangays.length} barangays)`);
console.log(`Wrote ${municipalityOut} (${params.displayName} union)`);

// ------------------------------------------------------------------

function parseSlugFromArgs(args) {
  // Default to bauko so existing `npm run boundaries:fetch` keeps working.
  let slug = "bauko";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--municipality" || a === "-m") {
      slug = args[++i];
    } else if (a.startsWith("--municipality=")) {
      slug = a.slice("--municipality=".length);
    } else if (!a.startsWith("-")) {
      // Positional override.
      slug = a;
    }
  }
  return slug.toLowerCase();
}
