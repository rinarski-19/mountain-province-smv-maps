// scripts/build-static.mjs
//
// Produce a static-export build of leaflet-test-app, suitable for
// copying to a USB stick and opening from file://. The Next.js
// `output: "export"` mode doesn't support API route handlers, so we
// temporarily move app/api out of the way for the build, then move
// it back (even if the build crashes mid-way).
//
// Usage: pnpm build:static
// Output: ./out/
//
// What the static export contains:
//   - The full Leaflet map UI (read-only on the viewer side; the
//     editor toolbar is still there but its Save buttons will 404
//     because /api/* is gone)
//   - All GeoJSON, SMV reference data, saved-views JSON, tile pack
//   - Everything under public/ including the launcher scripts
//
// To use on the USB target machine:
//   - macOS: right-click "Open Map (Mac).command" -> Open
//   - Windows: double-click "Open Map (Windows).bat"

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_LIVE = path.join(ROOT, "app", "api");
const API_HIDDEN = path.join(ROOT, "app", "_api_hidden_during_static_build");

function moveDir(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.renameSync(from, to);
  return true;
}

function runNextBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn("next", ["build"], {
      stdio: "inherit",
      env: { ...process.env, STATIC_EXPORT: "1" },
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next build exited with code ${code}`));
    });
  });
}

async function main() {
  let hid = false;
  try {
    if (fs.existsSync(API_HIDDEN)) {
      // Leftover from a previous crashed run, restore it first.
      console.warn(
        "Found leftover app/_api_hidden_during_static_build, restoring before build."
      );
      if (fs.existsSync(API_LIVE)) {
        throw new Error(
          "Both app/api and app/_api_hidden_during_static_build exist; refusing to overwrite. Resolve manually."
        );
      }
      fs.renameSync(API_HIDDEN, API_LIVE);
    }

    hid = moveDir(API_LIVE, API_HIDDEN);
    if (hid) {
      console.log("Hid app/api for static export.");
    } else {
      console.log("No app/api directory found, nothing to hide.");
    }

    await runNextBuild();
    console.log(
      "\nStatic export complete. Output at ./out/. To use on a USB target:"
    );
    console.log("  1. Copy the entire `out/` folder to the USB stick.");
    console.log("  2. On Mac: right-click `Open Map (Mac).command` -> Open.");
    console.log("  3. On Windows: double-click `Open Map (Windows).bat`.");
  } catch (e) {
    console.error("\nStatic build failed:", e.message);
    process.exitCode = 1;
  } finally {
    if (hid && fs.existsSync(API_HIDDEN)) {
      fs.renameSync(API_HIDDEN, API_LIVE);
      console.log("Restored app/api.");
    }
  }
}

main();
