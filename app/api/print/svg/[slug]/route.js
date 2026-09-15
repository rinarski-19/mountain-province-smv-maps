// GET /api/print/svg/<slug>
//
// Returns a freshly-built A3 print SVG for the given LGU. Reads the
// per-LGU GeoJSON files straight off disk (public/data/*.geojson) so
// the SVG reflects the LATEST saved state of the editor — anything
// /api/zones/save committed shows up here on the next request.
//
// Why an API route instead of a static file? Because the user edits
// zones in the live web editor and expects Print to capture exactly
// what they've been working on. A static SVG would only show the
// snapshot taken at last build time.
//
// This is the orientation-less entry point, kept for existing links
// and bookmarks; it defaults to portrait and accepts ?orientation=.
// The frontend print menu uses the explicit
// /api/print/svg/{portrait,landscape}/<slug> routes instead.
//
// Browser flow: the new tab shows the rendered SVG inline; Cmd+P (or
// Ctrl+P) on that tab prints it as vector PDF — no raster basemap.

import { buildPrintSvgResponse } from "../_route-helpers.js";

// Disable Next's per-route caching; this endpoint must always read
// the freshest version of the underlying GeoJSON files.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, context) {
  const params = await context.params;
  return buildPrintSvgResponse({
    request,
    slug: (params?.slug || "").toLowerCase(),
  });
}
