// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Print zoom, in its own module because the print panel needs these
// bounds and lib/print-svg-builder.js imports node:fs — pulling that into
// a client component breaks the browser bundle.
//
// 1 = fit the subject to the page, which is the default and what every
// sheet did before this control existed. Above 1 the subject is drawn
// larger and its edges fall outside the frame (clipped by the SVG
// viewBox). Below 1 it is drawn smaller with more blank paper around it —
// it does NOT reveal more surrounding geography, because what gets drawn
// is decided by the data filters, not by the frame. Labels are not
// rescaled either, so far below 1 they crowd together.
//
// Zoom is centred on the subject — there is no pan.

export const MIN_PRINT_ZOOM = 0.5;
export const MAX_PRINT_ZOOM = 3;
export const DEFAULT_PRINT_ZOOM = 1;

export function clampPrintZoom(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PRINT_ZOOM;
  return Math.min(MAX_PRINT_ZOOM, Math.max(MIN_PRINT_ZOOM, n));
}
