import fs from "node:fs";
import path from "node:path";
import { buildSvgForSlug } from "../../../../lib/print-svg-builder.js";
import { getMunicipalityConfig } from "../../../../lib/municipalities.js";

export const KNOWN_PRINT_SLUGS = new Set([
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

function truthyParam(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function parsePrintOptions(request, orientation = null) {
  const url = new URL(request.url);
  const rawBuffer = url.searchParams.get("smvBuffer");
  const rawBuildings = url.searchParams.get("buildings");
  return {
    smvBufferM: rawBuffer == null ? undefined : parseFloat(rawBuffer),
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

export function buildPrintSvgResponse({
  request,
  slug,
  barangaySlug = null,
  orientation = null,
}) {
  if (!KNOWN_PRINT_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  const publicDataDir = path.join(process.cwd(), "public", "data");
  const options = parsePrintOptions(request, orientation);
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
