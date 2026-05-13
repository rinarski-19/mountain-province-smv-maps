#!/usr/bin/env node
// Convert a Bauko-barangay shapefile into the GeoJSON shape this app expects
// and write it to public/data/bauko_barangays_custom.geojson, which the map
// loads in preference to the bundled PSA defaults.
//
// Usage:
//   npm run import:shapefile -- path/to/bauko_brgys.shp
//   node scripts/convert-shapefile.mjs ./input/bauko.shp --name-prop Brgy_Name
//
// Flags:
//   --name-prop <key>   Source property holding the barangay name. Default:
//                       auto-detect from a list of common keys.
//   --out <path>        Output path. Default: public/data/bauko_barangays_custom.geojson

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as shapefile from "shapefile";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const shpPath = positional[0];
if (!shpPath) {
  console.error("Usage: node scripts/convert-shapefile.mjs <path-to.shp>");
  console.error("Optional: --name-prop <key>  --out <path>");
  process.exit(1);
}
if (!fs.existsSync(shpPath)) {
  console.error(`Shapefile not found: ${shpPath}`);
  process.exit(1);
}

const namePropOverride = flag("name-prop", null);
const outPath = path.resolve(
  ROOT,
  flag("out", "public/data/bauko_barangays_custom.geojson")
);

// Common property keys used by PH admin shapefiles.
const NAME_KEY_CANDIDATES = [
  "name",
  "NAME",
  "Name",
  "NAME_3",
  "NAME_4",
  "ADM4_EN",
  "ADM3_EN",
  "Barangay",
  "BARANGAY",
  "Brgy_Name",
  "BRGY_NAME",
  "BARANGAY_N",
  "Brgy",
  "BRGY",
  "BarangayN",
  "name_en",
];

function pickNameKey(props) {
  if (namePropOverride) return namePropOverride;
  for (const k of NAME_KEY_CANDIDATES) {
    if (props && k in props) return k;
  }
  return null;
}

function titleCase(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .split(/(\s|-|')/)
    .map((part) => (part.length > 1 ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

const out = { type: "FeatureCollection", features: [] };
let nameKey = null;
let count = 0;

const source = await shapefile.open(shpPath);
while (true) {
  const result = await source.read();
  if (result.done) break;
  const ft = result.value;
  if (!nameKey) {
    nameKey = pickNameKey(ft.properties);
    if (!nameKey) {
      console.error(
        "Could not auto-detect a name property. Pass --name-prop <key>."
      );
      console.error("Available keys:", Object.keys(ft.properties || {}));
      process.exit(2);
    }
    console.log(`Using name property: ${nameKey}`);
  }
  const raw = String(ft.properties?.[nameKey] ?? "").trim();
  if (!raw) continue;
  out.features.push({
    type: "Feature",
    properties: {
      name: titleCase(raw),
      level: "barangay",
      parent_municipality: "Bauko",
      parent_province: "Mountain Province",
      source_props: ft.properties,
    },
    geometry: ft.geometry,
  });
  count++;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${count} feature(s) → ${outPath}`);
