#!/usr/bin/env node
// Batch wrapper around download-tiles.mjs:
// downloads each Mountain Province municipality bbox in sequence.
//
// Usage examples:
//   node scripts/download-all-tiles.mjs --provider osm --zooms 10-16
//   MAPBOX_TOKEN=... node scripts/download-all-tiles.mjs --provider mapbox --zooms 10-18 --mapbox-hidpi

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function arg(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const PROVIDER = (arg("provider", "osm") || "osm").toLowerCase();
const ZOOMS = arg("zooms", PROVIDER === "mapbox" ? "10-18" : "10-16");
const DELAY = arg("delay", "");
const OUT_DIR = arg("out-dir", "");
const MAPBOX_STYLE = arg("mapbox-style", "mapbox/satellite-streets-v12");
const MAPBOX_TILE_SIZE = arg("mapbox-tile-size", "256");
const MAPBOX_FORMAT = arg("mapbox-format", "png");
const MAPBOX_TOKEN = arg("token", process.env.MAPBOX_TOKEN || "");
const MAPBOX_HIDPI = hasFlag("mapbox-hidpi");
const SMART_FROM_ZOOM = arg("smart-from-zoom", "");
const SMART_SOURCES = arg("smart-sources", "");
const SMART_MARGIN_DEG = arg("smart-margin-deg", "");

if (!["osm", "mapbox"].includes(PROVIDER)) {
  console.error(`Unknown --provider '${PROVIDER}'. Use: osm, mapbox`);
  process.exit(1);
}
if (PROVIDER === "mapbox" && !MAPBOX_TOKEN) {
  console.error(
    "Mapbox mode requires MAPBOX_TOKEN (env) or --token <value>."
  );
  process.exit(1);
}

function keyForName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readMunicipalityKeys() {
  const file = path.join(
    ROOT,
    "public",
    "data",
    "mountain_province_municipalities.geojson"
  );
  const gj = JSON.parse(fs.readFileSync(file, "utf8"));
  const keys = new Set();
  for (const feature of gj.features ?? []) {
    const name = feature?.properties?.name;
    if (!name) continue;
    keys.add(keyForName(name));
  }
  return [...keys].sort();
}

function runDownloadForKey(key) {
  return new Promise((resolve, reject) => {
    const cmd = [
      path.join("scripts", "download-tiles.mjs"),
      "--provider",
      PROVIDER,
      "--bbox",
      key,
      "--zooms",
      ZOOMS,
    ];
    if (DELAY) cmd.push("--delay", DELAY);
    if (OUT_DIR) cmd.push("--out-dir", OUT_DIR);
    if (PROVIDER === "mapbox") {
      cmd.push("--token", MAPBOX_TOKEN);
      cmd.push("--mapbox-style", MAPBOX_STYLE);
      cmd.push("--mapbox-tile-size", MAPBOX_TILE_SIZE);
      cmd.push("--mapbox-format", MAPBOX_FORMAT);
      if (MAPBOX_HIDPI) cmd.push("--mapbox-hidpi");
    }
    if (SMART_FROM_ZOOM) cmd.push("--smart-from-zoom", SMART_FROM_ZOOM);
    if (SMART_SOURCES) cmd.push("--smart-sources", SMART_SOURCES);
    if (SMART_MARGIN_DEG) cmd.push("--smart-margin-deg", SMART_MARGIN_DEG);

    console.log(`\n=== ${key.toUpperCase()} (${PROVIDER}, z${ZOOMS}) ===`);
    const child = spawn("node", cmd, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`download failed for ${key} (exit ${code})`));
    });
  });
}

const keys = readMunicipalityKeys();
console.log(
  `Batch download: ${keys.length} municipalities (${keys.join(", ")})`
);

for (const key of keys) {
  // eslint-disable-next-line no-await-in-loop
  await runDownloadForKey(key);
}

console.log("\nAll municipality downloads completed.");
