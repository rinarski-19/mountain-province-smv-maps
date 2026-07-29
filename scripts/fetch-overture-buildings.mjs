#!/usr/bin/env node
// Pull Overture Maps building polygons for a municipality, tag each with the
// barangay it lies in, and write:
//   public/data/<slug>_overture_buildings.geojson
//
// The print SVG builder prefers this file when present, then falls back to
// public/data/<slug>_osm_buildings.geojson. This keeps Overture testing
// reversible and avoids overwriting the OSM-derived building layer.
//
// Prerequisite:
//   python3 -m pip install overturemaps
//
// Usage:
//   npm run buildings:overture -- besao
//   npm run buildings:overture -- barlig --by-barangay
//   node scripts/fetch-overture-buildings.mjs besao
//
// Optional env:
//   OVERTUREMAPS_BIN=/path/to/overturemaps
//   OVERTUREMAPS_PYTHONPATH=/path/to/python/site-packages
//   OVERTURE_RELEASE=2026-06-17.0
//
// Network options:
//   --retries=5
//   --retry-delay-ms=3000
//   --skip-failed

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const MIN_AREA_M2 = 8;

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

function commandPath(command) {
  if (!command) return null;
  if (command.includes("/") && fs.existsSync(command)) return command;
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findOvertureCli() {
  const candidates = [
    process.env.OVERTUREMAPS_BIN,
    "overturemaps",
    // Convenience for Codex/dev sessions that install the client into /tmp.
    "/private/tmp/overturemaps-py/bin/overturemaps",
  ];
  for (const candidate of candidates) {
    const resolved = commandPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function bboxString(feature) {
  return turf.bbox(feature).join(",");
}

function featureId(feature) {
  const props = feature?.properties ?? {};
  return (
    props.id ??
    props.gers_id ??
    props.names?.primary ??
    feature?.id ??
    null
  );
}

function buildingKind(feature) {
  const props = feature?.properties ?? {};
  return props.subtype ?? props.class ?? props.building ?? "building";
}

function cliValue(args, name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
}

function numberCliValue(args, name, fallback) {
  const parsed = Number(cliValue(args, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const slug = (cliArgs.find((arg) => !arg.startsWith("--")) || "").toLowerCase();
  const byBarangayDownload = cliArgs.includes("--by-barangay");
  const retries = Math.max(0, Math.floor(numberCliValue(cliArgs, "--retries", 4)));
  const retryDelayMs = Math.max(
    0,
    Math.floor(numberCliValue(cliArgs, "--retry-delay-ms", 2500))
  );
  const skipFailed = cliArgs.includes("--skip-failed");
  const cfg = MUNICIPALITY_CONFIG[slug];
  if (!cfg) {
    console.error(
      `Unknown municipality slug: ${slug || "(missing)"}\n` +
        `Known: ${Object.keys(MUNICIPALITY_CONFIG).join(", ")}`
    );
    process.exit(1);
  }

  const overtureCli = findOvertureCli();
  if (!overtureCli) {
    console.error(
      "Could not find the `overturemaps` CLI.\n\n" +
        "Install it with:\n" +
        "  python3 -m pip install overturemaps\n\n" +
        "Or point to it with OVERTUREMAPS_BIN=/path/to/overturemaps"
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
  for (const file of [outlinePath, barangaysPath]) {
    if (!fs.existsSync(file)) {
      console.error(
        `Missing ${file}. Run \`npm run boundaries:fetch:${slug}\` first.`
      );
      process.exit(1);
    }
  }

  const outlineFeature = readJson(outlinePath).features?.[0];
  const barangaysFC = readJson(barangaysPath);
  if (!outlineFeature) throw new Error(`Empty outline file: ${outlinePath}`);

  const barangaysWithSlugs = (barangaysFC.features || [])
    .map((feature) => {
      const name = feature.properties?.name;
      const barangaySlug = name ? slugForName(name) : null;
      return barangaySlug ? { feature, slug: barangaySlug, name } : null;
    })
    .filter(Boolean);
  console.log(`Loaded ${barangaysWithSlugs.length} barangay polygons.`);

  const release = process.env.OVERTURE_RELEASE || "2026-06-17.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${slug}-overture-`));

  const env = {
    ...process.env,
    ...(process.env.OVERTUREMAPS_PYTHONPATH
      ? { PYTHONPATH: process.env.OVERTUREMAPS_PYTHONPATH }
      : {}),
  };
  // If the temporary Codex install is being used, make its target directory
  // importable by the CLI script.
  if (
    overtureCli.startsWith("/private/tmp/overturemaps-py/") &&
    !env.PYTHONPATH
  ) {
    env.PYTHONPATH = "/private/tmp/overturemaps-py";
  }

  console.log(`Release: ${release}`);

  async function downloadBbox(downloadBbox, outputPath, label) {
    const args = [
      "download",
      `--bbox=${downloadBbox}`,
      "-f",
      "geojson",
      "--type=building",
      `--release=${release}`,
      "--no-stac",
      "-o",
      outputPath,
    ];
    let lastStatus = null;
    let lastError = null;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const attemptSuffix =
        retries > 0 ? ` (attempt ${attempt}/${retries + 1})` : "";
      console.log(
        `Downloading Overture buildings for ${label} bbox ${downloadBbox}${attemptSuffix}…`
      );
      const result = spawnSync(overtureCli, args, {
        cwd: ROOT,
        env,
        encoding: "utf8",
        stdio: ["ignore", "inherit", "inherit"],
      });
      lastStatus = result.status;
      lastError = result.error;
      if (result.status === 0) {
        const downloaded = readJson(outputPath);
        return Array.isArray(downloaded.features) ? downloaded.features : [];
      }
      if (attempt <= retries && retryDelayMs > 0) {
        console.warn(
          `  ${label}: download failed with exit code ${result.status}; retrying in ${retryDelayMs}ms…`
        );
        await wait(retryDelayMs);
      }
    }
    const reason = lastError
      ? `${lastError.message}`
      : `exit code ${lastStatus}`;
    throw new Error(`overturemaps download failed for ${label} after ${retries + 1} attempt(s): ${reason}.`);
  }

  let incoming = [];
  const failedDownloads = [];
  if (byBarangayDownload) {
    const deduped = new Map();
    for (const [index, barangay] of barangaysWithSlugs.entries()) {
      const barangayBbox = bboxString(barangay.feature);
      const tmpGeojson = path.join(
        tmpDir,
        `${slug}_${barangay.slug}_overture.geojson`
      );
      const label = `${slug}/${barangay.name} [${index + 1}/${barangaysWithSlugs.length}]`;
      let features = [];
      try {
        features = await downloadBbox(barangayBbox, tmpGeojson, label);
      } catch (error) {
        failedDownloads.push({ label, error: error.message });
        if (!skipFailed) throw error;
        console.warn(`  Skipping ${label}: ${error.message}`);
        continue;
      }
      console.log(`  ${barangay.name}: ${features.length} bbox features`);
      for (const feature of features) {
        const key =
          featureId(feature) ??
          JSON.stringify(feature?.geometry ?? feature ?? {});
        if (!deduped.has(key)) deduped.set(key, feature);
      }
    }
    incoming = [...deduped.values()];
    console.log(`Downloaded ${incoming.length} deduped building features.`);
  } else {
    const bbox = bboxString(outlineFeature);
    const tmpGeojson = path.join(tmpDir, `${slug}_overture_bbox.geojson`);
    incoming = await downloadBbox(bbox, tmpGeojson, slug);
    console.log(`Downloaded ${incoming.length} bbox building features.`);
  }

  const outputFeatures = [];
  let dropSmall = 0;
  let dropOutside = 0;
  let dropMalformed = 0;

  for (const feature of incoming) {
    if (!feature?.geometry) {
      dropMalformed++;
      continue;
    }
    let areaM2 = 0;
    let centroid = null;
    try {
      areaM2 = turf.area(feature);
      centroid = turf.centroid(feature);
    } catch {
      dropMalformed++;
      continue;
    }
    if (areaM2 < MIN_AREA_M2) {
      dropSmall++;
      continue;
    }

    let assignedBarangay = null;
    for (const barangay of barangaysWithSlugs) {
      try {
        if (turf.booleanPointInPolygon(centroid, barangay.feature)) {
          assignedBarangay = barangay;
          break;
        }
      } catch {}
    }
    if (!assignedBarangay) {
      dropOutside++;
      continue;
    }

    outputFeatures.push({
      type: "Feature",
      properties: {
        ...(feature.properties ?? {}),
        source: "overture",
        barangay_slug: assignedBarangay.slug,
        barangay_name: assignedBarangay.name,
        overture_id: featureId(feature),
        building: buildingKind(feature),
        area_m2: Math.round(areaM2),
      },
      geometry: feature.geometry,
    });
  }

  const outPath = path.join(PUBLIC_DATA, `${slug}_overture_buildings.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features: outputFeatures }) +
      "\n"
  );

  const byBarangay = {};
  for (const feature of outputFeatures) {
    const key = feature.properties?.barangay_slug ?? "unknown";
    byBarangay[key] = (byBarangay[key] || 0) + 1;
  }

  console.log(
    `Wrote ${outPath} — ${outputFeatures.length} buildings.\n` +
      `(dropped ${dropSmall} too-small, ${dropOutside} outside-barangays, ${dropMalformed} malformed)`
  );
  if (failedDownloads.length) {
    console.warn(
      `Skipped ${failedDownloads.length} failed barangay download(s): ` +
        failedDownloads.map((item) => item.label).join(", ")
    );
  }
  console.log("By barangay:", byBarangay);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
