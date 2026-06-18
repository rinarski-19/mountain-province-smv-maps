#!/usr/bin/env node
// Pull OSM roads inside a municipality, chip each road at every
// barangay boundary it crosses, write to public/data/<m>_osm_roads.geojson.
//
// Each output feature is a LineString tagged with:
//   - barangay_slug : which barangay this segment lies inside
//   - barangay_name : human-readable barangay name
//   - osm_way_id    : OSM way id (segments of the same way share this)
//   - highway       : OSM highway tag
//   - name          : OSM road name, if any
//   - length_m      : segment length in meters
//
// The chipping means "the national road crossing 4 barangays" becomes 4
// separate clickable segments in the editor, each tied to its barangay.
//
// Usage:
//   node scripts/fetch-osm-roads.mjs bauko
//   node scripts/fetch-osm-roads.mjs barlig
//   ...

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "bauko-leaflet-app/1.0 (chipped-roads fetcher; one-off LGU consultation use)";

// Per-municipality wiring — same shape as build-road-corridors.mjs so a
// new municipality only needs its lib module exports defined.
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
  natonin: { module: "../lib/natonin.js", slugFnExport: "slugForNatoninName" },
  paracelis: {
    module: "../lib/paracelis.js",
    slugFnExport: "slugForParacelisName",
  },
};

// Drop pre-chip ways shorter than this — OSM noise (driveways, dead
// stubs). Per-segment lengths are computed after chipping anyway, so
// this filter is on the raw way's total length.
const MIN_WAY_LENGTH_M = 30;

// Drop chipped segments shorter than this — a few meters of overlap at
// a barangay boundary isn't useful and clutters the click target.
const MIN_SEGMENT_LENGTH_M = 15;

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
      console.error(`Missing ${p}. Run \`npm run boundaries:fetch:${slug}\` first.`);
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
  const overpassQuery = `
    [out:json][timeout:60];
    (
      way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|track)$"](${south},${west},${north},${east});
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
  const ways = (overpass.elements || []).filter(
    (el) => el.type === "way" && Array.isArray(el.geometry)
  );
  console.log(`Got ${ways.length} ways.`);

  // Pre-build polygon-as-line for each barangay (lineSplit takes a
  // line-shaped splitter, not a polygon).
  const barangayLines = barangaysWithSlugs.map((b) => ({
    slug: b.slug,
    name: b.name,
    polygon: b.feature,
    boundaryLine: turf.polygonToLine(b.feature),
  }));

  const features = [];
  let dropShort = 0;
  let dropOutside = 0;
  let dropSegShort = 0;

  for (const way of ways) {
    const coords = way.geometry.map((p) => [p.lon, p.lat]);
    if (coords.length < 2) continue;
    let wayLine;
    try {
      wayLine = turf.lineString(coords);
    } catch {
      continue;
    }
    const wayLenM = turf.length(wayLine, { units: "meters" });
    if (wayLenM < MIN_WAY_LENGTH_M) {
      dropShort++;
      continue;
    }

    let anyAssigned = false;
    for (const b of barangayLines) {
      // Quick bbox prefilter — skip barangays that can't possibly
      // intersect this way. Avoids running lineSplit on every pair.
      if (!bboxesIntersect(turf.bbox(wayLine), turf.bbox(b.polygon))) continue;

      let parts;
      try {
        const split = turf.lineSplit(wayLine, b.boundaryLine);
        parts = split.features.length ? split.features : [wayLine];
      } catch {
        parts = [wayLine];
      }

      for (const part of parts) {
        const lenM = turf.length(part, { units: "meters" });
        if (lenM < MIN_SEGMENT_LENGTH_M) {
          dropSegShort++;
          continue;
        }
        // Midpoint-in-polygon decides whether this part lies inside the
        // current barangay. Each part will only match exactly one
        // barangay (assuming barangays don't overlap), so we don't
        // need to break early.
        const mid = turf.along(part, lenM / 2 / 1000, { units: "kilometers" });
        if (!turf.booleanPointInPolygon(mid, b.polygon)) continue;

        features.push({
          type: "Feature",
          properties: {
            barangay_slug: b.slug,
            barangay_name: b.name,
            osm_way_id: way.id,
            highway: way.tags?.highway ?? null,
            name: way.tags?.name ?? null,
            // bridge / tunnel are passed through so cartographic
            // renderers can give them distinct treatment (black
            // bridge casing, dashed tunnel, etc.). Common values:
            //   bridge = "yes" | "viaduct" | "movable" | "no"
            //   tunnel = "yes" | "building_passage" | "no"
            // Null when OSM doesn't tag the way, which is the norm
            // (most roads are at-grade neither bridge nor tunnel).
            bridge: way.tags?.bridge ?? null,
            tunnel: way.tags?.tunnel ?? null,
            length_m: Math.round(lenM),
          },
          geometry: part.geometry,
        });
        anyAssigned = true;
      }
    }
    if (!anyAssigned) dropOutside++;
  }

  const outPath = path.join(PUBLIC_DATA, `${slug}_osm_roads.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features }) + "\n"
  );
  console.log(
    `Wrote ${outPath} — ${features.length} chipped road segments.\n` +
      `(dropped ${dropShort} short ways, ${dropOutside} entirely-outside, ${dropSegShort} short segments)`
  );
}

function bboxesIntersect(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
