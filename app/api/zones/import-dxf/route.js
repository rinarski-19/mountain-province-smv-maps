// POST /api/zones/import-dxf?slug=<municipality>
//
// Accepts a multipart upload with a `dxf` field (the LGU's AutoCAD file),
// runs scripts/dxf-to-geojson.py against it, and writes the resulting
// FeatureCollection to public/data/<slug>_zones[_dxf].geojson — the same
// target the matching slug's "Save to project" flow writes to.
//
// IMPORTANT — local dev only.
// The converter is Python (ezdxf + pyproj + shapely). Vercel functions
// don't have a Python runtime, so this endpoint returns 501 in
// production. The deployed pipeline for DXF refreshes is:
//   1. Coworker runs `npm run dev` locally
//   2. Uploads the DXF through the in-app "Import DXF…" button
//   3. Reviews the result in /?m=<slug>-dxf
//   4. Commits & pushes the new public/data/<slug>_zones_dxf.geojson
// Vercel re-deploys; every browser sees the refreshed DXF preview.
//
// Auth: same as /api/zones/save — SAVE_PASSWORD must match if set.
// On localhost without SAVE_PASSWORD configured, writes are allowed
// without a token so first-time setup isn't blocked.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

// Which file each slug's DXF upload should land in. Mirrors the
// TARGETS_BY_SLUG map in /api/zones/save — anything saveable should
// also be DXF-importable, since the result is just a fresh GeoJSON.
//
// Add a row here when a new municipality is wired up; no other code
// change is needed for the importer to work.
const TARGETS_BY_SLUG = {
  bauko: "bauko_zones.geojson",
  "bauko-dxf": "bauko_zones_dxf.geojson",
  barlig: "barlig_zones.geojson",
  tadian: "tadian_zones.geojson",
  sagada: "sagada_zones.geojson",
  "sagada-dxf": "sagada_zones_dxf.geojson",
  bontoc: "bontoc_zones.geojson",
  "bontoc-dxf": "bontoc_zones_dxf.geojson",
};

function authorize(request) {
  const expected = process.env.SAVE_PASSWORD;
  if (!expected) return process.env.NODE_ENV === "development";
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === expected;
}

export async function POST(request) {
  // Hard gate: DXF conversion needs Python; that doesn't exist on
  // serverless runtimes. Coworkers run this locally, then commit.
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      {
        ok: false,
        error:
          "DXF import is only available in local development (the Python " +
          "converter isn't available on the deployed server). Run " +
          "`npm run dev` locally, import there, then commit the resulting " +
          "GeoJSON.",
      },
      { status: 501 }
    );
  }

  if (!authorize(request)) {
    return Response.json(
      { ok: false, error: "Unauthorized — set Authorization: Bearer <password>." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("slug") || "").toLowerCase();
  const fileName = TARGETS_BY_SLUG[slug];
  if (!fileName) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  // Parse the multipart payload. Next.js exposes the standard Web
  // Fetch API here, so request.formData() works the same as in a
  // browser — File objects come back with .name, .arrayBuffer(), etc.
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return Response.json(
      { ok: false, error: `Could not parse upload: ${e.message}` },
      { status: 400 }
    );
  }
  const file = form.get("dxf");
  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json(
      { ok: false, error: "Missing `dxf` file in upload." },
      { status: 400 }
    );
  }
  if (!file.name || !file.name.toLowerCase().endsWith(".dxf")) {
    return Response.json(
      { ok: false, error: "Upload must be a .dxf file." },
      { status: 400 }
    );
  }

  // Stash the DXF in a temp file so the Python script can read it
  // from disk. ezdxf doesn't accept stdin, and we don't want a 70MB
  // string sitting in the Node heap.
  const tempDir = os.tmpdir();
  const stamp = Date.now();
  const tempPath = path.join(tempDir, `dxf-import-${slug}-${stamp}.dxf`);
  const targetPath = path.join(process.cwd(), "public", "data", fileName);
  const scriptPath = path.join(process.cwd(), "scripts", "dxf-to-geojson.py");

  let runResult;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tempPath, buf);
    runResult = await runConverter(scriptPath, tempPath, targetPath);
  } catch (e) {
    return Response.json(
      { ok: false, error: `Conversion failed: ${e.message}` },
      { status: 500 }
    );
  } finally {
    // Best-effort cleanup. Don't blow up the response if the unlink
    // fails (e.g. virus scanner has a transient lock).
    fs.unlink(tempPath).catch(() => {});
  }

  // Read back the resulting GeoJSON so we can report a class breakdown
  // to the caller — gives the UI something to display without making
  // it re-parse the file.
  let featureCount = 0;
  const classCounts = {};
  try {
    const written = JSON.parse(await fs.readFile(targetPath, "utf8"));
    if (Array.isArray(written.features)) {
      featureCount = written.features.length;
      for (const f of written.features) {
        const cls = f?.properties?.classification ?? "UNCLASSIFIED";
        classCounts[cls] = (classCounts[cls] ?? 0) + 1;
      }
    }
  } catch {}

  return Response.json({
    ok: true,
    backend: "local-fs",
    path: `public/data/${fileName}`,
    inputName: file.name,
    inputBytes: file.size ?? null,
    featureCount,
    classCounts,
    converterLog: runResult.log,
  });
}

// Spawn the Python converter and wait for it to finish. We resolve
// with stdout (which has the class breakdown) on success, and reject
// with stderr + exit code on failure.
function runConverter(scriptPath, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, inputPath, outputPath], {
      cwd: process.cwd(),
      // Inherit env so any pyenv shim resolves correctly.
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) =>
      reject(new Error(`Could not start python3: ${e.message}`))
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ log: stdout + (stderr ? `\n[stderr]\n${stderr}` : "") });
      } else {
        const tail = (stderr || stdout).split("\n").slice(-12).join("\n");
        reject(new Error(`python3 exited with ${code}:\n${tail}`));
      }
    });
  });
}

// Give the conversion enough wall-clock time. Bontoc takes ~3s; bigger
// LGU files have hit 20s+. App Router handles body parsing via the
// standard Web Fetch API (request.formData()) so no body-parser config
// needed — the dev server happily accepts the larger LGU DXFs we've
// seen (Bontoc ~71 MB, Sagada ~30 MB).
export const maxDuration = 120;
