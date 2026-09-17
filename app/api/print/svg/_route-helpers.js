import fs from "node:fs";
import path from "node:path";
import {
  buildSvgForSlug,
  clampPrintPan,
  clampPrintZoom,
} from "../../../../lib/print-svg-builder.js";
import {
  LANDMARK_KIND_OPTIONS,
  PROVIDER_POI_KINDS,
} from "../../../../lib/landmark-icons.js";
import { getMunicipalityConfig } from "../../../../lib/municipalities.js";

import {
  extractPrintLayer,
  isPrintLayer,
} from "../../../../lib/print-layers.js";
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

export function parseLandmarkKinds(raw) {
  if (raw == null) return [];
  const value = String(raw).trim().toLowerCase();
  if (value === "" || value === "0" || value === "false") return [];
  if (value === "all") return LANDMARK_KIND_OPTIONS.map((o) => o.value);
  // The public-service set the provider filter already allows.
  if (value === "1" || value === "true") return [...PROVIDER_POI_KINDS];
  const known = new Set(LANDMARK_KIND_OPTIONS.map((o) => o.value));
  return value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => known.has(k));
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
    // ?zoom=1.4 draws the subject 40% larger; edges fall off the page.
    zoom: clampPrintZoom(url.searchParams.get("zoom")),
    // ?panX / ?panY shift the map off centre, as a fraction of the page.
    panX: clampPrintPan(url.searchParams.get("panX")),
    panY: clampPrintPan(url.searchParams.get("panY")),
    // ?landmarks=1 includes the provider/OSM landmarks. Off by default:
    // whole-LGU sheets carry hundreds of them (Bauko 491, Bontoc 612) and
    // at A3 they overwhelm the SMV bands the sheet exists to show.
    // Custom, LGU-authored landmarks always print regardless.
    // ?landmarks=1 (or true) prints the civic set; ?landmarks=all prints
    // every kind; ?landmarks=school,govt prints exactly those. Absent or
    // 0 prints none, which is the long-standing default. Custom,
    // LGU-authored landmarks always print regardless.
    landmarkKinds: parseLandmarkKinds(url.searchParams.get("landmarks")),
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

// Sitios that a valuation schedule lists as their own entry but that PSA
// maps only as part of a parent barangay.
//
// PSA's boundary service publishes barangay-level polygons only — its own
// metadata calls Barlig's "Lingoy (Upper)" simply "Lingoy" (brgy_code
// 144401007), and Barlig officially has 11 barangays where the schedule
// lists 13. There is no polygon to fetch for these, and there will not be
// one. Rather than refuse to print a tier the LGU genuinely values, the
// sheet is drawn on the parent barangay's boundary and says so.
const SITIO_PARENT_BOUNDARY = Object.freeze({
  "barlig:lingoy-lower": "lingoy-upper",
  "barlig:lunas-mog-ao": "lunas",
});

export function sitioParentSlug(slug, barangaySlug) {
  return SITIO_PARENT_BOUNDARY[`${slug}:${barangaySlug}`] ?? null;
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
    .filter((b) => resolvable.has(b.slug) || sitioParentSlug(slug, b.slug))
    .map((b) => {
      const parent = resolvable.has(b.slug) ? null : sitioParentSlug(slug, b.slug);
      return {
        slug: b.slug,
        name: b.name,
        // Set when the sheet borrows a parent barangay's outline, so the
        // print menu can say so instead of implying a boundary exists.
        mappedVia: parent
          ? schedule.getBarangayBySlug?.(parent)?.name ?? parent
          : null,
      };
    });
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
  let matchFeature = (barangaysGeo?.features ?? []).find(
    (f) => schedule.slugForName?.(f.properties?.name) === target.slug
  );
  // No polygon of its own? Fall back to the parent barangay's, for the
  // sitios PSA does not map separately.
  let borrowedFrom = null;
  if (!matchFeature) {
    const parent = sitioParentSlug(slug, barangaySlug);
    if (parent) {
      matchFeature = (barangaysGeo?.features ?? []).find(
        (f) => schedule.slugForName?.(f.properties?.name) === parent
      );
      if (matchFeature) {
        borrowedFrom = schedule.getBarangayBySlug?.(parent)?.name ?? parent;
      }
    }
  }
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

  return {
    barangayName: matchFeature.properties.name,
    // The name to print in the title block: the sitio the user asked for,
    // not the parent whose outline is being borrowed.
    displayName: borrowedFrom ? target.name : null,
    borrowedFrom,
  };
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
  // Unpublished palette from the draft preview; null means use whatever
  // is published on disk.
  colors = null,
  theme = null,
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
  options.classColors = colors;
  options.theme = theme;

  if (barangaySlug) {
    const resolved = resolvePrintBarangay(slug, barangaySlug, publicDataDir);
    if (resolved.error) return resolved.error;
    options.barangayName = resolved.barangayName;
    options.barangayDisplayName = resolved.displayName;
    options.barangayBorrowedFrom = resolved.borrowedFrom;
  }

  try {
    const { svg } = buildSvgForSlug(slug, publicDataDir, options);
    // ?layer=map / ?layer=furniture serve the sheet in two halves so the
    // drag-to-frame preview can move the map without the legend.
    const layer = new URL(request.url).searchParams.get("layer");
    const body = isPrintLayer(layer) ? extractPrintLayer(svg, layer) : svg;
    return new Response(body, {
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
