// Build distance-from-road overlay bands for a municipality, CHIPPED
// per road segment so each piece is independently click-selectable in
// the editor.
//
// The Bauko 2027 SMV ordinance (and most Philippine LGU SMV documents)
// uses a 30m depth-of-frontage rule: road-frontage tier (e.g. R-1)
// applies only to the strip within 30m of the road; the next 30m is
// the secondary tier (R-2); beyond ~60m is the inner-lots tier (R-3+).
//
// Output schema: a FeatureCollection where every feature is a single
// band polygon along ONE road segment. Each carries:
//   - band:         "0-30" | "30-60"
//   - depth_m:      30 | 60
//   - road_way_id:  OSM way id
//   - road_name:    OSM road name (if any)
//   - road_highway: OSM highway tag (trunk/primary/secondary/…)
//   - barangay_slug, barangay_name
//   - label:        human-readable depth label
//
// In the editor, EditableZones.js renders these as a clickable layer:
// Shift+click toggles selection, then a class chip click bakes the
// selected band chunks into a zone polygon (no buffering needed —
// they're already the right shape).
//
// Usage:
//   node scripts/build-frontage-bands.mjs <slug>
//
// Output: public/data/<slug>_frontage_bands.geojson

import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/build-frontage-bands.mjs <slug>");
  process.exit(1);
}

const ROOT = path.resolve(process.cwd());

const ROADS_PATH = path.join(ROOT, "public", "data", `${slug}_osm_roads.geojson`);
const OUT_PATH = path.join(ROOT, "public", "data", `${slug}_frontage_bands.geojson`);

// Which OSM `highway` tags count as "roads" for frontage purposes.
// The LGU SMV schedules specifically attach the depth-of-frontage
// rule to "all-weather roads" — that excludes OSM `track` (unpaved /
// seasonal dirt paths) and `service` / `path` / `footway`. National,
// provincial, municipal, and barangay roads are paved or graded
// enough to count, and OSM tags them trunk / primary / secondary /
// tertiary / unclassified / residential.
const RELEVANT_HIGHWAYS = new Set([
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
]);

if (!fs.existsSync(ROADS_PATH)) {
  console.error(`Missing roads file: ${ROADS_PATH}`);
  console.error(`Run \`npm run roads:fetch:${slug}\` first.`);
  process.exit(1);
}

const roadsFC = JSON.parse(fs.readFileSync(ROADS_PATH, "utf8"));

const relevantRoads = roadsFC.features.filter((f) =>
  RELEVANT_HIGHWAYS.has(f.properties?.highway)
);

console.log(
  `Loaded ${roadsFC.features.length} roads, kept ${relevantRoads.length} for frontage chipping.`
);

