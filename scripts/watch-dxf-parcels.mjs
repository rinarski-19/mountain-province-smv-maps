#!/usr/bin/env node

/**
 * Watch an AutoCAD DXF and keep the web-map parcel GeoJSON in sync.
 *
 * Bauko is intentionally configured here with the same layer list used by
 * the manual import command in COMMANDS.md. The watcher never exports a new
 * CAD file; that remains the final step after the drawing is approved.
 *
 * Usage:
 *   npm run parcels:watch:bauko
 *   node scripts/watch-dxf-parcels.mjs bauko --dxf "C:\\maps\\Bauko projection map 2023.dxf"
 *   node scripts/watch-dxf-parcels.mjs bauko --once
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slug = process.argv[2] || "bauko";
const args = process.argv.slice(3);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

const once = args.includes("--once");
const python = option(
  "--python",
  process.platform === "win32" ? "py" : "python3"
);
const defaultDxfPath =
  process.env.DXF_BAUKO_PATH ||
  (process.platform === "win32"
    ? "Z:\\projection\\Bauko projection map 2023.dxf"
    : "/Users/rinar/Documents/shared/projection/Bauko projection map 2023.dxf");
const dxfPath = path.resolve(option("--dxf", defaultDxfPath));

if (slug !== "bauko") {
  console.error(`This watcher currently supports bauko only, not ${slug}.`);
  process.exit(1);
}

const parcelOutput = path.join(projectRoot, "public/data/bauko_parcels.geojson");
const parcelRevisionOutput = path.join(
  projectRoot,
  "public/data/bauko_parcels.watch.json"
);
const labelledOutput = path.join(
  projectRoot,
  "exports/bauko_labelled_parcels.geojson"
);
const clipBoundary = path.join(
  projectRoot,
  "public/data/bauko_dxf_municipality.geojson"
);
const importer = path.join(projectRoot, "scripts/dxf-parcels-to-geojson.py");
const labelFilter = path.join(projectRoot, "scripts/filter-parcels-by-dxf-labels.py");

const layers = [
  "MPV LOTS",
  "declared property",
  "UNDECLARED",
  "FLOT",
  "FORPROJECTION",
  "0",
  "200",
  "LOT Lines",
  "bdry",
];
const polygonizeLayers = [
  "declcared property",
  "0",
  "200",
  "LOT Lines",
  "FLOT",
];
const lineLayers = ["0", "declared property"];

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function importParcels() {
  if (!fs.existsSync(dxfPath)) {
    throw new Error(`DXF not found: ${dxfPath}`);
  }
  if (!fs.existsSync(clipBoundary)) {
    throw new Error(`DXF clip boundary not found: ${clipBoundary}`);
  }

  const importerArgs = [importer, dxfPath, parcelOutput];
  for (const layer of layers) importerArgs.push("--layer", layer);
  for (const layer of polygonizeLayers) {
    importerArgs.push("--polygonize-layer", layer);
  }
  for (const layer of lineLayers) {
    importerArgs.push("--line-layer", layer);
  }
  importerArgs.push("--closed-only", "--clip-to", clipBoundary);

  console.log(`\n[parcel watcher] Importing ${path.basename(dxfPath)} …`);
  await run(python, importerArgs);
  await run(python, [labelFilter, parcelOutput, dxfPath, labelledOutput]);
  fs.writeFileSync(
    parcelRevisionOutput,
    JSON.stringify({ updatedAt: new Date().toISOString() }) + "\n",
    "utf8"
  );
  console.log("[parcel watcher] Parcel data is ready. The browser will reload it automatically.");
}

let running = false;
let queued = false;
let timer = null;

async function scheduleImport() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await importParcels();
  } catch (error) {
    console.error(`[parcel watcher] ${error.message}`);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      scheduleImport();
    }
  }
}

await scheduleImport();
if (once) process.exit(0);

const watchedDirectory = path.dirname(dxfPath);
if (!fs.existsSync(watchedDirectory)) {
  throw new Error(`DXF directory not found: ${watchedDirectory}`);
}

console.log(`[parcel watcher] Watching ${dxfPath}`);
console.log(
  "[parcel watcher] Polling for changes every second. Save the DXF in AutoCAD to reimport it."
);

// AutoCAD is saving through an SMB shared folder. On macOS, fs.watch can miss
// file events that originate from another computer, so compare the file's
// metadata instead. This works for both local files and shared files.
function sourceSignature() {
  try {
    const stat = fs.statSync(dxfPath);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino ?? ""}`;
  } catch {
    return null;
  }
}

let lastSourceSignature = sourceSignature();
const poller = setInterval(() => {
  const currentSignature = sourceSignature();
  if (!currentSignature || currentSignature === lastSourceSignature) return;
  lastSourceSignature = currentSignature;
  clearTimeout(timer);
  timer = setTimeout(scheduleImport, 700);
}, 1000);

function stop() {
  clearInterval(poller);
  clearTimeout(timer);
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
