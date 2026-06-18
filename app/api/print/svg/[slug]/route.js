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
// Browser flow: the app's Print button does
// `window.open('/api/print/svg/<slug>', '_blank')`. The new tab shows
// the rendered SVG inline; Cmd+P (or Ctrl+P) on that tab prints the
// page as vector PDF — no raster basemap anywhere.

import path from "node:path";
import { buildSvgForSlug } from "../../../../../lib/print-svg-builder.js";

// Disable Next's per-route caching; this endpoint must always read
// the freshest version of the underlying GeoJSON files.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KNOWN_SLUGS = new Set([
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

export async function GET(request, context) {
  const params = await context.params;
  const slug = (params?.slug || "").toLowerCase();
  if (!KNOWN_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  const publicDataDir = path.join(process.cwd(), "public", "data");
  // ?smvBuffer=N widens ribbon SMV zones by N meters per side at
  // render time only — source data on disk stays at the ordinance-
  // true 30 m depth-of-frontage. Omit (or pass 0) to print exact.
  const url = new URL(request.url);
  const rawBuffer = url.searchParams.get("smvBuffer");
  const smvBufferM = rawBuffer == null ? undefined : parseFloat(rawBuffer);
  try {
    const { svg } = buildSvgForSlug(slug, publicDataDir, {
      smvBufferM,
    });
    return new Response(svg, {
      status: 200,
      headers: {
        // image/svg+xml renders inline in the browser instead of
        // downloading. The user prints from the tab they land on.
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Edit-then-print needs fresh output every click. No caching.
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        // Filename for when the user does choose to Save As.
        "Content-Disposition": `inline; filename="${slug}-smv.svg"`,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 500 }
    );
  }
}