// ---- Flat-cap buffer helper (matches components/EditableZones.js) ----
function flatCapBuffer(input, halfWidthM) {
  if (!input) return null;
  const geom = input.type === "Feature" ? input.geometry : input;
  if (!geom) return null;
  const lines =
    geom.type === "MultiLineString"
      ? geom.coordinates
      : geom.type === "LineString"
        ? [geom.coordinates]
        : null;
  if (!lines || lines.length === 0) return null;

  const polys = [];
  for (const coords of lines) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    let leftRing;
    let rightRing;
    try {
      const ls = turf.lineString(coords);
      leftRing = turf.lineOffset(ls, halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
      rightRing = turf.lineOffset(ls, -halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
    } catch {
      continue;
    }
    if (!leftRing?.length || !rightRing?.length) continue;
    const ring = [
      ...leftRing,
      ...rightRing.slice().reverse(),
      leftRing[0],
    ];
    try {
      const poly = turf.polygon([ring]);
      const cleaned = turf.buffer(poly, 0, { units: "meters" });
      polys.push(cleaned ?? poly);
    } catch {}
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  try {
    return turf.union(turf.featureCollection(polys));
  } catch {
    return polys[0];
  }
}

// Carve a small inset along the road centerline out of the 0–30 m
// band so the road carriageway stays visible (and clickable as the
// roads layer) when an SMV class is baked from a band chip. Matches
// the ROAD_INSET_METERS used in components/EditableZones.js for the
// Shift+click-roads flow, so corridor zones built from either source
// look identical.
const ROAD_INSET_METERS = 4;

// ---- Build the per-segment chips ----
const features = [];
let failed = 0;
let segIdx = 0;

for (const road of relevantRoads) {
  segIdx += 1;
  const geom = road.geometry;
  if (!geom || (geom.type !== "LineString" && geom.type !== "MultiLineString")) {
    continue;
  }

  const baseProps = {
    road_way_id: road.properties?.osm_way_id ?? null,
    road_name: road.properties?.name ?? null,
    road_highway: road.properties?.highway ?? null,
    barangay_slug: road.properties?.barangay_slug ?? null,
    barangay_name: road.properties?.barangay_name ?? null,
    // Stable per-segment id so the UI can track selection across reloads.
    // Falls back to a sequential index if osm_way_id is missing.
    chip_id: `${road.properties?.osm_way_id ?? `s${segIdx}`}__${road.properties?.barangay_slug ?? "none"}`,
  };

  // 0-30m band — flat-capped buffer of just this road MINUS a small
  // road-inset cutout along the centerline. The inset preserves the
  // road carriageway so it stays visible (and selectable as a road)
  // when an SMV class is baked over a band chip.
  const buf30Outer = flatCapBuffer(road, 30);
  const buf30Inset =
    ROAD_INSET_METERS > 0 ? flatCapBuffer(road, ROAD_INSET_METERS) : null;
  let buf30 = buf30Outer;
  if (buf30Outer?.geometry && buf30Inset?.geometry) {
    try {
      const carved = turf.difference(
        turf.featureCollection([buf30Outer, buf30Inset])
      );
      if (carved?.geometry) buf30 = carved;
    } catch {
      // Difference can throw on near-tangent geometry — keep the
      // un-carved 30m buffer as a safe fallback.
    }
  }
  // 30-60m band — buf60 minus buf30Outer (already excludes the road
  // since the inner edge sits at 30m from the centerline).
  const buf60 = flatCapBuffer(road, 60);

  if (buf30?.geometry) {
    features.push({
      type: "Feature",
      properties: {
        ...baseProps,
        band: "0-30",
        depth_m: 30,
        label: "0–30 m frontage",
        chip_id: `${baseProps.chip_id}__0-30`,
      },
      geometry: buf30.geometry,
    });
  } else {
    failed += 1;
  }

  if (buf30Outer?.geometry && buf60?.geometry) {
    try {
      // Use the un-carved 30m buffer (buf30Outer) here so the inner
      // edge of the 30–60m ring sits exactly 30m from the road
      // centerline. If we used the carved buf30, the ring would bulge
      // back toward the road by ROAD_INSET_METERS, which is wrong.
      const ring = turf.difference(
        turf.featureCollection([buf60, buf30Outer])
      );
      if (ring?.geometry) {
        features.push({
          type: "Feature",
          properties: {
            ...baseProps,
            band: "30-60",
            depth_m: 60,
            label: "30–60 m secondary depth",
            chip_id: `${baseProps.chip_id}__30-60`,
          },
          geometry: ring.geometry,
        });
      }
    } catch {
      // difference can fail on tangent geometry — skip the outer ring
      // for this segment if so.
    }
  }
}

// ---- Simplify lightly to keep file size in check ----
console.log("Simplifying chip geometry (1m tolerance) …");
const simplified = features.map((f) => {
  try {
    return turf.simplify(f, {
      tolerance: 0.00001, // ~1m at PH latitudes — tighter than the old union
      highQuality: false,
      mutate: false,
    });
  } catch {
    return f;
  }
});

const out = { type: "FeatureCollection", features: simplified };
fs.writeFileSync(OUT_PATH, JSON.stringify(out) + "\n", "utf8");

const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
const bandCount = {};
for (const f of features) {
  bandCount[f.properties.band] = (bandCount[f.properties.band] ?? 0) + 1;
}
console.log(
  `\nWrote ${OUT_PATH}\n  ${features.length} chips (${sizeKb} KB) — ${failed} segments failed to buffer`
);
for (const [band, n] of Object.entries(bandCount)) {
  console.log(`  ${band.padEnd(6)} ${n} chips`);
}
