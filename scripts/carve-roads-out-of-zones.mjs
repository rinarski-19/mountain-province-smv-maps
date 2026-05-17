// scripts/carve-roads-out-of-zones.mjs
//
// One-time cleanup pass that subtracts the OSM road centerline (buffered
// out by a configurable carve width) from every polygon in a
// <slug>_zones.geojson file. The result: no zone ever sits in the middle
// of a road, which fixes the slivers / fingers that the user pointed at
// in the Dacudac / Lenga screenshot.
//
// This is the same operation that the bake flow does at draw-time (see
// EditableZones.js → bakeRoadsIntoCorridor → carveRoadsOutOfGeometry),
// but applied retroactively to a file that was generated before the
// carve was in place.
//
// Usage:
//   node scripts/carve-roads-out-of-zones.mjs <slug> [--carve <meters>]
//   node scripts/carve-roads-out-of-zones.mjs tadian
//   node scripts/carve-roads-out-of-zones.mjs tadian --carve 4
//
// A timestamped backup of the input zones file is written next to it
// before any changes land, so this is always reversible.

import * as turf from "@turf/turf";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/carve-roads-out-of-zones.mjs <slug> [--carve <meters>]"
  );
  process.exit(1);
}
const slug = args[0];
let carveMeters = 3;
const carveIdx = args.indexOf("--carve");
if (carveIdx >= 0 && args[carveIdx + 1]) {
  carveMeters = parseFloat(args[carveIdx + 1]);
  if (!Number.isFinite(carveMeters) || carveMeters <= 0) {
    console.error(`--carve must be a positive number, got ${args[carveIdx + 1]}`);
    process.exit(1);
  }
}
// Drop fragments smaller than this after the cut. Most legitimate fills
// are >50 m²; anything tinier is a Geoman-style sliver and looks like
// noise on the map.
const MIN_FRAGMENT_SQM = 30;

const root = path.resolve("public/data");
const zonesPath = path.join(root, `${slug}_zones.geojson`);
const roadsPath = path.join(root, `${slug}_osm_roads.geojson`);

const zones = JSON.parse(await fs.readFile(zonesPath, "utf8"));
const roads = JSON.parse(await fs.readFile(roadsPath, "utf8"));

console.log(`${zones.features.length} zones, ${roads.features.length} road features.`);
console.log(`Carve width: ${carveMeters}m (each road centerline → ${carveMeters * 2}m diameter strip).`);

// Flatten every road geometry into a single MultiLineString. Buffering
// one MLS is ~100× faster than buffering each LineString and unioning
// the result.
const lineCoords = [];
for (const r of roads.features) {
  const g = r.geometry;
  if (!g) continue;
  if (g.type === "LineString") lineCoords.push(g.coordinates);
  else if (g.type === "MultiLineString") lineCoords.push(...g.coordinates);
}
if (lineCoords.length === 0) {
  console.error("No road LineStrings found; aborting.");
  process.exit(1);
}
const allRoads = turf.multiLineString(lineCoords);
const roadArea = turf.buffer(allRoads, carveMeters / 1000, {
  units: "kilometers",
});
console.log(`Road buffer area: ${(turf.area(roadArea) / 10000).toFixed(2)} ha.`);

let trimmed = 0;
let droppedEmpty = 0;
let droppedTiny = 0;
let unchanged = 0;
let errors = 0;
let totalTrimSqm = 0;

const cleaned = [];
for (const z of zones.features) {
  const beforeArea = turf.area(z);
  let diff = null;
  try {
    diff = turf.difference(turf.featureCollection([z, roadArea]));
  } catch (e) {
    errors++;
    // If the difference op chokes (usually self-intersecting input),
    // keep the original so we never silently lose a zone.
    cleaned.push(z);
    continue;
  }
  if (!diff) {
    // Polygon was entirely inside the road buffer.
    droppedEmpty++;
    continue;
  }
  const afterArea = turf.area(diff);
  if (afterArea < MIN_FRAGMENT_SQM) {
    droppedTiny++;
    continue;
  }
  const lost = beforeArea - afterArea;
  if (lost < 0.5) {
    unchanged++;
    cleaned.push(z);
    continue;
  }
  trimmed++;
  totalTrimSqm += lost;
  // Preserve the original feature's properties; only swap in the new
  // geometry. turf.difference returns a Feature with no useful props.
  cleaned.push({
    type: "Feature",
    properties: z.properties,
    geometry: diff.geometry,
  });
}

console.log("\nResult:");
console.log(`  ${trimmed} zones trimmed (cumulative ${totalTrimSqm.toFixed(0)} m² removed from inside roads)`);
console.log(`  ${droppedEmpty} zones dropped (were entirely inside road)`);
console.log(`  ${droppedTiny} zones dropped (left < ${MIN_FRAGMENT_SQM} m² after trim)`);
console.log(`  ${unchanged} zones unchanged`);
if (errors) console.log(`  ${errors} zones failed difference op — kept as-is`);
console.log(`  ${cleaned.length} zones remain (was ${zones.features.length})`);

// Backup before overwriting.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = zonesPath.replace(
  /\.geojson$/,
  `.before-road-carve-${stamp}.geojson`
);
await fs.copyFile(zonesPath, backupPath);
console.log(`\nBackup: ${path.relative(process.cwd(), backupPath)}`);

zones.features = cleaned;
await fs.writeFile(zonesPath, JSON.stringify(zones));
console.log(`Wrote: ${path.relative(process.cwd(), zonesPath)}`);
