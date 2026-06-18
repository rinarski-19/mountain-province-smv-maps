#!/usr/bin/env node
// Widen SMV corridor zones (the ribbon-shaped polygons that follow
// roads) by buffering them outward. Built because at A3 LGU-fit print
// scale, OSM trunk basemap roads render ~60 m wide while the SMV
// frontage corridors are only ~30 m wide — the basemap dominates the
// visual story even though the SMV bands are what matter.
//
// Operation: for every feature in <slug>_zones.geojson whose shape is
// ribbon-like (Polsby-Popper compactness < 0.15), buffer the polygon
// outward by N meters. Non-ribbon features (barangay-fill polygons,
// district-block zones, etc.) are left untouched.
//
// Original file is backed up to <slug>_zones.geojson.bak before any
// write so the operation is reversible.
//
// Usage:
//   node scripts/widen-smv-corridors.mjs bauko
//   node scripts/widen-smv-corridors.mjs bauko --buffer 15
//
// Default buffer: 12 meters outward on each side. That brings a 30 m
// frontage band up to ~54 m, comparable to how trunk + secondary
// roads render on the print.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const RIBBON_COMPACTNESS = 0.15;
const DEFAULT_BUFFER_M = 12;

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function isRibbon(feature) {
  try {
    const a = turf.area(feature);
    if (a <= 0) return false;
    const line = turf.polygonToLine(feature);
    const p = turf.length(line, { units: "meters" });
    if (p <= 0) return false;
    return (4 * Math.PI * a) / (p * p) < RIBBON_COMPACTNESS;
  } catch {
    return false;
  }
}

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  if (!slug) {
    console.error("Usage: node scripts/widen-smv-corridors.mjs <slug> [--buffer N]");
    process.exit(1);
  }
  const bufferM = parseFloat(arg("buffer", String(DEFAULT_BUFFER_M)));
  if (!Number.isFinite(bufferM) || bufferM <= 0) {
    console.error(`Invalid --buffer value. Must be a positive number of meters.`);
    process.exit(1);
  }

  const zonesPath = path.join(PUBLIC_DATA, `${slug}_zones.geojson`);
  if (!fs.existsSync(zonesPath)) {
    console.error(`Missing ${zonesPath}. Run boundaries:fetch:${slug} + earlier bakes first.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(zonesPath, "utf8"));
  if (raw?.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    console.error(`File is not a FeatureCollection: ${zonesPath}`);
    process.exit(1);
  }
  console.log(`Loaded ${raw.features.length} zones from ${zonesPath}`);

  // Back up before any modification.
  const backupPath = `${zonesPath}.bak`;
  fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2) + "\n");
  console.log(`Backup written to ${backupPath}`);

  let widened = 0;
  let untouched = 0;
  let failed = 0;
  const outFeatures = [];

  for (const feat of raw.features) {
    if (!feat?.geometry) {
      outFeatures.push(feat);
      untouched++;
      continue;
    }
    if (!isRibbon(feat)) {
      outFeatures.push(feat);
      untouched++;
      continue;
    }
    try {
      const buffered = turf.buffer(feat, bufferM, { units: "meters" });
      if (!buffered?.geometry) {
        outFeatures.push(feat);
        failed++;
        continue;
      }
      outFeatures.push({
        type: "Feature",
        properties: {
          ...(feat.properties ?? {}),
          // Mark the widening so a future audit can identify what
          // was modified vs original. Read by no app code today, but
          // useful for `git diff` review and for any future revert
          // tooling that wants to undo just this operation.
          widened_by_m: bufferM,
          widened_at: new Date().toISOString(),
        },
        geometry: buffered.geometry,
      });
      widened++;
    } catch (e) {
      outFeatures.push(feat);
      failed++;
    }
  }

  const out = { type: "FeatureCollection", features: outFeatures };
  fs.writeFileSync(zonesPath, JSON.stringify(out, null, 2) + "\n");

  console.log(
    `\nResult — wrote ${zonesPath}\n` +
      `  Widened: ${widened} ribbon-shaped zones (+${bufferM} m outward).\n` +
      `  Untouched: ${untouched} (already compact, no geometry, or non-feature).\n` +
      `  Failed: ${failed} (buffer op errored; kept original).\n` +
      `\nRevert anytime with:\n` +
      `  cp ${backupPath} ${zonesPath}\n` +
      `\nNext: regenerate the print SVG to verify the widened bands.\n` +
      `  node scripts/build-print-svg.mjs ${slug}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
