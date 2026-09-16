// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Server-side reader for the per-LGU added classes written by
// /api/classes/<slug>. Split from lib/added-classes.js because that
// module is imported by client components and must stay free of node:fs.

import fs from "node:fs";
import path from "node:path";
import {
  sanitizeAddedClasses,
  sanitizeRemovedClasses,
} from "./added-classes.js";

export function addedClassesFileName(slug) {
  return `${slug}_classes.json`;
}

// Missing or malformed file → no added classes. A printed valuation sheet
// must never fail to render because someone hand-edited this JSON badly.
export function readAddedClasses(slug, publicDataDir, options = {}) {
  const file = path.join(publicDataDir, addedClassesFileName(slug));
  if (!fs.existsSync(file)) return { classes: [], removed: [], updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      classes: sanitizeAddedClasses(raw?.classes, options),
      removed: sanitizeRemovedClasses(raw?.removed, options),
      updatedAt: typeof raw?.updated_at === "string" ? raw.updated_at : null,
    };
  } catch {
    return { classes: [], removed: [], updatedAt: null };
  }
}
