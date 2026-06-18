#!/usr/bin/env node
// Pull OSM place point nodes inside a municipality and write to
// public/data/<m>_osm_places.geojson. Used as the vector basemap
// "labels" layer when printing — without these, OSM raster labels
// disappear and the map has no place names.
//
// Each feature is a Point tagged with:
//   - osm_id     : OSM node id, prefixed "n"
//   - place      : "town" | "village" | "hamlet" | "suburb" | "neighbourhood"
//   - name       : OSM name tag (drops nodes with no name)
//   - population : integer if present in OSM (rare in rural MP)
//
// Drops nodes outside the municipal outline so downstream rendering
// can trust the file as already clipped.
//
// Usage:
//   node scripts/fetch-osm-places.mjs bauko
//   node scripts/fetch-osm-places.mjs <slug>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "mountain-province-smv-app/1.0 (places fetcher; LGU consultation use)";

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

// Rank order used to break ties when two place points sit close to
// each other — the higher tier wins display priority in the editor.
const PLACE_RANK = {
  city: 5,
  town: 4,
  village: 3,
  suburb: 2,
  hamlet: 1,
  neighbourhood: 1,
};

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

  // Filter at the Overpass level — the bbox is already small (one
  // LGU) so we don't worry about hauling back unrelated nodes.
  const overpassQuery = `
    [out:json][timeout:60];
    (
      node["place"~"^(city|town|village|hamlet|suburb|neighbourhood)$"](${south},${west},${north},${east});
    );
    out;
  `.trim();

  console.log(`Querying Overpass for ${slug} places…`);
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
  const nodes = (overpass.elements || []).filter(
    (el) => el.type === "node" && Number.isFinite(el.lon) && Number.isFinite(el.lat)
  );
  console.log(`Got ${nodes.length} OSM nodes.`);

  const features = [];
  let dropOutside = 0;
  let dropNoName = 0;

  for (const node of nodes) {
    const tags = node.tags || {};
    if (!tags.name) {
      dropNoName++;
      continue;
    }
    const point = turf.point([node.lon, node.lat]);
    if (!turf.booleanPointInPolygon(point, outlineFeature)) {
      dropOutside++;
      continue;
    }
    const pop = parseInt(tags.population, 10);
    features.push({
      type: "Feature",
      properties: {
        osm_id: `n${node.id}`,
        place: tags.place,
        name: tags.name,
        rank: PLACE_RANK[tags.place] ?? 0,
        population: Number.isFinite(pop) ? pop : null,
      },
      geometry: point.geometry,
    });
  }

  // Sort high-rank first so renderers can short-circuit on label
  // collisions (bigger places win).
  features.sort((a, b) => (b.properties.rank ?? 0) - (a.properties.rank ?? 0));

  const outPath = path.join(PUBLIC_DATA, `${slug}_osm_places.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features }) + "\n"
  );

  const byPlace = {};
  for (const f of features) {
    const k = f.properties.place;
    byPlace[k] = (byPlace[k] || 0) + 1;
  }
  console.log(
    `Wrote ${outPath} — ${features.length} place points.\n` +
      `(dropped ${dropNoName} unnamed, ${dropOutside} outside)\n` +
      `By place type: ${JSON.stringify(byPlace)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
