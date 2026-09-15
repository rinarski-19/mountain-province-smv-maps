// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Server-side reader for the per-LGU print overrides written by
// /api/print-settings/<slug>.
//
// Kept separate from lib/print-labels.js because that module is
// imported by the client-side Print panel and must stay free of
// node:fs. This one is server-only.

import fs from "node:fs";
import path from "node:path";
import { normalizePrintSettings } from "./print-labels.js";

export const EMPTY_PRINT_SETTINGS = Object.freeze({
  classValues: {},
  labels: {},
});

export function printSettingsFileName(slug) {
  return `${slug}_print_settings.json`;
}

// Missing or malformed file → no overrides. The printed sheet must
// never fail to render because someone hand-edited this JSON badly.
export function readPrintSettings(slug, publicDataDir) {
  const file = path.join(publicDataDir, printSettingsFileName(slug));
  if (!fs.existsSync(file)) return { classValues: {}, labels: {}, updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...normalizePrintSettings(raw),
      // Opaque version token. The Print panel echoes it back on publish
      // so a blind overwrite of someone else's concurrent edit is
      // rejected instead of silently losing their changes.
      updatedAt: typeof raw?.updated_at === "string" ? raw.updated_at : null,
    };
  } catch {
    return { classValues: {}, labels: {}, updatedAt: null };
  }
}
