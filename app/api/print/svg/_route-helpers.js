import fs from "node:fs";
import path from "node:path";
import { buildSvgForSlug } from "../../../../lib/print-svg-builder.js";
import { getMunicipalityConfig } from "../../../../lib/municipalities.js";

import { KNOWN_PRINT_SLUGS } from "../../../../lib/print-slugs.js";

export { KNOWN_PRINT_SLUGS };

function readJsonOptional(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function truthyParam(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export const MAX_SMV_BUFFER_M = 500;

function clampBufferM(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_SMV_BUFFER_M);
}

export function parsePrintOptions(request, orientation = null) {
  const url = new URL(request.url);
  const rawBuffer = url.searchParams.get("smvBuffer");
  const rawBuildings = url.searchParams.get("buildings");
  return {
    // Clamped: the widening is buffered per road segment, so an
    // unbounded value turns one request into a multi-second CPU burn
    // (1e308 measured at ~22 s) for output that is meaningless anyway.
    smvBufferM: rawBuffer == null ? undefined : clampBufferM(parseFloat(rawBuffer)),
    showBuildingFootprints:
      rawBuildings == null
        ? undefined
        : rawBuildings !== "0" && rawBuildings !== "false",
    showLocationLegend:
      truthyParam(url.searchParams.get("locations")) ||
      truthyParam(url.searchParams.get("locationLegend")) ||
      truthyParam(url.searchParams.get("locationsLegend")),
    orientation: orientation ?? url.searchParams.get("orientation") ?? "portrait",
  };
}

// The barangays that can actually be printed: those whose LGU-schedule
// slug resolves to a feature in <slug>_barangays.geojson. Three of the
// 146 scheduled barangays across the ten LGUs do not (two Barlig sitios
// and Besao's Padangaan), and offering them in the print menu returned a
// raw 500 JSON page in a fresh tab. The menu filters on this instead.
export function printableBarangays(slug, publicDataDir) {
  const schedule = getMunicipalityConfig(slug)?.schedule;
  if (!schedule) return [];
  const barangaysGeo = readJsonOptional(
    path.join(publicDataDir, `${slug}_barangays.geojson`)
  );
  const resolvable = new Set(
    (barangaysGeo?.features ?? [])
      .map((f) => schedule.slugForName?.(f.properties?.name))
      .filter(Boolean)
  );
  return (schedule.barangays ?? [])
    .filter((b) => resolvable.has(b.slug))
    .map((b) => ({ slug: b.slug, name: b.name }));
}

export function resolvePrintBarangay(slug, barangaySlug, publicDataDir) {
  const schedule = getMunicipalityConfig(slug)?.schedule;
  const target = schedule?.getBarangayBySlug?.(barangaySlug);
  if (!target) {
    const valid = (schedule?.barangays ?? []).map((b) => b.slug).join(", ");
    return {
      error: Response.json(
        {
          ok: false,
          error: `Unknown barangay slug "${barangaySlug}" for ${slug}. Valid: ${valid}`,
        },
        { status: 400 }
      ),
    };
  }

  const barangaysGeo = readJsonOptional(
    path.join(publicDataDir, `${slug}_barangays.geojson`)
  );
  const matchFeature = (barangaysGeo?.features ?? []).find(
    (f) => schedule.slugForName?.(f.properties?.name) === target.slug
  );
  if (!matchFeature) {
    return {
      error: Response.json(
        {
          ok: false,
          error:
            `Barangay boundary for "${target.name}" (${target.slug}) not found in ` +
            `${slug}_barangays.geojson — likely a name mismatch between the LGU ` +
            `schedule and the PSA boundary data. Check slugForName() aliases in lib/${slug}.js.`,
        },
        { status: 500 }
      ),
    };
  }

  return { barangayName: matchFeature.properties.name };
}

// `overrides` carries an unpublished draft from the Print panel's
// "Preview draft" button. When absent, the sheet renders from whatever
// is published in <slug>_print_settings.json — which is what every
// plain GET of a print URL gets.
export function buildPrintSvgResponse({
  request,
  slug,
  barangaySlug = null,
  orientation = null,
  overrides = null,
}) {
  if (!KNOWN_PRINT_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  const publicDataDir = path.join(process.cwd(), "public", "data");
  const options = parsePrintOptions(request, orientation);

  // Only the draft goes here. Published overrides are read off disk by
  // buildSvgForSlug, so every render path picks them up the same way.
  options.classValueOverrides = overrides?.classValues ?? {};
  options.labels = overrides?.labels ?? {};

  if (barangaySlug) {
    const resolved = resolvePrintBarangay(slug, barangaySlug, publicDataDir);
    if (resolved.error) return resolved.error;
    options.barangayName = resolved.barangayName;
  }

  try {
    const { svg } = buildSvgForSlug(slug, publicDataDir, options);
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "Content-Disposition": `inline; filename="${
          barangaySlug ? `${slug}-${barangaySlug}` : slug
        }-${options.orientation}-smv.svg"`,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 500 }
    );
  }
}
