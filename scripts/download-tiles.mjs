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
//   node scripts/download-tiles.mjs --provider mapbox --bbox mp --zooms 10-14

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

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
const RETRIES = parseInt(arg("retries", "4"), 10);
const RETRY_DELAY_MS = parseInt(arg("retry-delay", "2500"), 10);
const TIMEOUT_MS = parseInt(arg("timeout", "20000"), 10);
const USER_AGENT =
  arg("ua", null) ||
  "BaukoLandValuationApp/0.1 (+https://github.com/local-dev/leaflet-test-app)";
const PROVIDER = (arg("provider", "osm") || "osm").toLowerCase();
const MAPBOX_TOKEN = arg("token", process.env.MAPBOX_TOKEN || "");
const MAPBOX_STYLE = arg("mapbox-style", "mapbox/satellite-streets-v12");
const MAPBOX_TILE_SIZE = parseInt(arg("mapbox-tile-size", "256"), 10);
const MAPBOX_HIDPI = args.includes("--mapbox-hidpi");
const MAPBOX_FORMAT = arg("mapbox-format", "png");
const SMART_FROM_ZOOM = parseInt(arg("smart-from-zoom", "-1"), 10);
const SMART_SOURCES = new Set(
  String(arg("smart-sources", "zones,frontage,roads"))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const SMART_MARGIN_DEG = parseFloat(arg("smart-margin-deg", "0.0007"));
const OUTPUT_DIR_ARG = arg("out-dir", "");
const DEFAULT_TILE_DIR =
  PROVIDER === "mapbox"
    ? path.join(ROOT, "public", "tiles-mapbox-hidpi")
    : path.join(ROOT, "public", "tiles");
const TILE_DIR = OUTPUT_DIR_ARG
  ? path.resolve(ROOT, OUTPUT_DIR_ARG)
  : DEFAULT_TILE_DIR;

const SUBDOMAINS = ["a", "b", "c"];

if (!["osm", "mapbox"].includes(PROVIDER)) {
  console.error(`Unknown --provider '${PROVIDER}'. Use: osm, mapbox`);
  process.exit(1);
}
if (PROVIDER === "mapbox" && !MAPBOX_TOKEN) {
  console.error(
    "Mapbox provider requires a token. Pass --token <MAPBOX_TOKEN> or set MAPBOX_TOKEN in your environment."
  );
  process.exit(1);
}

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

function tileToBbox({ z, x, y }) {
  const scale = Math.pow(2, z);
  const west = (x / scale) * 360 - 180;
  const east = ((x + 1) / scale) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / scale))) * 180) /
    Math.PI;
  return [west, south, east, north];
}

function bboxesIntersect(a, b) {
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

function expandBy([w, s, e, n], delta = 0) {
  if (!delta || !Number.isFinite(delta) || delta <= 0) return [w, s, e, n];
  return [w - delta, s - delta, e + delta, n + delta];
}

function readGeojsonBboxes(filePath, marginDeg = 0) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const gj = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const features = Array.isArray(gj?.features)
      ? gj.features
      : gj?.type === "Feature"
        ? [gj]
        : [];
    const out = [];
    for (const feature of features) {
      if (!feature?.geometry) continue;
      out.push(expandBy(featureBbox(feature), marginDeg));
    }
    return out;
  } catch (e) {
    console.warn(`Could not parse ${filePath}: ${e.message}`);
    return [];
  }
}

function buildSmartMaskBboxes(key) {
  const base = path.join(ROOT, "public", "data");
  const collected = [];

  if (SMART_SOURCES.has("zones")) {
    collected.push(
      ...readGeojsonBboxes(path.join(base, `${key}_zones.geojson`), SMART_MARGIN_DEG)
    );
  }
  if (SMART_SOURCES.has("frontage")) {
    collected.push(
      ...readGeojsonBboxes(
        path.join(base, `${key}_frontage_bands.geojson`),
        SMART_MARGIN_DEG
      )
    );
  }
  if (SMART_SOURCES.has("roads")) {
    collected.push(
      ...readGeojsonBboxes(path.join(base, `${key}_osm_roads.geojson`), SMART_MARGIN_DEG)
    );
  }
  if (collected.length > 0) return collected;

  // Fallback: avoid empty smart plan by clipping to municipality boundary
  // if available; still much lighter than full province downloads.
  const muniOutline = path.join(base, `${key}.geojson`);
  const fallback = readGeojsonBboxes(muniOutline, SMART_MARGIN_DEG);
  if (fallback.length > 0) return fallback;

  return [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTile(url, headers) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (attempt >= RETRIES) break;
      const wait = RETRY_DELAY_MS * Math.pow(1.6, attempt);
      await sleep(wait);
    }
  }
  throw lastError;
}

// --- plan ---
const plan = [];
const allByZoom = {};
const clippedByZoom = {};
const useSmart = Number.isFinite(SMART_FROM_ZOOM) && SMART_FROM_ZOOM >= zMin;
const smartMaskBboxes = useSmart ? buildSmartMaskBboxes(bboxKey) : [];
for (let z = zMin; z <= zMax; z++) {
  const tiles = tilesForZoom(z, bbox);
  allByZoom[z] = tiles.length;
  if (!useSmart || z < SMART_FROM_ZOOM || smartMaskBboxes.length === 0) {
    plan.push(...tiles);
    clippedByZoom[z] = tiles.length;
    continue;
  }
  const clipped = tiles.filter((tile) => {
    const tileBox = tileToBbox(tile);
    return smartMaskBboxes.some((mask) => bboxesIntersect(tileBox, mask));
  });
  plan.push(...clipped);
  clippedByZoom[z] = clipped.length;
}
console.log(
  `Plan: ${plan.length} tiles total for provider=${PROVIDER} bbox=${bboxKey} zooms=${zMin}-${zMax}`
);
for (const z of Object.keys(clippedByZoom).sort((a, b) => +a - +b)) {
  const full = allByZoom[z];
  const clipped = clippedByZoom[z];
  if (useSmart && +z >= SMART_FROM_ZOOM && smartMaskBboxes.length > 0) {
    console.log(`  z${z}: ${clipped} tiles (smart from ${full})`);
  } else {
    console.log(`  z${z}: ${clipped} tiles`);
  }
}
if (useSmart) {
  if (smartMaskBboxes.length > 0) {
    console.log(
      `Smart clipping: enabled from z${SMART_FROM_ZOOM} using ${
        smartMaskBboxes.length
      } mask bboxes (${[...SMART_SOURCES].join(",")}).`
    );
  } else {
    console.log(
      `Smart clipping requested from z${SMART_FROM_ZOOM}, but no masks found for '${bboxKey}'. Falling back to full bbox tiles.`
    );
  }
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
  const osmUrl = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const mapboxSuffix = MAPBOX_HIDPI ? "@2x" : "";
  const mapboxUrl =
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/${MAPBOX_TILE_SIZE}/${z}/${x}/${y}` +
    `${mapboxSuffix}?access_token=${encodeURIComponent(MAPBOX_TOKEN)}` +
    `&logo=false&attribution=false&format=${encodeURIComponent(MAPBOX_FORMAT)}`;
  const url = PROVIDER === "mapbox" ? mapboxUrl : osmUrl;
  try {
    const headers = {
      "User-Agent": USER_AGENT,
      ...(PROVIDER === "osm"
        ? { Referer: "https://www.openstreetmap.org/" }
        : {}),
    };
    const buf = await downloadTile(url, headers);
    const tmpFile = `${file}.tmp`;
    fs.writeFileSync(tmpFile, buf);
    fs.renameSync(tmpFile, file);
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
