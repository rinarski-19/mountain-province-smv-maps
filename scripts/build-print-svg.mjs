#!/usr/bin/env node
// CLI wrapper around lib/print-svg-builder.js. Generates a print SVG
// for a single municipality and writes it to public/print/<slug>.svg.
//
// All the actual SVG logic lives in lib/print-svg-builder.js so the
// API route (app/api/print/svg/[slug]/route.js) can share it.
//
// Usage:
//   node scripts/build-print-svg.mjs bauko
//   node scripts/build-print-svg.mjs <slug>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSvgForSlug, PAPER_W_MM, PAPER_H_MM } from "../lib/print-svg-builder.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const PUBLIC_PRINT = path.join(ROOT, "public", "print");

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  if (!slug) {
    console.error(
      "Usage: node scripts/build-print-svg.mjs <slug> [--smv-buffer N]"
    );
    process.exit(1);
  }
  // Render-time widening for ribbon SMV zones, meters per side. Pass
  // 0 to print at exact ordinance widths with no schematic widening.
  const smvBufferM = parseFloat(flag("smv-buffer", "60"));

  console.log(`Loading data for ${slug}...`);
  console.log(
    `Building SVG (A3 portrait, ${PAPER_W_MM}×${PAPER_H_MM} mm, ` +
      `smv buffer ${smvBufferM} m)...`
  );
  const { svg, zonesSummary } = buildSvgForSlug(slug, PUBLIC_DATA, {
    smvBufferM,
  });

  if (zonesSummary) {
    const summary = Object.entries(zonesSummary.byClass)
      .sort()
      .map(([k, n]) => `${k}:${n}`)
      .join("  ");
    console.log(`  Zones rendered (${zonesSummary.rendered}): ${summary}`);
    if (zonesSummary.widened) {
      console.log(
        `  Render-widened: ${zonesSummary.widened} ribbon zones ` +
          `(+${zonesSummary.smvBufferM} m per side default at print only).`
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

  fs.mkdirSync(PUBLIC_PRINT, { recursive: true });
  const outPath = path.join(PUBLIC_PRINT, `${slug}.svg`);
  fs.writeFileSync(outPath, svg);
  console.log(
    `Wrote ${outPath} (${(svg.length / 1024).toFixed(1)} KB).\n` +
      `Open in browser to preview, or Inkscape / Illustrator for layout.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
