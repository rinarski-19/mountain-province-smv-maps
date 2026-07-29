// GET /api/print/svg/<slug>/<barangay>
//
// Same idea as ../route.js (fresh, on-demand A3 SVG straight off the
// current public/data/*.geojson), but cropped to a single barangay
// instead of the whole municipality — legible road/zone detail for
// large LGUs where one whole-LGU sheet squeezes everything too small
// to read. The whole-municipality route is unchanged and stays
// available side by side with this one.
//
// <barangay> is the same slug used everywhere else in the app (search,
// sidebar, saved views) — see lib/municipalities.js's per-LGU
// `schedule.barangays` / `schedule.getBarangayBySlug`. That slug maps
// to the LGU schedule's canonical barangay *name*, which does not
// always match the PSA/OSM boundary file's spelling verbatim (e.g.
// Besao's "Kin-iway" vs. the boundary file's "Kin-iway (Pob.)"). We
// resolve that here via the LGU's own `schedule.slugForName()` — the
// same alias-aware helper the rest of the app already relies on —
// rather than assuming an exact string match.

import fs from "node:fs";
import path from "node:path";
import { buildSvgForSlug } from "../../../../../../lib/print-svg-builder.js";
import { getMunicipalityConfig } from "../../../../../../lib/municipalities.js";

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

function readJsonOptional(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(request, context) {
  const params = await context.params;
  const slug = (params?.slug || "").toLowerCase();
  const barangaySlug = (params?.barangay || "").toLowerCase();
  if (!KNOWN_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  const schedule = getMunicipalityConfig(slug)?.schedule;
  const target = schedule?.getBarangayBySlug?.(barangaySlug);
  if (!target) {
    const valid = (schedule?.barangays ?? []).map((b) => b.slug).join(", ");
    return Response.json(
      {
        ok: false,
        error: `Unknown barangay slug "${barangaySlug}" for ${slug}. Valid: ${valid}`,
      },
      { status: 400 }
    );
  }

  const publicDataDir = path.join(process.cwd(), "public", "data");

  // The schedule's canonical name ("Kin-iway") doesn't always match
  // the boundary file's properties.name verbatim ("Kin-iway (Pob.)").
  // Find the actual feature by running the LGU's own alias-aware
  // slugForName() over every boundary name and matching on slug, then
  // hand buildSvgForSlug the boundary file's exact name string.
  const barangaysGeo = readJsonOptional(
    path.join(publicDataDir, `${slug}_barangays.geojson`)
  );
  const matchFeature = (barangaysGeo?.features ?? []).find(
    (f) => schedule.slugForName?.(f.properties?.name) === target.slug
  );
  if (!matchFeature) {
    return Response.json(
      {
        ok: false,
        error:
          `Barangay boundary for "${target.name}" (${target.slug}) not found in ` +
          `${slug}_barangays.geojson — likely a name mismatch between the LGU ` +
          `schedule and the PSA boundary data. Check slugForName() aliases in lib/${slug}.js.`,
      },
      { status: 500 }
    );
  }

  // ?smvBuffer=N widens ribbon SMV zones by N meters per side at
  // render time only — same knob as the whole-municipality route.
  const url = new URL(request.url);
  const rawBuffer = url.searchParams.get("smvBuffer");
  const smvBufferM = rawBuffer == null ? undefined : parseFloat(rawBuffer);
  const rawBuildings = url.searchParams.get("buildings");
  const showBuildingFootprints =
    rawBuildings == null
      ? undefined
      : rawBuildings !== "0" && rawBuildings !== "false";

  try {
    const { svg } = buildSvgForSlug(slug, publicDataDir, {
      smvBufferM,
      showBuildingFootprints,
      barangayName: matchFeature.properties.name,
    });
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "Content-Disposition": `inline; filename="${slug}-${barangaySlug}-smv.svg"`,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 500 }
    );
  }
}
