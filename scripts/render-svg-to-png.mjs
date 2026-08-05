#!/usr/bin/env node

// Rasterize one of the generated print SVGs into a PNG. The SVG remains the
// editable source; the PNG is the Illustrator-safe version whose labels are
// already pixels and therefore cannot be reinterpreted by another program.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const slug = args[0] || "bontoc";
const outputArg = args.find((arg) => !arg.startsWith("--") && arg !== slug);
const dpiArg = args.find((arg) => arg.startsWith("--dpi="));
const dpi = Number(dpiArg?.split("=")[1] || 600);

if (!Number.isFinite(dpi) || dpi <= 0) {
  console.error("DPI must be a positive number, for example --dpi=600.");
  process.exit(1);
}

const inputPath = resolve(`public/print/${slug}.svg`);
const outputPath = resolve(outputArg || `exports/${slug}_print.png`);

if (!existsSync(inputPath)) {
  console.error(
    `Missing ${inputPath}. Generate it first with: npm run print:svg:${slug}`
  );
  process.exit(1);
}

function findInkscape() {
  const configured = process.env.INKSCAPE_BIN;
  if (configured && existsSync(configured)) return configured;

  const commandName = process.platform === "win32" ? "where" : "which";
  try {
    const found = execFileSync(commandName, ["inkscape"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return found;
  } catch {
    // Try the common installation paths below.
  }

  const commonPaths =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Inkscape\\bin\\inkscape.exe",
          "C:\\Program Files\\Inkscape\\inkscape.com",
          "C:\\Program Files (x86)\\Inkscape\\bin\\inkscape.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Inkscape.app/Contents/MacOS/inkscape"]
        : ["/usr/bin/inkscape", "/usr/local/bin/inkscape"];

  return commonPaths.find((candidate) => existsSync(candidate)) || null;
}

const inkscape = findInkscape();
if (!inkscape) {
  console.error(
    "Inkscape was not found. Install it, add it to PATH, or set INKSCAPE_BIN to its executable path."
  );
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
const result = spawnSync(
  inkscape,
  [
    inputPath,
    "--export-type=png",
    `--export-filename=${outputPath}`,
    `--export-dpi=${dpi}`,
  ],
  { stdio: "inherit" }
);

if (result.error) {
  console.error(`Could not run Inkscape: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status || 1);

console.log(`Wrote ${outputPath} at ${dpi} DPI.`);
