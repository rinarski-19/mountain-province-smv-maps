#!/usr/bin/env node
// Pull OSM water features inside a municipality and write to
// public/data/<m>_osm_water.geojson. Used as the vector basemap
// "water" layer when printing.
//
// Two kinds of features are merged into one output file:
//   - waterway lines: river, stream, canal, drain        (LineString)
//   - water-body polygons: natural=water, landuse=reservoir (Polygon / MultiPolygon)
//
// Each feature is tagged with:
//   - osm_id     : OSM way/relation id
//   - osm_kind   : "waterway" | "waterbody"
//   - subtype    : raw OSM value (river, stream, lake, reservoir, …)
//   - name       : OSM name tag, if any
//   - length_m   : line length in meters (waterways only)
//   - area_m2    : polygon area in m² (waterbodies only)
//
// Drops segments / polygons that fall outside the municipal outline so
// downstream rendering can trust the file as already clipped.
//
// Usage:
//   node scripts/fetch-osm-water.mjs bauko
//   node scripts/fetch-osm-water.mjs <slug>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "mountain-province-smv-app/1.0 (water fetcher; LGU consultation use)";

// All ten LGUs. Water is needed for the vector print basemap on every
// municipality, not just the ones with editor features wired up.
const MUNICIPALITY_SLUGS = [
  "bauko",
  "barlig",
  "besao",
  "bontoc",
  "natonin",
  "paracelis",
  "sabangan",
  "sadanga",
  "sagada",
  "tadian",
];

// Drop waterways shorter than this (m) — incidental drainage stubs
// that clutter print without communicating anything geographic.
const MIN_WATERWAY_LENGTH_M = 60;

// Drop water polygons smaller than this (m²) — puddles, sediment
// ponds, mapping noise. 200 m² is roughly a 14×14 m pond.
const MIN_WATERBODY_AREA_M2 = 200;

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  if (!MUNICIPALITY_SLUGS.includes(slug)) {
    console.error(
      `Unknown municipality slug: ${slug || "(missing)"}\n` +
        `Known: ${MUNICIPALITY_SLUGS.join(", ")}`
    );
    process.exit(1);
  }

  const outlinePath = path.join(PUBLIC_DATA, `${slug}.geojson`);
  if (!fs.existsSync(outlinePath)) {
    console.error(
      `Missing ${outlinePath}. Run \`npm run boundaries:fetch:${slug}\` first.`
    );
    process.exit(1);
  }
  const outlineFeature = JSON.parse(fs.readFileSync(outlinePath, "utf8"))
    .features?.[0];

  const [west, south, east, north] = turf.bbox(outlineFeature);

  // Waterways (lines) and water bodies (areas) live under different
  // tag keys. One Overpass call grabs both. `out geom` returns full
  // coordinate arrays so we don't need a follow-up node fetch.
  const overpassQuery = `
    [out:json][timeout:90];
    (
      way["waterway"~"^(river|stream|canal|drain)$"](${south},${west},${north},${east});
      way["natural"="water"](${south},${west},${north},${east});
      relation["natural"="water"](${south},${west},${north},${east});
      way["landuse"="reservoir"](${south},${west},${north},${east});
    );
    out geom;
  `.trim();

  console.log(`Querying Overpass for ${slug} water…`);
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
    (el) => Array.isArray(el.geometry) || Array.isArray(el.members)
  );
  console.log(`Got ${elements.length} OSM elements.`);

  const features = [];
  let dropShort = 0;
  let dropSmall = 0;
  let dropOutside = 0;
  let dropMalformed = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    const isWaterway = !!tags.waterway;
    const isWaterbody =
      tags.natural === "water" || tags.landuse === "reservoir";

    try {
      if (isWaterway && el.type === "way" && Array.isArray(el.geometry)) {
        const coords = el.geometry.map((p) => [p.lon, p.lat]);
        if (coords.length < 2) {
          dropMalformed++;
          continue;
        }
        const line = turf.lineString(coords);
        const lenM = turf.length(line, { units: "meters" });
        if (lenM < MIN_WATERWAY_LENGTH_M) {
          dropShort++;
          continue;
        }
        // Quick bbox prefilter; precise containment check via midpoint.
        const mid = turf.along(line, lenM / 2 / 1000, {
          units: "kilometers",
        });
        if (!turf.booleanPointInPolygon(mid, outlineFeature)) {
          dropOutside++;
          continue;
        }
        features.push({
          type: "Feature",
          properties: {
            osm_id: `w${el.id}`,
            osm_kind: "waterway",
            subtype: tags.waterway,
            name: tags.name || null,
            length_m: Math.round(lenM),
          },
          geometry: line.geometry,
        });
        continue;
      }

      if (isWaterbody) {
        let polygon;
        if (el.type === "way" && Array.isArray(el.geometry)) {
          const coords = el.geometry.map((p) => [p.lon, p.lat]);
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

        const areaM2 = turf.area(polygon);
        if (areaM2 < MIN_WATERBODY_AREA_M2) {
          dropSmall++;
          continue;
        }
        const centroid = turf.centroid(polygon);
        if (!turf.booleanPointInPolygon(centroid, outlineFeature)) {
          dropOutside++;
          continue;
        }
        features.push({
          type: "Feature",
          properties: {
            osm_id: `${el.type[0]}${el.id}`,
            osm_kind: "waterbody",
            subtype:
              tags.water || tags.natural || tags.landuse || "waterbody",
            name: tags.name || null,
            area_m2: Math.round(areaM2),
          },
          geometry: polygon.geometry,
        });
        continue;
      }

      dropMalformed++;
    } catch {
      dropMalformed++;
    }
  }

  const outPath = path.join(PUBLIC_DATA, `${slug}_osm_water.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features }) + "\n"
  );

  const waterways = features.filter((f) => f.properties.osm_kind === "waterway");
  const waterbodies = features.filter(
    (f) => f.properties.osm_kind === "waterbody"
  );
  console.log(
    `Wrote ${outPath} — ${waterways.length} waterways + ${waterbodies.length} water bodies.\n` +
      `(dropped ${dropShort} short, ${dropSmall} tiny, ${dropOutside} outside, ${dropMalformed} malformed)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
