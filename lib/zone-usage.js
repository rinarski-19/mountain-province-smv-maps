// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// How many drawn zones use each SMV class, and reassigning them from one
// class to another.
//
// This exists because withdrawing or deleting a class is not a paperwork
// change: Paracelis has 148 zones drawn in C-1. Removing the class
// without moving them leaves polygons on the map whose classification
// names something that no longer appears in the legend or the toolbar —
// visible on the printed sheet, uneditable in the UI. So the panel counts
// them first and makes the editor choose where they go.
//
// Server-only (node:fs).

import fs from "node:fs";
import path from "node:path";
import { CLASSIFICATION_INFO } from "./classifications.js";

export function zonesFileName(slug) {
  return `${slug}_zones.geojson`;
}

function readZones(slug, publicDataDir) {
  const file = path.join(publicDataDir, zonesFileName(slug));
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.features) ? parsed : null;
  } catch {
    return null;
  }
}

// { "C-1": 16, "R-2": 5, ... } — classes with no zones are simply absent.
export function zoneCountsByClass(slug, publicDataDir) {
  const zones = readZones(slug, publicDataDir);
  if (!zones) return {};
  const counts = {};
  for (const feature of zones.features) {
    const klass = String(feature?.properties?.classification ?? "").toUpperCase();
    if (!klass) continue;
    counts[klass] = (counts[klass] ?? 0) + 1;
  }
  return counts;
}

// Rewrites every zone classified `from` to `to`, returning the serialized
// FeatureCollection for the caller to persist. Geometry is untouched —
// only the classification property changes.
export function reassignZones(slug, publicDataDir, from, to) {
  const zones = readZones(slug, publicDataDir);
  if (!zones) {
    const err = new Error(`No zones file for ${slug}.`);
    err.status = 404;
    throw err;
  }
  const fromKey = String(from ?? "").trim().toUpperCase();
  const toKey = String(to ?? "").trim().toUpperCase();
  if (!fromKey || !toKey || fromKey === toKey) {
    const err = new Error("`from` and `to` must be different class codes.");
    err.status = 400;
    throw err;
  }
  // The destination must be a real class. Without this check any string
  // was accepted — `"Z-99"` and even `"  "` (truthy after toUpperCase)
  // rewrote real polygons to a classification nothing in the app can
  // select, display or undo. That is the exact stranding this function
  // exists to prevent.
  if (!CLASSIFICATION_INFO[toKey]) {
    const err = new Error(
      `Unknown destination class "${to}". Must be one of the catalogue ` +
        `codes (C-1…C-12, R-1…R-15, INSTITUTIONAL, UNCLASSIFIED).`
    );
    err.status = 400;
    throw err;
  }

  let moved = 0;
  const features = zones.features.map((feature) => {
    const klass = String(feature?.properties?.classification ?? "").toUpperCase();
    if (klass !== fromKey) return feature;
    moved += 1;
    return {
      ...feature,
      properties: { ...(feature.properties ?? {}), classification: toKey },
    };
  });

  return {
    moved,
    serialized:
      JSON.stringify({ type: "FeatureCollection", features }, null, 2) + "\n",
  };
}
