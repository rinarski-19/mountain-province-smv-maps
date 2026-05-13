#!/usr/bin/env node
// Pre-download OSM Mapnik tiles for the Bauko bbox into public/tiles/.
//
// OSM's Tile Usage Policy strongly discourages bulk downloads. We only pull a
// small region (Bauko + a buffer), respect a request delay, and set a clear
// User-Agent. For larger regions or repeat use, switch to a self-hosted tile
// server or a paid provider.
//
// Usage:
//   node scripts/download-tiles.mjs                       # default: Bauko, z10–16
//   node scripts/download-tiles.mjs --zooms 10-15
//   node scripts/download-tiles.mjs --bbox mp              # all of Mountain Province
//   node scripts/download-tiles.mjs --delay 1500          # ms between requests

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TILE_DIR = path.join(ROOT, "public", "tiles");

// --- args ---
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}

const BBOXES = {
  // [west, south, east, north]
  bauko: [120.82, 16.81, 120.94, 17.07],
  mp: [120.76, 16.81, 121.58, 17.30],
};

function keyForName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function expandBbox([w, s, e, n], padding = 0.015) {
  return [w - padding, s - padding, e + padding, n + padding];
}

try {
  const municipalitiesPath = path.join(
    ROOT,
    "public",
    "data",
    "mountain_province_municipalities.geojson"
  );
  const municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, "utf-8"));
  for (const feature of municipalities.features ?? []) {
    const name = feature.properties?.name;
    if (!name || !feature.geometry) continue;
    BBOXES[keyForName(name)] = expandBbox(featureBbox(feature));
  }
} catch (e) {
  console.warn(`Could not load municipality bboxes: ${e.message}`);
}

if (args.includes("--list-bboxes")) {
  console.log(Object.keys(BBOXES).sort().join("\n"));
  process.exit(0);
}

const bboxKey = arg("bbox", "bauko");
const bbox = BBOXES[bboxKey];
if (!bbox) {
  console.error(`Unknown --bbox '${bboxKey}'. Try: ${Object.keys(BBOXES).join(", ")}`);
  process.exit(1);
}

const zoomSpec = arg("zooms", "10-16");
const [zMin, zMax] = zoomSpec.split("-").map((s) => parseInt(s, 10));
if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) {
  console.error(`Bad --zooms (expected like 10-16): ${zoomSpec}`);
  process.exit(1);
}

const DELAY_MS = parseInt(arg("delay", "1100"), 10);
const USER_AGENT =
  arg("ua", null) ||
  "BaukoLandValuationApp/0.1 (+https://github.com/local-dev/leaflet-test-app)";

const SUBDOMAINS = ["a", "b", "c"];

// --- tile math (Web Mercator) ---
function lonToTile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function latToTile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}

function featureBbox(feature) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (coords) => {
    if (typeof coords?.[0] === "number" && typeof coords?.[1] === "number") {
      const [lon, lat] = coords;
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
      return;
    }
    for (const child of coords ?? []) visit(child);
  };
  visit(feature.geometry.coordinates);
  return [west, south, east, north];
}

function tilesForZoom(z, [w, s, e, n]) {
  const x0 = lonToTile(w, z);
  const x1 = lonToTile(e, z);
  const y0 = latToTile(n, z); // top
  const y1 = latToTile(s, z); // bottom
  const out = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- plan ---
const plan = [];
for (let z = zMin; z <= zMax; z++) {
  plan.push(...tilesForZoom(z, bbox));
}
console.log(
  `Plan: ${plan.length} tiles total for bbox=${bboxKey} zooms=${zMin}-${zMax}`
);
const byZoom = {};
for (const t of plan) byZoom[t.z] = (byZoom[t.z] || 0) + 1;
for (const z of Object.keys(byZoom).sort((a, b) => +a - +b)) {
  console.log(`  z${z}: ${byZoom[z]} tiles`);
}
console.log(
  `At ${DELAY_MS}ms/req ≈ ${Math.ceil((plan.length * DELAY_MS) / 60000)} min`
);

// --- download ---
let done = 0,
  skipped = 0,
  failed = 0;

for (const { z, x, y } of plan) {
  const dir = path.join(TILE_DIR, String(z), String(x));
  const file = path.join(dir, `${y}.png`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    skipped++;
    done++;
    continue;
  }
  fs.mkdirSync(dir, { recursive: true });
  const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  const url = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://www.openstreetmap.org/",
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    done++;
    if (done % 25 === 0) {
      console.log(
        `  ${done}/${plan.length} (${skipped} cached, ${failed} failed) — last z${z}/${x}/${y}`
      );
    }
  } catch (err) {
    failed++;
    console.warn(`  fail z${z}/${x}/${y}: ${err.message}`);
  }
  await sleep(DELAY_MS);
}

console.log(
  `\nDone. Downloaded ${done - skipped}, cached ${skipped}, failed ${failed}.`
);
console.log(`Tiles in: ${TILE_DIR}`);
