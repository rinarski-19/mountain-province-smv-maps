#!/usr/bin/env node
// Pull OSM building polygons for a municipality, tag each with the
// barangay it lies in, write to public/data/<m>_osm_buildings.geojson.
//
// Each output feature is a Polygon (or rarely MultiPolygon) tagged with:
//   - barangay_slug : which barangay this building lies inside
//   - barangay_name : human-readable barangay name
//   - osm_id        : OSM way/relation id
//   - building      : OSM building tag value (yes, house, school, etc.)
//   - name          : OSM name tag, if any
//   - addr          : best-effort assembled address string from addr:* tags
//   - area_m2       : footprint area in square meters
//
// Used by the per-building override mode (currently Sadanga-only).
// In the editor, EditableZones renders these as a clickable layer
// when the "Per-building override" toggle is on; shift+click selects,
// then clicking a class chip tags the building as a single-feature
// zone sitting on top of whatever corridor it falls inside.
//
// Usage:
//   node scripts/fetch-osm-buildings.mjs sadanga
//   node scripts/fetch-osm-buildings.mjs <slug>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "mountain-province-smv-app/1.0 (buildings fetcher; LGU consultation use)";

// Per-municipality wiring. Mirrors fetch-osm-roads.mjs and
// fetch-osm-landmarks.mjs so adding a new municipality is one row.
const MUNICIPALITY_CONFIG = {
  bauko: { module: "../lib/bauko.js", slugFnExport: "slugForName" },
  barlig: { module: "../lib/barlig.js", slugFnExport: "slugForBarligName" },
  tadian: { module: "../lib/tadian.js", slugFnExport: "slugForTadianName" },
  sagada: { module: "../lib/sagada.js", slugFnExport: "slugForSagadaName" },
  bontoc: { module: "../lib/bontoc.js", slugFnExport: "slugForBontocName" },
  sabangan: {
    module: "../lib/sabangan.js",
    slugFnExport: "slugForSabanganName",
  },
  besao: { module: "../lib/besao.js", slugFnExport: "slugForBesaoName" },
  sadanga: { module: "../lib/sadanga.js", slugFnExport: "slugForSadangaName" },
};

// Drop OSM building polygons smaller than this. Removes garage stubs,
// noise, and partial fragments. 8 m² is roughly a small toilet shed;
// real residences in Mountain Province are at least 20 m².
const MIN_AREA_M2 = 8;

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

  const [west, south, east, north] = turf.bbox(outlineFeature);
  // Both ways and relations can carry building tags. Relation
  // buildings (complex multipart shapes) are rare but present in
  // dense towns. `out geom` returns full coordinate arrays for both.
  const overpassQuery = `
    [out:json][timeout:120];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out geom;
  `.trim();

  console.log("Querying Overpass…");
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
  const elements = (overpass.elements || []).filter(
    (el) =>
      (el.type === "way" || el.type === "relation") &&
      (Array.isArray(el.geometry) || Array.isArray(el.members))
  );
  console.log(`Got ${elements.length} OSM elements.`);

  const features = [];
  let dropSmall = 0;
  let dropOutside = 0;
  let dropMalformed = 0;

  for (const el of elements) {
    let polygon;
    try {
      if (el.type === "way" && Array.isArray(el.geometry)) {
        const coords = el.geometry.map((p) => [p.lon, p.lat]);
        // OSM building ways are closed (first node == last node) in
        // most editors but not guaranteed in raw exports. Close
        // explicitly if needed.
        if (coords.length < 4) {
          dropMalformed++;
          continue;
        }
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([...first]);
        }
        polygon = turf.polygon([coords]);
      } else if (el.type === "relation" && Array.isArray(el.members)) {
        // Multipolygon: outer rings + inner holes. Simplified handling:
        // grab every member with role "outer" or no role; ignore
        // inners. This loses courtyards but matches what the editor
        // needs (clickable building footprints).
        const outerRings = [];
        for (const m of el.members) {
          if (m.type !== "way" || !Array.isArray(m.geometry)) continue;
          if (m.role && m.role !== "outer") continue;
          const coords = m.geometry.map((p) => [p.lon, p.lat]);
          if (coords.length < 4) continue;
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            coords.push([...first]);
          }
          outerRings.push([coords]);
        }
        if (outerRings.length === 0) {
          dropMalformed++;
          continue;
        }
        polygon =
          outerRings.length === 1
            ? turf.polygon(outerRings[0])
            : turf.multiPolygon(outerRings);
      } else {
        dropMalformed++;
        continue;
      }
    } catch {
      dropMalformed++;
      continue;
    }

    const areaM2 = turf.area(polygon);
    if (areaM2 < MIN_AREA_M2) {
      dropSmall++;
      continue;
    }

    // Assign to barangay by centroid containment. Fast and correct
    // for buildings that don't straddle a barangay boundary (rare).
    let assignedBarangay = null;
    try {
      const centroid = turf.centroid(polygon);
      for (const b of barangaysWithSlugs) {
        if (turf.booleanPointInPolygon(centroid, b.feature)) {
          assignedBarangay = b;
          break;
        }
      }
    } catch {}
    if (!assignedBarangay) {
      dropOutside++;
      continue;
    }

    // Assemble a human-friendly address from common addr:* tags.
    const tags = el.tags || {};
    const addrParts = [];
    if (tags["addr:housenumber"]) addrParts.push(tags["addr:housenumber"]);
    if (tags["addr:street"]) addrParts.push(tags["addr:street"]);
    if (tags["addr:place"]) addrParts.push(tags["addr:place"]);
    if (tags["addr:suburb"]) addrParts.push(tags["addr:suburb"]);

    features.push({
      type: "Feature",
      properties: {
        barangay_slug: assignedBarangay.slug,
        barangay_name: assignedBarangay.name,
        osm_id: `${el.type[0]}${el.id}`,
        osm_type: el.type,
        building: tags.building || "yes",
        name: tags.name || null,
        addr: addrParts.length ? addrParts.join(", ") : null,
        area_m2: Math.round(areaM2),
      },
      geometry: polygon.geometry,
    });
  }

  const outPath = path.join(PUBLIC_DATA, `${slug}_osm_buildings.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features }) + "\n"
  );
  console.log(
    `Wrote ${outPath} — ${features.length} buildings.\n` +
      `(dropped ${dropSmall} too-small, ${dropOutside} outside-barangays, ${dropMalformed} malformed)`
  );

  // Per-barangay summary for quick sanity check
  const byBarangay = {};
  for (const f of features) {
    const s = f.properties.barangay_slug;
    byBarangay[s] = (byBarangay[s] || 0) + 1;
  }
  console.log("By barangay:", byBarangay);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
