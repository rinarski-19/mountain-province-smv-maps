// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The LGUs that have a full print pipeline (boundaries + zones + basemap
// layers on disk). Single source of truth for every print route's slug
// validation and for the frontend's print menu, replacing the copies
// that used to sit in each route file.
export const PRINT_SLUGS = Object.freeze([
  "bauko",
  "barlig",
  "besao",
  "bontoc",
  "natonin",
  "paracelis",
  "sabangan",
  "sadanga",
  "sagada",
  "tadian",
]);

export const KNOWN_PRINT_SLUGS = new Set(PRINT_SLUGS);

// The editor exposes preview variants like "tadian-dxf" that print from
// the base LGU's data. Normalize those down before validating.
export function basePrintSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/-(?:dxf|print|hybrid)$/, "");
}

export function isPrintableSlug(value) {
  return KNOWN_PRINT_SLUGS.has(basePrintSlug(value));
}
