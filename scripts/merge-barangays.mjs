#!/usr/bin/env node
// Merge per-barangay GeoJSON files in data-raw/ with the PSA default
// barangay collection, producing public/data/bauko_barangays_custom.geojson.
//
// How it works:
//   - Reads every data-raw/bauko_<brgy>.geojson file (skips data-raw/bauko_municipal.*).
//   - For each feature, finds the barangay name (looks at common property keys).
//   - Replaces the matching barangay polygon in the PSA defaults with yours.
//   - Barangays you haven't edited keep their PSA defaults.
//   - Writes the merged collection + flips sources.json.has_custom_barangays = true.
//
// Usage:
//   npm run barangays:merge

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data-raw");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const DEFAULTS = path.join(PUBLIC_DATA, "bauko_barangays.geojson");
const BAUKO = path.join(PUBLIC_DATA, "bauko.geojson");
const OUT = path.join(PUBLIC_DATA, "bauko_barangays_custom.geojson");
const SOURCES = path.join(PUBLIC_DATA, "sources.json");

const NAME_KEYS = [
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
  "BarangayN",
];

// Canonicalise: strip whitespace, title-case, collapse spaces. Matches what
// the bundled PSA defaults use (e.g. "Bagnen Oriente", "Mount Data").
function canonicalize(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/\s+/g, " ");
  return s
    .split(" ")
    .map((w) =>
      w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()
    )
    .join(" ");
}

// Strip parenthetical sitio suffix so "Bila (Bua)" == "Bila" and
// "Poblacion (Bauko)" == "Poblacion" when comparing.
function lookupKey(name) {
  if (!name) return name;
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function pickName(props = {}) {
  for (const k of NAME_KEYS) {
    if (k in props && props[k]) return canonicalize(props[k]);
  }
  return null;
}

// Load PSA defaults as the starting point. Map keys use lookupKey() so
// "Bila (Bua)" and "Bila" resolve to the same slot.
const defaults = JSON.parse(fs.readFileSync(DEFAULTS, "utf-8"));
const byName = new Map();
for (const ft of defaults.features) {
  const key = lookupKey(ft.properties.name);
  byName.set(key, {
    ...ft,
    properties: { ...ft.properties, source: "default (PSA 2019)" },
  });
}

// Find candidate per-barangay files.
//
// Accepted patterns (case-insensitive):
//   bauko_<name>.geojson            ← hand-named per barangay
//   NAME_3_<name>.geojson           ← QGIS "Split Vector Layer by Attribute"
//   <anything>_<name>.geojson under any subdirectory of data-raw/
//
// Excluded: bauko_municipal.*, bauko_barangays.*, the bundled defaults.
function* walkGeoJson(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkGeoJson(full);
    } else if (
      entry.isFile() &&
      /\.geojson$/i.test(entry.name) &&
      !/bauko[_-]municipal/i.test(entry.name) &&
      !/bauko[_-]barangays/i.test(entry.name)
    ) {
      yield full;
    }
  }
}
const files = [...walkGeoJson(RAW_DIR)].sort();
console.log(
  `Scanning ${files.length} candidate file(s) under ${path.relative(ROOT, RAW_DIR)}/`
);

const overrides = [];
for (const full of files) {
  const rel = path.relative(RAW_DIR, full);
  let fc;
  try {
    fc = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (e) {
    console.warn(`  skip ${rel}: not valid JSON (${e.message})`);
    continue;
  }
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    console.warn(`  skip ${rel}: not a FeatureCollection`);
    continue;
  }
  for (const ft of fc.features) {
    const name = pickName(ft.properties);
    if (!name) {
      console.warn(`  skip a feature in ${rel}: no recognisable name property`);
      continue;
    }
    const key = lookupKey(name);
    if (!byName.has(key)) {
      console.warn(
        `  ${rel}: name "${name}" not in PSA defaults — adding as new feature.`
      );
    }
    // Prefer the existing canonical name (with parens) if it was in defaults,
    // so popups stay consistent.
    const existingName = byName.has(key) ? byName.get(key).properties.name : name;
    const next = {
      type: "Feature",
      properties: {
        ...ft.properties,
        name: existingName,
        level: "barangay",
        parent_municipality: "Bauko",
        parent_province: "Mountain Province",
        source: `custom (${rel})`,
      },
      geometry: ft.geometry,
    };
    byName.set(key, next);
    overrides.push({ name: existingName, file: rel });
  }
}

// --- Clip every barangay to the Bauko municipal outline ---
//
// The municipal outline (your GPKG-derived bauko.geojson) is the source of
// truth. Barangay polygons that pre-date / disagree with it get cropped so
// edges line up at the boundary.
const bauko = JSON.parse(fs.readFileSync(BAUKO, "utf-8"));
// turf.intersect wants Feature<Polygon|MultiPolygon> on both sides.
const baukoPoly = bauko.features[0];

function clipToBauko(feature) {
  try {
    // turf.intersect returns null when there is no overlap.
    const fc = turf.featureCollection([feature, baukoPoly]);
    const inter = turf.intersect(fc);
    if (!inter || !inter.geometry) return feature;
    return {
      ...feature,
      properties: { ...feature.properties, clipped: true },
      geometry: inter.geometry,
    };
  } catch (e) {
    console.warn(
      `  could not clip ${feature.properties?.name}: ${e.message} — keeping original`
    );
    return feature;
  }
}

const clipped = [...byName.values()]
  .map(clipToBauko)
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const merged = { type: "FeatureCollection", features: clipped };

fs.writeFileSync(OUT, JSON.stringify(merged));
console.log(
  `\nWrote ${OUT} (${merged.features.length} feature(s), all clipped to Bauko outline)`
);

if (overrides.length === 0) {
  console.log("No per-barangay overrides found. App will keep using PSA defaults.");
} else {
  console.log("Overrides applied:");
  for (const o of overrides) console.log(`  • ${o.name}  ←  ${o.file}`);
}

// Flip the manifest flag.
let sources = {};
try {
  sources = JSON.parse(fs.readFileSync(SOURCES, "utf-8"));
} catch {}
sources.has_custom_barangays = overrides.length > 0;
fs.writeFileSync(SOURCES, JSON.stringify(sources, null, 2));
console.log(
  `sources.json: has_custom_barangays = ${sources.has_custom_barangays}`
);
