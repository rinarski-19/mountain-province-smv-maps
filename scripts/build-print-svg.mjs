#!/usr/bin/env node
// CLI wrapper around lib/print-svg-builder.js. Generates print SVG(s)
// for a municipality and writes them to public/print/.
//
// All the actual SVG logic lives in lib/print-svg-builder.js so the API
// routes (app/api/print/svg/[slug]/route.js and
// app/api/print/svg/[slug]/[barangay]/route.js) can share it.
//
// Usage:
//   node scripts/build-print-svg.mjs <slug>
//     Whole-municipality sheet, unchanged from before — writes
//     public/print/<slug>.svg. This is what every `npm run print:svg:*`
//     script (and the `prebuild` chain) already calls with no barangay
//     arg, so that behavior is untouched.
//
//   node scripts/build-print-svg.mjs <slug> <barangay-slug>
//     One barangay, cropped to its own extent (see buildSvg's
//     barangayName option) — writes public/print/<slug>/<barangay-slug>.svg.
//     <barangay-slug> is the same slug used everywhere else in the app
//     (search, sidebar, saved views) — see schedule.barangays in
//     lib/municipalities.js.
//
//   node scripts/build-print-svg.mjs <slug> all
//     Every barangay for that slug, each to its own file under
//     public/print/<slug>/. Opt-in — omitting the barangay arg still
//     means "whole municipality", not "all barangays", so this never
//     silently changes what `npm run build`'s prebuild chain produces.
//
//   Add [--smv-buffer N] to any of the above.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSvgForSlug, PAPER_W_MM, PAPER_H_MM } from "../lib/print-svg-builder.js";
import { getMunicipalityConfig } from "../lib/municipalities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const PUBLIC_PRINT = path.join(ROOT, "public", "print");

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJsonOptional(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Resolves a barangay slug (from schedule.barangays / schedule.getBarangayBySlug)
// to the EXACT properties.name string in <slug>_barangays.geojson, using the
// LGU's own alias-aware slugForName() — the same approach the
// app/api/print/svg/[slug]/[barangay]/route.js route uses. Needed because the
// schedule's canonical name doesn't always match the boundary file's spelling
// verbatim (e.g. Besao's "Kin-iway" vs. the boundary file's "Kin-iway (Pob.)").
function resolveBarangayName(slug, barangaySlug) {
  const config = getMunicipalityConfig(slug);
  const schedule = config?.schedule;
  const target = schedule?.getBarangayBySlug?.(barangaySlug);
  if (!target) {
    const valid = (schedule?.barangays ?? []).map((b) => b.slug).join(", ");
    throw new Error(`Unknown barangay slug "${barangaySlug}" for ${slug}. Valid: ${valid}`);
  }
  const barangaysGeo = readJsonOptional(
    path.join(PUBLIC_DATA, `${slug}_barangays.geojson`)
  );
  const match = (barangaysGeo?.features ?? []).find(
    (f) => schedule.slugForName?.(f.properties?.name) === target.slug
  );
  if (!match) {
    throw new Error(
      `Barangay boundary for "${target.name}" (${target.slug}) not found in ` +
        `${slug}_barangays.geojson — likely a name mismatch between the LGU ` +
        `schedule and the PSA boundary data. Check slugForName() aliases in lib/${slug}.js.`
    );
  }
  return { slug: target.slug, name: match.properties.name };
}

function logZonesSummary(zonesSummary) {
  if (!zonesSummary) return;
  const summary = Object.entries(zonesSummary.byClass)
    .sort()
    .map(([k, n]) => `${k}:${n}`)
    .join("  ");
  console.log(`  Zones rendered (${zonesSummary.rendered}): ${summary}`);
  if (zonesSummary.widened) {
    console.log(
      `  Render-widened: ${zonesSummary.widened} ribbon zones ` +
        `(+${zonesSummary.effectiveRibbonBufferM ?? zonesSummary.smvBufferM} m per side at print only).`
    );
  }
  if (zonesSummary.widenedByBarangayOverride) {
    console.log(
      `  Per-barangay override applied to ${zonesSummary.widenedByBarangayOverride} polygons ` +
        `(see PER_BARANGAY_BUFFER_M in lib/print-svg-builder.js).`
    );
  }
  if (zonesSummary.clippedToCorridor) {
    const ms = zonesSummary.corridorBuildMs;
    const built = ms != null ? ` (corridor built in ${(ms / 1000).toFixed(1)}s)` : "";
    console.log(
      `  Clipped ${zonesSummary.clippedToCorridor} buffered polygons to road corridor${built}.`
    );
  }
}

function buildOne(slug, smvBufferM, { barangayName = null } = {}) {
  const { svg, zonesSummary } = buildSvgForSlug(slug, PUBLIC_DATA, {
    smvBufferM,
    barangayName,
  });
  logZonesSummary(zonesSummary);
  return svg;
}

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  const barangayArg = (process.argv[3] || "").toLowerCase();
  if (!slug || barangayArg.startsWith("--")) {
    console.error(
      "Usage: node scripts/build-print-svg.mjs <slug> [barangay-slug|all] [--smv-buffer N]"
    );
    process.exit(1);
  }
  // Match the live map's saved zone geometry by default. Pass
  // --smv-buffer N only when a deliberately widened schematic export is
  // wanted.
  const smvBufferM = parseFloat(flag("smv-buffer", "0"));

  console.log(`Loading data for ${slug}...`);
  console.log(
    `Building SVG (A3 portrait, ${PAPER_W_MM}×${PAPER_H_MM} mm, ` +
      `smv buffer ${smvBufferM} m)...`
  );

  if (!barangayArg) {
    // Unchanged from before: whole-municipality sheet.
    const svg = buildOne(slug, smvBufferM);
    fs.mkdirSync(PUBLIC_PRINT, { recursive: true });
    const outPath = path.join(PUBLIC_PRINT, `${slug}.svg`);
    fs.writeFileSync(outPath, svg);
    console.log(
      `Wrote ${outPath} (${(svg.length / 1024).toFixed(1)} KB).\n` +
        `Open in browser to preview, or Inkscape / Illustrator for layout.`
    );
    return;
  }

  const config = getMunicipalityConfig(slug);
  const barangays =
    barangayArg === "all"
      ? config?.schedule?.barangays ?? []
      : [{ slug: barangayArg }];
  if (!barangays.length) {
    throw new Error(`No barangays found for ${slug} (schedule.barangays is empty).`);
  }

  const outDir = path.join(PUBLIC_PRINT, slug);
  fs.mkdirSync(outDir, { recursive: true });
  // In "all" mode, one bad barangay (e.g. a name mismatch between the LGU
  // schedule and the PSA boundary file — a real, pre-existing data issue,
  // not a code bug) shouldn't block the other 13+ good ones. A single
  // explicit barangay request still throws immediately (see the non-"all"
  // path above) since there's nothing else to fall through to there.
  const failures = [];
  for (const b of barangays) {
    try {
      const resolved = resolveBarangayName(slug, b.slug);
      console.log(`\n--- ${resolved.name} (${resolved.slug}) ---`);
      const svg = buildOne(slug, smvBufferM, { barangayName: resolved.name });
      const outPath = path.join(outDir, `${resolved.slug}.svg`);
      fs.writeFileSync(outPath, svg);
      console.log(`Wrote ${outPath} (${(svg.length / 1024).toFixed(1)} KB).`);
    } catch (e) {
      console.error(`\n--- ${b.slug}: FAILED — ${e.message} ---`);
      failures.push({ slug: b.slug, error: e.message });
    }
  }
  const okCount = barangays.length - failures.length;
  console.log(`\nDone — ${okCount}/${barangays.length} sheet(s) written to ${outDir}.`);
  if (failures.length) {
    console.log(
      `${failures.length} failed: ${failures.map((f) => f.slug).join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
