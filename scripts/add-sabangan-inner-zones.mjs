#!/usr/bin/env node
// One-off: add the R-9, R-10, R-11, R-12 SMV zones for Sabangan based
// on the canonical SABANGAN.pdf schedule (see public/data/sabangan_valuations.json).
//
//   R-9   inner-lot fill   Busa, Bun-ayan, Capinitan, Data, Pingad,
//                          Losad, Bao-angan, Napua
//   R-10  inner-lot fill   Supang, Tambingan
//   R-11  barangay-road    Bun-ayan, Camatagan, Gayang
//         corridor
//   R-12  inner-lot fill   Camatagan, Gayang
//
// Inner-lot fills are emitted as the full barangay polygon (so the
// editor sees a paintable base). The existing C-/R- corridor polygons
// will render on top because the print-svg builder sorts zone
// features by area descending — barangay outlines are biggest, drawn
// first; the smaller corridors land on top of them.
//
// R-11 is built by buffering OSM barangay-tier roads (residential /
// unclassified / track) inside the three target barangays by 15 m per
// side — matching the editor's ordinance corridor width.
//
// Run:
//   node scripts/add-sabangan-inner-zones.mjs
//
// Safe to re-run: existing R-9..R-12 features get cleared first so
// re-runs don't accumulate duplicates.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const SLUG = "sabangan";
const ZONES_FILE = path.join(PUBLIC_DATA, `${SLUG}_zones.geojson`);
const BARANGAYS_FILE = path.join(PUBLIC_DATA, `${SLUG}_barangays.geojson`);
const ROADS_FILE = path.join(PUBLIC_DATA, `${SLUG}_osm_roads.geojson`);

const BACKUP_FILE = ZONES_FILE.replace(/\.geojson$/, ".bak-add-inner.geojson");

const INNER_LOT_ASSIGNMENTS = {
  "R-9": [
    "Busa",
    "Bun-ayan",
    "Capinitan",
    "Data",
    "Pingad",
    "Losad",
    "Bao-angan",
    "Napua",
  ],
  "R-10": ["Supang", "Tambingan"],
  "R-12": ["Camatagan", "Gayang"],
};

// Barangays whose barangay-tier roads form R-11 corridors.
const R11_BARANGAYS = ["Bun-ayan", "Camatagan", "Gayang"];
// 15 m per side ≈ 30 m road corridor, matching the ordinance default
// used everywhere else in the codebase.
const R11_BUFFER_M = 15;
// OSM highway tags considered "barangay-tier" roads — anything that
// isn't a numbered national or provincial route.
const R11_HIGHWAY_TAGS = new Set([
  "residential",
  "unclassified",
  "track",
  "service",
  "tertiary_link",
]);

const CLASSES_TO_REPLACE = new Set(["R-9", "R-10", "R-11", "R-12"]);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function makeFeature(klass, geometry, extra = {}) {
  return {
    type: "Feature",
    properties: {
      classification: klass,
      source: "scripts/add-sabangan-inner-zones.mjs",
      generated_at: nowIso(),
      ...extra,
    },
    geometry,
  };
}

function main() {
  const zonesFc = readJson(ZONES_FILE);
  const baranFc = readJson(BARANGAYS_FILE);
  const roadsFc = readJson(ROADS_FILE);

  // Backup original
  if (!fs.existsSync(BACKUP_FILE)) {
    writeJson(BACKUP_FILE, zonesFc);
    console.log(`  wrote backup → ${path.basename(BACKUP_FILE)}`);
  }

  // Index barangays by name
  const baranByName = new Map();
  for (const f of baranFc.features ?? []) {
    const name = f.properties?.name;
    if (!name) continue;
    baranByName.set(name, f);
  }

  // Build new R-9 / R-10 / R-12 features (inner-lot fills)
  const newFeatures = [];
  for (const [klass, barangayNames] of Object.entries(INNER_LOT_ASSIGNMENTS)) {
    for (const name of barangayNames) {
      const baran = baranByName.get(name);
      if (!baran) {
        console.warn(`  ! skipping ${klass} for "${name}" — barangay not found`);
        continue;
      }
      newFeatures.push(
        makeFeature(klass, baran.geometry, {
          barangay: name,
          location_description: `Inner-lot fill — ${name}`,
        })
      );
    }
    console.log(
      `  ${klass}: added ${barangayNames.length} inner-lot polygons`
    );
  }

  // Build R-11 corridor: buffer barangay-tier roads in the three barangays
  const r11Lines = (roadsFc.features ?? []).filter((f) => {
    if (f.geometry?.type !== "LineString") return false;
    const p = f.properties ?? {};
    if (!R11_HIGHWAY_TAGS.has(p.highway)) return false;
    if (!R11_BARANGAYS.includes(p.barangay_name)) return false;
    return true;
  });

  if (r11Lines.length === 0) {
    console.warn(
      `  ! R-11: no matching barangay roads found in ${R11_BARANGAYS.join(
        " / "
      )} — corridor not generated`
    );
  } else {
    // Union the lines, buffer once for a clean single polygon
    let combined;
    try {
      const buffered = r11Lines.map((f) =>
        turf.buffer(f, R11_BUFFER_M, { units: "meters" })
      );
      combined = buffered.reduce((acc, cur) => {
        if (!acc) return cur;
        try {
          return turf.union(acc, cur) ?? acc;
        } catch {
          return acc;
        }
      }, null);
    } catch (e) {
      console.warn(`  ! R-11 buffer failed: ${e?.message ?? e}`);
    }
    if (combined?.geometry) {
      newFeatures.push(
        makeFeature("R-11", combined.geometry, {
          location_description: `Barangay-road corridor — ${R11_BARANGAYS.join(
            ", "
          )}`,
          source_roads_count: r11Lines.length,
          buffer_m_per_side: R11_BUFFER_M,
        })
      );
      console.log(
        `  R-11: built corridor from ${r11Lines.length} barangay roads (${R11_BARANGAYS.join(
          ", "
        )})`
      );
    }
  }

  // Strip any existing R-9..R-12 features so re-runs replace cleanly
  const survivors = (zonesFc.features ?? []).filter(
    (f) => !CLASSES_TO_REPLACE.has(f.properties?.classification)
  );
  const stripped = (zonesFc.features?.length ?? 0) - survivors.length;
  if (stripped > 0) {
    console.log(`  stripped ${stripped} pre-existing R-9..R-12 features`);
  }

  // Insert new features FIRST so SVG renders them at the bottom (the
  // print builder also sorts by area, but starting position helps the
  // editor's draw order match).
  const merged = [...newFeatures, ...survivors];
  const outFc = { ...zonesFc, features: merged };
  writeJson(ZONES_FILE, outFc);

  console.log(
    `  wrote ${path.basename(ZONES_FILE)} — ${merged.length} total features (${
      newFeatures.length
    } new + ${survivors.length} kept)`
  );
}

main();
