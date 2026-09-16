// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Server-side reader for the province-wide SMV class palette written by
// /api/palette. One file for all ten LGUs — see the note on
// CLASS_COLOR_OVERRIDES in lib/classifications.js for why the palette is
// shared rather than per-municipality.
//
// Kept separate from lib/classifications.js because that module is
// imported by client components and must stay free of node:fs.

import fs from "node:fs";
import path from "node:path";
import { sanitizeClassColors } from "./classifications.js";
import { sanitizePrintTheme } from "./print-theme.js";

export const PALETTE_FILE = "smv_palette.json";

export function palettePath(publicDataDir) {
  return path.join(publicDataDir, PALETTE_FILE);
}

// Missing or malformed file → no overrides. A printed valuation sheet
// must never fail to render because someone hand-edited this JSON badly.
export function readPalette(publicDataDir) {
  const file = palettePath(publicDataDir);
  if (!fs.existsSync(file)) return { colors: {}, theme: {}, updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      colors: sanitizeClassColors(raw?.colors),
      theme: sanitizePrintTheme(raw?.theme),
      updatedAt: typeof raw?.updated_at === "string" ? raw.updated_at : null,
    };
  } catch {
    return { colors: {}, theme: {}, updatedAt: null };
  }
}
