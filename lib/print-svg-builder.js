// Shared print-SVG builder. Used by both:
//   - scripts/build-print-svg.mjs (CLI batch generation)
//   - app/api/print/svg/[slug]/route.js (on-demand server response)
//
// Output is a self-contained A3 portrait SVG with embedded SMV zones,
// boundaries, and an OSM-derived vector basemap (water, buildings,
// roads, place labels). Coordinates are in millimeters so the SVG
// scales directly to paper in Inkscape / browser print.

import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";
import {
  CLASSIFICATION_INFO,
  colorForClass,
  commercialHatchColorForClass,
  isCommercialClass,
  isResidentialClass,
} from "./classifications.js";

// ---------- Paper / palette / scale constants ----------

// A3 portrait, mm. 6 mm bleed-safe margin (matches @page rule in the
// app's existing print CSS so output is consistent).
export const PAPER_W_MM = 297;
export const PAPER_H_MM = 420;
export const PAGE_MARGIN_MM = 6;

// LGU-local class color overrides are centralized in
// lib/classifications.js (LGU_LOCAL_COLOR_OVERRIDES). The shared
// colorForClass(klass, slug) is the resolver used here, in
// lib/bauko.js, and in components/LeafletMap.js — single source of
// truth so chip, screen, and paper never disagree.

// Road weight by OSM highway tag, in mm. Tuned for whole-LGU A3 fit
// where SMV color bands dominate and roads are a reference layer on
// top. Trimmed twice (25 % each time) from the original Mapnik-style
// weights so roads thread through the choropleth as a thin reference
// without overpowering it.
const ROAD_WEIGHTS_MM = {
  trunk: 0.4,
  primary: 0.4,
  secondary: 0.31,
  tertiary: 0.26,
  unclassified: 0.2,
  residential: 0.2,
  track: 0.14,
};
const ROAD_DEFAULT_MM = 0.2;
const ROAD_CASING_OFFSET_MM = 0.11;

// Cartographic palette — quiet basemap colors so the SMV zones own
// the visual story, plus a Philippine road-hierarchy color ramp on
// top:
//   national (trunk + primary)   yellow         + dark amber casing
//   provincial (secondary)       saturated orange + dark brown casing
//   barangay (unclassified +     warm tan       + cream casing
//             residential)
//   other (tertiary, track)      neutral gray   + white casing
// Reading the road network on the printed map should communicate the
// hierarchy at a glance, matching how DPWH/LGU maps classify routes.
const PALETTE = {
  paper: "#ffffff",
  waterFill: "#d8eaf6",
  waterStroke: "#7eb3dc",
  waterLine: "#9ec5e8",
  buildingFill: "#ebe8e2",
  buildingStroke: "#c8c5bf",
  roadCasing: "#ffffff",
  roadCasingTrunk: "#a16207",
  roadCasingProvincial: "#9a3412",
  roadCasingBarangay: "#bababa",
  roadFill: "#a8a39b",
  roadFillTrunk: "#fcd34d",
  roadFillProvincial: "#fb923c",
  roadFillBarangay: "#ffffff",
  barangayStroke: "#1f2937",
  municipalityStroke: "#000000",
  placeLabel: "#000000",
  placeHalo: "#ffffff",
};

// Map OSM highway tag to one of the road tiers above. Anything not
// listed here falls back to the neutral gray "other" treatment.
function roadTier(highway) {
  switch (highway) {
    case "trunk":
    case "primary":
      return "national";
    case "secondary":
      return "provincial";
    case "unclassified":
    case "residential":
      return "barangay";
    default:
      return "other"; // tertiary, track, link variants, etc.
  }
}

// Per-tier render-time SMV widening, in meters. Currently flat at
// 60 m per side across every road tier so the SMV color band is the
// dominant visual element on the printed plate — anything thinner
// than this disappears against the basemap roads at A3 print scale.
// Applied per side, so total visible band width is 30 m (legal) +
// 2 × 60 m = 150 m. If specific tiers ever need to differ again
// (e.g. provincial halo narrower than national), reintroduce the
// ramp here — the nearestRoadTier lookup is still in place.
const TIER_BUFFER_M = {
  national: 60,
  provincial: 60,
  barangay: 60,
  other: 60,
};

// Width (per side, meters) of the road-corridor used to clip buffered
// SMV polygons. Should be at least TIER_BUFFER_M + the original
// 30 m ordinance ribbon depth so a legitimate ribbon survives the
// intersection. 90 m gives ~30 m of slack on each side which keeps
// the SMV band hugging the road network without spilling into the
// lobe-at-curves area that turf.buffer naturally produces when it
// rounds polygon endpoints.
const RIBBON_CORRIDOR_BUFFER_M = 120;

// Per-class buffer scale (2026-06-23): higher-value classes get a
// TIGHTER buffer so they stay snug to the road; lower-value classes
// get a WIDER buffer so they form a visible outer shoulder past the
// inner tiers. Linear ramp between CLASS_BUFFER_MIN_M (highest value
// class) and CLASS_BUFFER_MAX_M (lowest value class) using rank
// against the full CLASSIFICATION_INFO value list.
//
// Why: on Besao's Agawa corridor, a C-3 inner ribbon and an R-4
// outer ribbon both got the flat 60 m buffer. After buffering they
// occupied the same band width — the outer R-4 didn't peek out at
// all. With this ramp, R-4 (lower value) extends ~30 m further per
// side than C-3 (higher value), giving the classic concentric-band
// look you see in textbook SMV plates.
const CLASS_BUFFER_MIN_M = 30;
const CLASS_BUFFER_MAX_M = 120;
// Pre-compute the rank lookup: descending unique values from
// CLASSIFICATION_INFO. rank 0 = highest value class.
const CLASS_RANK_BY_VALUE = (() => {
  const values = Array.from(
    new Set(
      Object.values(CLASSIFICATION_INFO)
        .map((info) => info?.value)
        .filter((v) => Number.isFinite(v))
    )
  ).sort((a, b) => b - a);
  const rank = new Map();
  values.forEach((v, i) => rank.set(v, i));
  return { ordered: values, rank };
})();
// Returns the per-side buffer (in meters) appropriate for a class
// based on its global value rank. Falls back to the flat
// TIER_BUFFER_M value when the class is unknown.
function classBufferM(klass, fallbackM) {
  const info = CLASSIFICATION_INFO[klass];
  if (!info || !Number.isFinite(info.value)) return fallbackM;
  const rank = CLASS_RANK_BY_VALUE.rank.get(info.value);
  if (rank == null) return fallbackM;
  const maxRank = CLASS_RANK_BY_VALUE.ordered.length - 1;
  if (maxRank <= 0) return CLASS_BUFFER_MIN_M;
  const t = rank / maxRank; // 0 = highest value, 1 = lowest
  return CLASS_BUFFER_MIN_M + t * (CLASS_BUFFER_MAX_M - CLASS_BUFFER_MIN_M);
}

// Per-LGU + per-barangay override map. Keys take two forms:
//   "<slug>:<Barangay Name>"  → applies only to that one barangay
//   "<slug>:*"                → applies to every barangay in the LGU
// Resolution order in the buffer picker (highest priority first):
//   1. explicit barangay match  ("sagada:Patay")
//   2. LGU-wide wildcard         ("sagada:*")
//   3. tier value (TIER_BUFFER_M)
//   4. caller-supplied smvBufferM
// Use this when dense barangays show SMV halos bleeding into each
// other at the global TIER_BUFFER_M. Set per-barangay overrides
// independently — lower for crowded town centers, leave the global
// default in place for sparse rural barangays.
const PER_BARANGAY_BUFFER_M = {
  // No overrides currently active — Sagada was bumped down to 30 m for
  // testing, then restored to match Barlig's 60 m default after a
  // visual comparison. Add entries here when a specific LGU or
  // barangay needs a narrower (or wider) ribbon halo than the
  // TIER_BUFFER_M default.
};

// Distance cap (in meters) beyond which a road no longer counts as
// "the road this SMV polygon follows". Above this, fall back to the
// caller-supplied smvBufferM (assumes the polygon is an inner-lot
// fill or otherwise unrelated to any specific road tier).
const TIER_BUFFER_MAX_DIST_M = 80;

// Quick lon/lat bbox-distance check, in approximate meters. Used as
// a cheap prefilter before the expensive pointToLineDistance.
// At Mountain Province latitude (~17°N) 1° lon ≈ 106 km, 1° lat ≈ 111 km.
const LON_DEG_TO_M = 106000;
const LAT_DEG_TO_M = 111000;
function pointToBboxMinDistMeters(point, bbox) {
  if (!bbox) return Infinity;
  const [lon, lat] = point;
  const [minX, minY, maxX, maxY] = bbox;
  const dLon = lon < minX ? minX - lon : lon > maxX ? lon - maxX : 0;
  const dLat = lat < minY ? minY - lat : lat > maxY ? lat - maxY : 0;
  const mx = dLon * LON_DEG_TO_M * Math.cos((lat * Math.PI) / 180);
  const my = dLat * LAT_DEG_TO_M;
  return Math.sqrt(mx * mx + my * my);
}

// Build a one-time index for the road feature collection so
// nearestRoadTier doesn't recompute bboxes for every SMV polygon.
function buildRoadIndex(roadFeatures) {
  const index = [];
  for (const r of roadFeatures) {
    if (!r?.geometry) continue;
    let bbox;
    try {
      bbox = turf.bbox(r);
    } catch {
      continue;
    }
    index.push({ feat: r, bbox, tier: roadTier(r.properties?.highway) });
  }
  return index;
}

// Find the tier of the road geometrically closest to a polygon's
// centroid. Returns null if no road is within TIER_BUFFER_MAX_DIST_M.
// Used to give SMV ribbons along national / provincial roads a wider
// render buffer than ribbons along barangay roads.
function nearestRoadTier(polygonCentroidLatLon, roadIndex) {
  if (!polygonCentroidLatLon || !roadIndex?.length) return null;
  const pt = polygonCentroidLatLon.geometry?.coordinates ?? polygonCentroidLatLon;
  let bestTier = null;
  let bestDist = Infinity;
  for (const entry of roadIndex) {
    // Cheap bbox prefilter — skip any road whose bbox is already
    // farther than the current best distance.
    const bboxDist = pointToBboxMinDistMeters(pt, entry.bbox);
    if (bboxDist >= bestDist) continue;
    if (bboxDist > TIER_BUFFER_MAX_DIST_M) continue;
    try {
      const d = turf.pointToLineDistance(polygonCentroidLatLon, entry.feat, {
        units: "meters",
      });
      if (d < bestDist) {
        bestDist = d;
        bestTier = entry.tier;
      }
    } catch {
      // ignore unparseable road, keep going
    }
  }
  if (bestDist > TIER_BUFFER_MAX_DIST_M) return null;
  return bestTier;
}

// Build a single corridor polygon = union of every road buffered by
// RIBBON_CORRIDOR_BUFFER_M per side. Used to clip the buffered SMV
// ribbon polygons so they stop hugging the road only where the road
// actually goes — no more rounded-end lobes spilling past curves.
//
// Sequential union over hundreds of road buffers is expensive but
// happens ONCE per build, then per-polygon clipping is a cheap
// pairwise intersect. Built lazily because most non-print code paths
// don't need it. Returns null on failure so callers fall through to
// unclipped buffers.
function buildRoadCorridor(roadFeatures) {
  if (!roadFeatures?.length) return null;
  // Step 1: buffer each road individually — O(n) and fast.
  const buffered = [];
  for (const road of roadFeatures) {
    if (!road?.geometry) continue;
    try {
      const rb = turf.buffer(road, RIBBON_CORRIDOR_BUFFER_M, {
        units: "meters",
      });
      if (rb?.geometry) buffered.push(rb);
    } catch {
      // skip degenerate road
    }
  }
  if (!buffered.length) return null;
  // Step 2: tree-merge — repeatedly halve, unioning pairs. Reduces
  // sequential-union O(n²) blow-up to O(n log n), which matters at
  // 300+ roads (Paracelis). Each iteration roughly halves the array,
  // so total union ops ≈ n - 1 but each one is on smaller polygons.
  let current = buffered;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      try {
        const u = turf.union(turf.featureCollection([a, b]));
        if (u?.geometry) {
          next.push(u);
        } else {
          // union returned null — keep whichever piece we still have
          next.push(a);
        }
      } catch {
        // union threw — keep one half so we don't lose all progress
        next.push(a);
      }
    }
    current = next;
  }
  return current[0] ?? null;
}

// Pre-compute a bbox index for the barangay polygons so each SMV
// polygon's barangay lookup is a cheap bbox prefilter + point-in-
// polygon on the small surviving set. Same shape as buildRoadIndex.
function buildBarangayIndex(barangayFeatures) {
  const index = [];
  for (const f of barangayFeatures) {
    if (!f?.geometry) continue;
    const name =
      f.properties?.name ??
      f.properties?.barangay ??
      f.properties?.NAME_3 ??
      null;
    if (!name) continue;
    let bbox;
    try {
      bbox = turf.bbox(f);
    } catch {
      continue;
    }
    index.push({ feat: f, bbox, name });
  }
  return index;
}

// Returns the barangay name containing `point`, or null if none does
// (e.g. on a coastline edge, slightly outside any polygon). Uses bbox
// prefilter, then turf.booleanPointInPolygon on the survivors.
function barangayForPoint(point, barangayIndex) {
  if (!point || !barangayIndex?.length) return null;
  const pt = point.geometry?.coordinates ?? point;
  const [lon, lat] = pt;
  for (const entry of barangayIndex) {
    const [minX, minY, maxX, maxY] = entry.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    try {
      if (turf.booleanPointInPolygon(pt, entry.feat)) {
        return entry.name;
      }
    } catch {
      // ignore degenerate polygon
    }
  }
  return null;
}

// Look up the PER_BARANGAY_BUFFER_M override for a given LGU slug +
// barangay name. Checks the explicit "<slug>:<Barangay>" key first,
// then falls back to the LGU-wide "<slug>:*" wildcard. Returns null
// if neither is set, so the caller can fall through to TIER_BUFFER_M.
function perBarangayBufferOverride(slug, barangayName) {
  if (!slug) return null;
  if (barangayName) {
    const exact = PER_BARANGAY_BUFFER_M[`${slug}:${barangayName}`];
    if (exact != null) return exact;
  }
  const lgu = PER_BARANGAY_BUFFER_M[`${slug}:*`];
  return lgu ?? null;
}

function roadFillForTier(tier) {
  switch (tier) {
    case "national":
      return PALETTE.roadFillTrunk;
    case "provincial":
      return PALETTE.roadFillProvincial;
    case "barangay":
      return PALETTE.roadFillBarangay;
    default:
      return PALETTE.roadFill;
  }
}

function roadCasingForTier(tier) {
  switch (tier) {
    case "national":
      return PALETTE.roadCasingTrunk;
    case "provincial":
      return PALETTE.roadCasingProvincial;
    case "barangay":
      return PALETTE.roadCasingBarangay;
    default:
      return PALETTE.roadCasing;
  }
}

// Bridge / tunnel handling. OSM tags both ends with "no" sometimes
// to mean "explicitly not a bridge/tunnel" — treat anything other
// than null and "no" as the real thing.
function isBridge(feature) {
  const b = feature?.properties?.bridge;
  return Boolean(b) && b !== "no";
}
function isTunnel(feature) {
  const t = feature?.properties?.tunnel;
  return Boolean(t) && t !== "no";
}

// ---------- Helpers ----------

function readJsonOptional(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function makeProjection(bbox) {
  const [west, south, east, north] = bbox;
  const midLat = (north + south) / 2;
  // Web-mercator-aware horizontal squash: at 17°N (Mountain Province)
  // 1° longitude is ~95% as wide as 1° latitude. Without this the
  // LGU prints slightly stretched east-west.
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const effW = (east - west) * lonScale;
  const effH = north - south;
  const dataAspect = effW / effH;

  const usableW = PAPER_W_MM - 2 * PAGE_MARGIN_MM;
  const usableH = PAPER_H_MM - 2 * PAGE_MARGIN_MM;
  const paperAspect = usableW / usableH;

  let drawW, drawH;
  if (dataAspect > paperAspect) {
    drawW = usableW;
    drawH = drawW / dataAspect;
  } else {
    drawH = usableH;
    drawW = drawH * dataAspect;
  }
  const offsetX = PAGE_MARGIN_MM + (usableW - drawW) / 2;
  const offsetY = PAGE_MARGIN_MM + (usableH - drawH) / 2;

  return {
    project: (lon, lat) => [
      offsetX + ((lon - west) * lonScale) / effW * drawW,
      offsetY + ((north - lat) / effH) * drawH,
    ],
    drawWidthMm: drawW,
    drawHeightMm: drawH,
    offsetX,
    offsetY,
  };
}

function fmt(n) {
  return Number(n.toFixed(2)).toString();
}

function ringToPathD(ring, project, close = true) {
  if (!ring || ring.length === 0) return "";
  const pts = ring.map(([lon, lat]) => project(lon, lat));
  let d = "M" + fmt(pts[0][0]) + "," + fmt(pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    d += "L" + fmt(pts[i][0]) + "," + fmt(pts[i][1]);
  }
  if (close) d += "Z";
  return d;
}

function geometryToPathD(geometry, project) {
  if (!geometry) return "";
  const { type, coordinates } = geometry;
  switch (type) {
    case "LineString":
      return ringToPathD(coordinates, project, false);
    case "MultiLineString":
      return coordinates
        .map((ring) => ringToPathD(ring, project, false))
        .join(" ");
    case "Polygon":
      return coordinates
        .map((ring) => ringToPathD(ring, project, true))
        .join(" ");
    case "MultiPolygon":
      return coordinates
        .flatMap((poly) => poly.map((ring) => ringToPathD(ring, project, true)))
        .join(" ");
    case "Point":
      return null;
    default:
      return "";
  }
}

function geometryProjectedBounds(geometry, project) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === "number") {
      const [x, y] = project(coords[0], coords[1]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const child of coords) visit(child);
  };
  visit(geometry?.coordinates);
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function featureArea(feature) {
  try {
    return turf.area(feature);
  } catch {
    return 0;
  }
}

function getZoneClass(feat) {
  return (feat?.properties?.classification ?? "").toUpperCase();
}

function getZoneColor(klass, slug) {
  return colorForClass(klass, slug);
}

function normaliseZoneClass(value) {
  const key = String(value ?? "").trim().toUpperCase();
  return CLASSIFICATION_INFO[key] ? key : null;
}

function auxZoneClass(feat, slot) {
  const props = feat?.properties ?? {};
  if (slot === "secondary") {
    return normaliseZoneClass(
      props.secondary_classification ??
        props.secondaryClassification ??
        props.secondary ??
        props.classification_secondary
    );
  }
  return normaliseZoneClass(
    props.tertiary_classification ??
      props.tertiaryClassification ??
      props.tertiary ??
      props.classification_tertiary
  );
}

function zoneClassKeys(feat) {
  return Array.from(
    new Set(
      [
        normaliseZoneClass(feat?.properties?.classification),
        auxZoneClass(feat, "secondary"),
        auxZoneClass(feat, "tertiary"),
      ].filter(Boolean)
    )
  );
}

// Picks which class drives the solid fill for a feature. Residential
// wins when both classes are tagged (the more common land use), then
// falls back to whatever class is present so commercial-only zones
// still paint instead of going blank. The hatch / commercial-overlay
// step has been removed from the print SVG — that's now done by hand
// in Illustrator after export.
function residentialSolidZoneClass(feat) {
  const classes = zoneClassKeys(feat);
  return classes.find(isResidentialClass) ?? classes[0] ?? null;
}

// Any commercial class on the feature gets a hatch overlay. Commercial
// classes do NOT print as solid fills; the hatch is the cartographic
// shorthand for "commercial use applies here" without pretending we
// know exact parcel-level commercial locations.
function commercialHatchZoneClass(feat) {
  const classes = zoneClassKeys(feat);
  return classes.find(isCommercialClass) ?? null;
}

function commercialHatchPatternId(klass) {
  return `smv-commercial-hatch-${String(klass ?? "C").replace(/[^A-Z0-9-]/gi, "-")}`;
}

function commercialHatchClipId(index, klass) {
  return `smv-commercial-hatch-clip-${String(klass ?? "C").replace(/[^A-Z0-9-]/gi, "-")}-${index}`;
}

function renderCommercialHatchLines({ feat, klass, clipId, project }) {
  const bounds = geometryProjectedBounds(feat.geometry, project);
  if (!bounds) return "";
  const color = commercialHatchColorForClass(klass);
  const spacing = 1.45;
  const strokeWidth = 0.18;
  const pad = 4;
  const height = bounds.maxY - bounds.minY + pad * 2;
  const start = bounds.minX - height - pad;
  const end = bounds.maxX + pad;
  const lines = [];
  lines.push(
    `<g clip-path="url(#${clipId})" fill="none" stroke="${color}" ` +
      `stroke-width="${strokeWidth}" stroke-opacity="0.9" ` +
      `stroke-linecap="butt" data-class="${escapeXml(klass)}" ` +
      `data-render="commercial-hatch-lines">`
  );
  for (let x = start; x <= end; x += spacing) {
    lines.push(
      `<path d="M${fmt(x)},${fmt(bounds.maxY + pad)}L${fmt(x + height)},${fmt(
        bounds.minY - pad
      )}"/>`
    );
  }
  lines.push(`</g>`);
  return lines.join("\n");
}

function renderCommercialHatchBoundary({ d, klass }) {
  const color = commercialHatchColorForClass(klass);
  return (
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.22" ` +
    `stroke-opacity="0.95" stroke-linecap="round" stroke-linejoin="round" ` +
    `data-class="${escapeXml(klass)}" data-render="commercial-hatch-boundary"/>`
  );
}

function dissolveCommercialHatches(entries) {
  const byClass = new Map();
  for (const entry of entries) {
    if (!entry?.feat?.geometry || !entry.klass) continue;
    // Keep hatches separated by their solid base class. Otherwise a
    // C-3 hatch over R-2 can dissolve into a neighboring C-3 hatch
    // over R-3/R-4 and visually ignore the secondary class boundary.
    const groupKey = `${entry.klass}__${entry.baseClass ?? "none"}`;
    const group = byClass.get(groupKey) ?? {
      klass: entry.klass,
      baseClass: entry.baseClass ?? null,
      feats: [],
    };
    group.feats.push(entry.feat);
    byClass.set(groupKey, group);
  }

  const dissolved = [];
  for (const { klass, baseClass, feats } of byClass.values()) {
    if (feats.length === 1) {
      dissolved.push({ feat: feats[0], klass, baseClass });
      continue;
    }
    try {
      const unioned = turf.union(turf.featureCollection(feats));
      if (unioned?.geometry) {
        dissolved.push({
          feat: {
            type: "Feature",
            properties: {
              classification: klass,
              hatch_base_classification: baseClass,
            },
            geometry: unioned.geometry,
          },
          klass,
          baseClass,
        });
        continue;
      }
    } catch {
      // Fall back to individual entries if Turf cannot dissolve a
      // self-intersecting or otherwise fussy hand-drawn polygon.
    }
    for (const feat of feats) dissolved.push({ feat, klass, baseClass });
  }
  return dissolved;
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// All place labels render at the same size on the printed plate so
// no name reads as "more important" than another based on OSM tagging
// (place=town vs village vs hamlet). 3.2 mm ≈ 12 px at 96 DPI / ≈ 9 pt
// in print terms — readable at A3 scale without crowding the map.
const PLACE_FONT_SIZE_MM = 3.2;
function placeFontSizeMm(_place) {
  return PLACE_FONT_SIZE_MM;
}

// ---------- Core: build the SVG ----------

// Polsby-Popper compactness threshold for the render-time SMV widener.
// 0.15 keeps blocky polygons (compact barangay fills, district blocks)
// and selects road-following ribbons for buffering. Same heuristic the
// CLI widener used, but applied non-destructively here.
const RIBBON_COMPACTNESS = 0.15;

function ribbonCompactness(feature) {
  try {
    const a = turf.area(feature);
    if (a <= 0) return 1;
    const line = turf.polygonToLine(feature);
    const p = turf.length(line, { units: "meters" });
    if (p <= 0) return 1;
    return (4 * Math.PI * a) / (p * p);
  } catch {
    return 1;
  }
}

// `smvBufferM` widens ribbon-shaped SMV zones on each side at render
// time. Source data on disk stays at its authoritative width (the
// 30 m depth-of-frontage from the LGU SMV ordinance) — only the
// printed paper shows the visually widened bands. Compact polygons
// (inner-lot area fills) are never buffered. Pass 0 to print exact
// data widths with no schematic widening.
export function buildSvg({
  slug,
  outline,
  barangays,
  zones,
  water,
  buildings,
  roads,
  places,
  smvBufferM = 60,
  classValues = {},
  municipalityName = null,
  revisionYear = null,
}) {
  if (!outline) throw new Error(`Missing outline for ${slug}`);
  const outlineFeature = outline.features?.[0];
  if (!outlineFeature) throw new Error(`Empty outline FC for ${slug}`);

  const bbox = turf.bbox(outlineFeature);
  const proj = makeProjection(bbox);
  const project = proj.project;
  const lines = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
      `width="${PAPER_W_MM}mm" height="${PAPER_H_MM}mm" ` +
      `viewBox="0 0 ${PAPER_W_MM} ${PAPER_H_MM}" ` +
      `data-slug="${escapeXml(slug)}" data-generated="${new Date().toISOString()}">`
  );
  lines.push(
    `<rect x="0" y="0" width="${PAPER_W_MM}" height="${PAPER_H_MM}" fill="${PALETTE.paper}"/>`
  );
  lines.push(`<defs>`);
  for (const klass of ["C-1", "C-2", "C-3", "C-4"]) {
    // Pattern tuning notes:
    //   width/height = 3.8 mm  → visible spacing at whole-LGU A3 scale
    //   stroke-width = 0.28 mm → reads as hatch, not a second solid fill
    //   stroke-opacity = 0.82 → strong enough over OSM / residential fills
    lines.push(
      `<pattern id="${commercialHatchPatternId(klass)}" patternUnits="userSpaceOnUse" ` +
        `width="3.8" height="3.8" patternTransform="rotate(45)">` +
        `<line x1="0" y1="0" x2="0" y2="3.8" ` +
        `stroke="${commercialHatchColorForClass(klass, slug)}" ` +
        `stroke-width="0.28" stroke-opacity="0.82"/>` +
        `</pattern>`
    );
  }
  lines.push(`</defs>`);

  // Water
  const waterFeats = water?.features ?? [];
  if (waterFeats.length) {
    lines.push(`<g id="water" stroke-linecap="round" stroke-linejoin="round">`);
    for (const f of waterFeats) {
      if (f.properties?.osm_kind !== "waterbody") continue;
      const d = geometryToPathD(f.geometry, project);
      if (!d) continue;
      lines.push(
        `<path d="${d}" fill="${PALETTE.waterFill}" ` +
          `stroke="${PALETTE.waterStroke}" stroke-width="0.15" fill-rule="evenodd"/>`
      );
    }
    for (const f of waterFeats) {
      if (f.properties?.osm_kind !== "waterway") continue;
      const sub = f.properties?.subtype;
      const w = sub === "river" ? 0.5 : sub === "stream" ? 0.3 : 0.2;
      const d = geometryToPathD(f.geometry, project);
      if (!d) continue;
      lines.push(
        `<path d="${d}" fill="none" stroke="${PALETTE.waterLine}" stroke-width="${w}"/>`
      );
    }
    lines.push(`</g>`);
  }

  // Buildings
  const buildingFeats = buildings?.features ?? [];
  if (buildingFeats.length) {
    lines.push(`<g id="buildings">`);
    for (const f of buildingFeats) {
      const d = geometryToPathD(f.geometry, project);
      if (!d) continue;
      lines.push(
        `<path d="${d}" fill="${PALETTE.buildingFill}" ` +
          `stroke="${PALETTE.buildingStroke}" stroke-width="0.08"/>`
      );
    }
    lines.push(`</g>`);
  }

  // SMV zones go BEFORE roads in paint order so the road network
  // renders on top as a visible reference layer. Standard cartographic
  // convention for choropleth + reference: data layer first (value
  // bands as colored background areas), reference layer on top (road
  // lines threading through). Fill opacity is 0.7 so the basemap
  // (buildings, water) still shows through subtly under classified
  // areas, and adjacent SMV classes don't read as hard blocks.
  //
  // smvBufferM > 0 widens ribbon-shaped zones (compactness < 0.15)
  // at render time. The source GeoJSON stays at the ordinance-true
  // 30 m depth-of-frontage; only the printed paper shows wider bands
  // for visual legibility against the basemap roads. The legend
  // should label this — see legendNote in the caller's layout.
  const zoneFeats = zones?.features ?? [];
  let zonesSummary = null;
  if (zoneFeats.length) {
    // Z-order policy (revised 2026-06-23):
    //   1. Higher-value classes ALWAYS render on top of lower-value
    //      classes. The expensive band is the one the reader needs
    //      to see — letting a wider, cheaper class swallow it is a
    //      bug (was happening on Besao Agawa: C-3 ₱1,490 disappeared
    //      under R-4 ₱1,230 because R-4's buffered ribbon was wider).
    //   2. Within a single value tier, bigger polygons go first so
    //      smaller inner polygons sit on top.
    // featureValue() resolves the primary class's value from
    // CLASSIFICATION_INFO; nullish values sort below everything.
    const featureValue = (f) => {
      const klass = residentialSolidZoneClass(f);
      const v = CLASSIFICATION_INFO[klass]?.value;
      return Number.isFinite(v) ? v : -Infinity;
    };
    const sorted = [...zoneFeats]
      .map((f) => ({ feat: f, area: featureArea(f), value: featureValue(f) }))
      .filter((x) => x.area > 0)
      .sort((a, b) => {
        // Lower value drawn FIRST (= underneath); higher value drawn
        // LAST (= on top).
        if (a.value !== b.value) return a.value - b.value;
        // Within a tier: bigger area drawn first, smaller on top.
        return b.area - a.area;
      });

    const byClass = {};
    let widened = 0;
    // Every classified zone prints as a solid color band — residential
    // class wins when both R + C are tagged on the same feature, falls
    // back to whatever class is present otherwise. Commercial hatching
    // is left to Illustrator post-processing.
    lines.push(`<g id="smv-residential-zones" fill-rule="evenodd" opacity="0.7">`);
    // Roads features (already loaded for the basemap render below) —
    // grab them up front and build a once-per-build bbox index so the
    // SMV widening loop's tier lookups are O(R) per polygon where R
    // is "roads near the polygon" instead of O(all roads).
    const roadFeats = roads?.features ?? [];
    const roadIndex = roadFeats.length ? buildRoadIndex(roadFeats) : [];

    // Per-tier widening counters surfaced in zonesSummary so the
    // build log can show, at a glance, how many polygons got each
    // tier's buffer value. Helps debug "why is this band so thin?"
    // when the SMV polygon happens to be far from any classified
    // road and falls back to smvBufferM.
    const widenedByTier = { national: 0, provincial: 0, barangay: 0, other: 0, fallback: 0 };
    // Per-barangay override counter — surfaces in zonesSummary so the
    // build log shows when a PER_BARANGAY_BUFFER_M override actually
    // fired vs. falling through to the tier default.
    let widenedByBarangayOverride = 0;
    // Build a barangay bbox index once so the per-polygon containment
    // lookup is fast. Empty list when barangays aren't available.
    // Defined locally — the wider barangayFeats const is initialized
    // later in the function (used by the boundary render pass).
    const _barangayFeatsForBufferLookup = barangays?.features ?? [];
    const barangayIndex = _barangayFeatsForBufferLookup.length
      ? buildBarangayIndex(_barangayFeatsForBufferLookup)
      : [];
    // Build the road corridor once for the whole LGU. Used to clip
    // each buffered SMV polygon so its rounded endpoints can't lobe
    // out past where the road actually goes. Skips silently if road
    // data is missing or the union step fails — the SMV widening
    // falls back to unclipped buffers in that case.
    let roadCorridor = null;
    let clippedToCorridor = 0;
    if (roadFeats.length) {
      const t0 = Date.now();
      roadCorridor = buildRoadCorridor(roadFeats);
      if (roadCorridor) {
        // Surfaced via zonesSummary so the build log can report build
        // time alongside the polygon counts.
        roadCorridor._buildMs = Date.now() - t0;
      }
    }

    for (const { feat: f } of sorted) {
      // Render-time widening: ribbon-shaped zones get buffered by N
      // meters per side. Priority for N:
      //   1. PER_BARANGAY_BUFFER_M["<slug>:<barangay>"]  — single barangay
      //   2. PER_BARANGAY_BUFFER_M["<slug>:*"]           — LGU-wide
      //   3. TIER_BUFFER_M[tier]                          — by road tier
      //   4. smvBufferM                                   — caller default
      // Original feature stays on disk untouched. If the buffer op
      // fails (degenerate geometry, self-intersection), fall back to
      // the un-buffered original so we never silently drop a real SMV
      // polygon.
      let renderFeat = f;
      if (ribbonCompactness(f) < RIBBON_COMPACTNESS) {
        let bufferM = smvBufferM;
        let centroid = null;
        try {
          centroid = turf.centroid(f);
          const tier = nearestRoadTier(centroid, roadIndex);
          if (tier && TIER_BUFFER_M[tier] != null) {
            bufferM = TIER_BUFFER_M[tier];
          }
        } catch {
          // centroid failed; fall back to smvBufferM
        }
        // Per-class buffer scale: higher-value classes get a tighter
        // buffer (stay close to road), lower-value classes get a
        // wider buffer (form a visible outer shoulder past the inner
        // tiers). Falls back to the tier/default value if the class
        // is unknown.
        const klass = residentialSolidZoneClass(f);
        if (klass) {
          bufferM = classBufferM(klass, bufferM);
        }
        // Per-barangay override wins over tier and class value. Only
        // attempt the lookup if we already have a centroid.
        if (centroid && barangayIndex.length) {
          const baranName = barangayForPoint(centroid, barangayIndex);
          const override = perBarangayBufferOverride(slug, baranName);
          if (override != null) {
            bufferM = override;
            widenedByBarangayOverride++;
          }
        }
        if (bufferM > 0) {
          try {
            const buffered = turf.buffer(f, bufferM, { units: "meters" });
            if (buffered?.geometry) {
              renderFeat = buffered;
              widened++;
              // Clip the buffered polygon to the road corridor so its
              // rounded endpoints can't lobe out past the road. Falls
              // through to unclipped buffer if the intersection fails
              // or returns empty (e.g. polygon is far from any road).
              if (roadCorridor) {
                try {
                  // turf v7 intersect takes a FeatureCollection of the
                  // polygons to intersect, not two positional args.
                  const clipped = turf.intersect(
                    turf.featureCollection([buffered, roadCorridor])
                  );
                  if (clipped?.geometry) {
                    renderFeat = clipped;
                    clippedToCorridor++;
                  }
                } catch {
                  // keep unclipped buffer
                }
              }
            }
          } catch {
            // keep original
          }
        }
      }
      const solidClass = residentialSolidZoneClass(f);
      if (solidClass) {
        const color = getZoneColor(solidClass, slug);
        const d = geometryToPathD(renderFeat.geometry, project);
        if (d) {
          // No stroke — overlapping buffered ribbons would stack their
          // hairlines into a visible darker outline at the seam. Fill-
          // only keeps adjacent classes reading as flat color blocks.
          lines.push(
            `<path d="${d}" fill="${color}" stroke="none" data-class="${escapeXml(solidClass)}"/>`
          );
          byClass[solidClass] = (byClass[solidClass] || 0) + 1;
        }
      }
      // Commercial hatch overlay is intentionally omitted from the
      // automated print pipeline. The cartographic story (which
      // parcels are commercial vs. residential) is added by hand in
      // Illustrator after export — gives the LGU cartographer fine
      // control over how each storefront strip is highlighted
      // without the SVG generator guessing.
    }
    lines.push(`</g>`);
    zonesSummary = {
      rendered: sorted.length,
      byClass,
      widened,
      widenedByBarangayOverride,
      clippedToCorridor,
      corridorBuildMs: roadCorridor?._buildMs ?? null,
      smvBufferM,
    };
  }

  // Road casing then fill, painted ON TOP of the SMV zones. Each
  // OSM highway tag maps to a Philippine road tier (national /
  // provincial / barangay / other) which selects both fill and
  // casing color. See PALETTE + roadFillForTier + roadCasingForTier.
  //
  // Paint order is bottom-to-top by tier: other → barangay →
  // provincial → national. Each tier emits its own casing + fill
  // group, so a national highway at an intersection paints OVER the
  // provincial / barangay roads it crosses — Mapnik convention. The
  // higher tier reads as continuous, the lower tier as terminating
  // at the intersection.
  //
  // Bridges over the road network get a bolder black casing (~2× the
  // normal casing offset). The yellow / orange / tan road fill paints
  // unchanged on top so the bridge section reads as "same road, dark
  // bookend edges" — the cartographic convention for at-a-glance
  // bridge identification on a topo / road plate.
  const roadFeats = roads?.features ?? [];
  if (roadFeats.length) {
    const TIER_PAINT_ORDER = ["other", "barangay", "provincial", "national"];
    const roadsByTier = { other: [], barangay: [], provincial: [], national: [] };
    for (const f of roadFeats) {
      const tier = roadTier(f.properties?.highway);
      roadsByTier[tier].push(f);
    }

    for (const tier of TIER_PAINT_ORDER) {
      const feats = roadsByTier[tier];
      if (!feats.length) continue;
      lines.push(
        `<g id="road-casing-${tier}" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      );
      for (const f of feats) {
        const hw = f.properties?.highway;
        const base = ROAD_WEIGHTS_MM[hw] ?? ROAD_DEFAULT_MM;
        const bridge = isBridge(f);
        const casing = bridge ? "#000000" : roadCasingForTier(tier);
        const casingW = bridge
          ? base + ROAD_CASING_OFFSET_MM * 2.2
          : base + ROAD_CASING_OFFSET_MM;
        const d = geometryToPathD(f.geometry, project);
        if (!d) continue;
        lines.push(
          `<path d="${d}" stroke="${casing}" stroke-width="${casingW.toFixed(2)}"/>`
        );
      }
      lines.push(`</g>`);
      lines.push(
        `<g id="road-fill-${tier}" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      );
      for (const f of feats) {
        const hw = f.properties?.highway;
        const base = ROAD_WEIGHTS_MM[hw] ?? ROAD_DEFAULT_MM;
        const color = roadFillForTier(tier);
        const d = geometryToPathD(f.geometry, project);
        if (!d) continue;
        lines.push(
          `<path d="${d}" stroke="${color}" stroke-width="${base.toFixed(2)}"/>`
        );
      }
      lines.push(`</g>`);
    }
  }

  // Barangay outlines
  const barangayFeats = barangays?.features ?? [];
  if (barangayFeats.length) {
    lines.push(
      `<g id="barangay-boundaries" fill="none" stroke="${PALETTE.barangayStroke}" ` +
        `stroke-width="0.25" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const f of barangayFeats) {
      const d = geometryToPathD(f.geometry, project);
      if (!d) continue;
      lines.push(`<path d="${d}"/>`);
    }
    lines.push(`</g>`);
  }

  // Municipal outline
  {
    const d = geometryToPathD(outlineFeature.geometry, project);
    if (d) {
      lines.push(
        `<g id="municipal-boundary" fill="none" stroke="${PALETTE.municipalityStroke}" ` +
          `stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round">`
      );
      lines.push(`<path d="${d}"/>`);
      lines.push(`</g>`);
    }
  }

  // Place labels.
  //
  // Each label is rendered as TWO grouped <text> elements: a wider
  // white-stroked "halo" copy underneath, then a pure black copy on
  // top. Some SVG renderers (notably Illustrator) ignore the
  // `paint-order="stroke"` hint and end up painting the stroke OVER
  // the fill — which is what made earlier exports look like white
  // text bleeding into the basemap color. The two-layer approach
  // works in every renderer because it doesn't rely on paint-order.
  //
  // Each label + its halo are wrapped in their own <g class="label">
  // so an Illustrator user can select and move them together.
  const placeFeats = places?.features ?? [];
  if (placeFeats.length) {
    lines.push(
      `<g id="place-labels" font-family="Arial, Helvetica, sans-serif" ` +
        `text-anchor="middle" dominant-baseline="middle" font-weight="700">`
    );
    for (const f of placeFeats) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates;
      const [x, y] = project(lon, lat);
      const name = f.properties?.name;
      if (!name) continue;
      const size = placeFontSizeMm(f.properties?.place);
      const haloWidth = (size * 0.32).toFixed(2);
      const label = escapeXml(name);
      const cx = fmt(x);
      const cy = fmt(y);
      const fs = size.toFixed(2);
      lines.push(`<g class="label">`);
      // Halo: thick white stroke + white fill so the outline is solid.
      lines.push(
        `<text x="${cx}" y="${cy}" font-size="${fs}" fill="${PALETTE.placeHalo}" ` +
          `stroke="${PALETTE.placeHalo}" stroke-width="${haloWidth}" stroke-linejoin="round">` +
          label +
          `</text>`
      );
      // Black text on top, no stroke — guaranteed visible regardless
      // of renderer behavior or background color.
      lines.push(
        `<text x="${cx}" y="${cy}" font-size="${fs}" fill="#000000">` +
          label +
          `</text>`
      );
      lines.push(`</g>`);
    }
    lines.push(`</g>`);
  }

  // ----- legend block (3 columns) -----
  // Layout (left → right):
  //   Col 1: Commercial SMV classes (C-1, C-2, C-3, …)
  //   Col 2: Residential SMV classes (R-1, R-2, R-3, …)
  //   Col 3: Road tiers (national / provincial / barangay / other)
  //
  // Each row is swatch + label + (optional) right-aligned ₱/m² value.
  // The full official schedule appears even before every class has been
  // digitized. This keeps the paper legend authoritative to the valuation
  // document rather than accidentally hiding undrawn classes.
  // Values come from <slug>_valuations.json via classValues.
  const legendClassKeys = Array.from(
    new Set([
      ...Object.keys(classValues),
      ...Object.keys(zonesSummary?.byClass ?? {}),
    ])
  );
  if (legendClassKeys.length > 0) {
    const presentClasses = legendClassKeys
      .filter((k) => k && k !== "UNCLASSIFIED")
      .sort((a, b) => {
        const [aCat, aNum] = a.split("-");
        const [bCat, bNum] = b.split("-");
        if (aCat !== bCat) return aCat.localeCompare(bCat);
        return parseInt(aNum, 10) - parseInt(bNum, 10);
      });

    const commercialClasses = presentClasses.filter((k) => k.startsWith("C-"));
    const residentialClasses = presentClasses.filter((k) => k.startsWith("R-"));
    const roadTiers = [
      { tier: "national", label: "National", fill: PALETTE.roadFillTrunk, casing: PALETTE.roadCasingTrunk },
      { tier: "provincial", label: "Provincial", fill: PALETTE.roadFillProvincial, casing: PALETTE.roadCasingProvincial },
      { tier: "barangay", label: "Barangay", fill: PALETTE.roadFillBarangay, casing: PALETTE.roadCasingBarangay },
      { tier: "other", label: "Other", fill: PALETTE.roadFill, casing: "#888" },
    ];

    if (presentClasses.length > 0) {
      // ---- "Unit Land Value Map" — 3-column legend ----
      // Layout (top → bottom):
      //   1. Big centered title:  UNIT LAND VALUE MAP
      //   2. Info block:          MUNICIPALITY / PROVINCE OF / ISLAND OF
      //   3. LEGEND: label
      //   4. Column headers:      Commercial | Residential | Roads
      //   5. Column rows (side by side, each column flows independently):
      //        - Commercial:  [swatch] C-N   ₱value
      //        - Residential: [swatch] R-N   ₱value
      //        - Roads:       [swatch] National/Provincial/Barangay/Other
      // Matches the Illustrator-tuned Barlig sheet so all 10 LGUs read
      // the same way for BIR / appraisers / banks / notaries.

      const PHP_PREFIX = "₱";
      const fmtValue = (v) =>
        v == null
          ? ""
          : `${PHP_PREFIX}${Number(v).toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })}`;

      // Roads column is always four fixed tiers, drawn as colored
      // swatches (not dashed lines) so the legend reads as colors
      // first — matches what's on the map after we color roads by
      // tier.
      const roadColor = {
        national: PALETTE.roadFillTrunk ?? "#facc15",
        provincial: PALETTE.roadFillProvincial ?? "#fb923c",
        barangay: PALETTE.roadFillBarangay ?? "#ffffff",
        other: PALETTE.roadFill ?? "#d4d4d8",
      };
      const roadCasing = {
        national: PALETTE.roadCasingTrunk ?? "#a16207",
        provincial: PALETTE.roadCasingProvincial ?? "#ea580c",
        barangay: PALETTE.roadCasingBarangay ?? "#737373",
        other: "#737373",
      };
      const commercialRows = commercialClasses.map((k) => ({
        label: k,
        swatchFill: colorForClass(k, slug),
        swatchStroke: "#374151",
        valueText: fmtValue(classValues[k]),
      }));
      const residentialRows = residentialClasses.map((k) => ({
        label: k,
        swatchFill: colorForClass(k, slug),
        swatchStroke: "#374151",
        valueText: fmtValue(classValues[k]),
      }));
      const roadRows = [
        { tier: "national", label: "National" },
        { tier: "provincial", label: "Provincial" },
        { tier: "barangay", label: "Barangay" },
        { tier: "other", label: "Other" },
      ].map((r) => ({
        label: r.label,
        swatchFill: roadColor[r.tier],
        swatchStroke: roadCasing[r.tier],
      }));

      // ---- Geometry ----
      const padMm = 4;

      // Each SMV column: [swatch][gap][label][gap][value]
      const smvSwatchW = 5;
      const smvSwatchH = 3.6;
      const smvLabelW = 7; // "C-1" … "R-15"
      const smvValueW = 15; // "₱6,240"
      const innerGapMm = 1.2;
      const smvColWidth =
        smvSwatchW + innerGapMm + smvLabelW + innerGapMm + smvValueW;

      // Roads column: [swatch][gap][label] (no value)
      const roadSwatchW = 7;
      const roadSwatchH = 4.5;
      const roadLabelW = 14; // "Provincial"
      const roadColWidth = roadSwatchW + innerGapMm + roadLabelW;

      const colGapMm = 5;
      const innerWidthMm =
        smvColWidth + colGapMm + smvColWidth + colGapMm + roadColWidth;
      const legendWidthMm = padMm * 2 + innerWidthMm;

      const titleHeightMm = 9;
      const infoLineHeightMm = 4.5;
      const infoRowsHeightMm = 3 * infoLineHeightMm;
      const legendLabelHeightMm = 5;
      const colHeaderHeightMm = 5;
      const smvRowHeightMm = 4.6;
      const roadRowHeightMm = 5.6;

      const dataRows = Math.max(
        commercialRows.length,
        residentialRows.length,
        roadRows.length
      );
      // Rows in commercial/residential cols are smvRowHeightMm; road
      // rows are taller, but only used on the right column. Block
      // height = max of per-column run heights.
      const colHeightMm = Math.max(
        commercialRows.length * smvRowHeightMm,
        residentialRows.length * smvRowHeightMm,
        roadRows.length * roadRowHeightMm
      );
      void dataRows;

      const legendHeightMm =
        padMm * 2 +
        titleHeightMm +
        infoRowsHeightMm +
        legendLabelHeightMm +
        colHeaderHeightMm +
        colHeightMm;

      const legendX = PAPER_W_MM - PAGE_MARGIN_MM - legendWidthMm;
      const legendY = PAPER_H_MM - PAGE_MARGIN_MM - legendHeightMm;
      const muniText = (municipalityName ?? slug).toUpperCase();
      const provinceText = "MOUNTAIN PROVINCE";
      const islandText = "LUZON";

      lines.push(`<g id="legend" font-family="Helvetica, Arial, sans-serif">`);
      lines.push(
        `<rect x="${fmt(legendX)}" y="${fmt(legendY)}" width="${fmt(
          legendWidthMm
        )}" ` +
          `height="${fmt(
            legendHeightMm
          )}" fill="#ffffff" fill-opacity="0.96" ` +
          `stroke="#1f2937" stroke-width="0.4"/>`
      );

      let cursorY = legendY + padMm;

      // ---- Title ----
      lines.push(
        `<text x="${fmt(legendX + legendWidthMm / 2)}" y="${fmt(
          cursorY + titleHeightMm * 0.72
        )}" ` +
          `font-size="6" font-weight="700" fill="#000000" text-anchor="middle">` +
          `UNIT LAND VALUE MAP` +
          `</text>`
      );
      cursorY += titleHeightMm;

      // ---- Info block ----
      const infoRows = [
        ["MUNICIPALITY:", muniText],
        ["PROVINCE OF:", provinceText],
        ["ISLAND OF:", islandText],
      ];
      const infoLabelX = legendX + padMm;
      const infoValueX = legendX + padMm + 28;
      for (const [k, v] of infoRows) {
        const y = cursorY + infoLineHeightMm * 0.72;
        lines.push(
          `<text x="${fmt(infoLabelX)}" y="${fmt(
            y
          )}" font-size="3.2" font-weight="700" fill="#000000">` +
            escapeXml(k) +
            `</text>`
        );
        lines.push(
          `<text x="${fmt(infoValueX)}" y="${fmt(
            y
          )}" font-size="3.2" font-weight="700" fill="#000000">` +
            escapeXml(v) +
            `</text>`
        );
        cursorY += infoLineHeightMm;
      }

      // ---- LEGEND: label ----
      lines.push(
        `<text x="${fmt(legendX + padMm)}" y="${fmt(
          cursorY + legendLabelHeightMm * 0.72
        )}" font-size="3.4" font-weight="700" fill="#000000">` +
          `LEGEND:` +
          `</text>`
      );
      cursorY += legendLabelHeightMm;

      // ---- Column header row with underline ----
      const colCommercialX = legendX + padMm;
      const colResidentialX = colCommercialX + smvColWidth + colGapMm;
      const colRoadsX = colResidentialX + smvColWidth + colGapMm;
      {
        const y = cursorY + colHeaderHeightMm * 0.6;
        const headers = [
          { label: "Commercial", x: colCommercialX, width: smvColWidth },
          { label: "Residential", x: colResidentialX, width: smvColWidth },
          { label: "Roads", x: colRoadsX, width: roadColWidth },
        ];
        for (const h of headers) {
          lines.push(
            `<text x="${fmt(h.x)}" y="${fmt(
              y
            )}" font-size="3.4" font-weight="700" fill="#000000">` +
              escapeXml(h.label) +
              `</text>`
          );
          const ulY = cursorY + colHeaderHeightMm - 0.6;
          lines.push(
            `<line x1="${fmt(h.x)}" y1="${fmt(ulY)}" x2="${fmt(
              h.x + h.width
            )}" y2="${fmt(ulY)}" stroke="#000000" stroke-width="0.3"/>`
          );
        }
      }
      cursorY += colHeaderHeightMm;

      // ---- Row renderers ----
      // Commercial + Residential rows: small swatch + label + value
      const renderSmvRow = (row, colX, rowIndex) => {
        const rowY = cursorY + rowIndex * smvRowHeightMm;
        const sY = rowY + (smvRowHeightMm - smvSwatchH) / 2;
        const baselineY = rowY + smvRowHeightMm * 0.72;
        lines.push(
          `<rect x="${fmt(colX)}" y="${fmt(sY)}" width="${fmt(
            smvSwatchW
          )}" height="${fmt(smvSwatchH)}" fill="${row.swatchFill}" stroke="${
            row.swatchStroke
          }" stroke-width="0.25"/>`
        );
        const labelX = colX + smvSwatchW + innerGapMm;
        lines.push(
          `<text x="${fmt(labelX)}" y="${fmt(
            baselineY
          )}" font-size="3" font-weight="700" fill="#000000">` +
            escapeXml(row.label) +
            `</text>`
        );
        if (row.valueText) {
          const valueRightX = colX + smvColWidth;
          lines.push(
            `<text x="${fmt(valueRightX)}" y="${fmt(
              baselineY
            )}" font-size="3" font-weight="700" fill="#000000" text-anchor="end">` +
              escapeXml(row.valueText) +
              `</text>`
          );
        }
      };

      // Road rows: bigger color block + label
      const renderRoadRow = (row, colX, rowIndex) => {
        const rowY = cursorY + rowIndex * roadRowHeightMm;
        const sY = rowY + (roadRowHeightMm - roadSwatchH) / 2;
        const baselineY = rowY + roadRowHeightMm * 0.7;
        lines.push(
          `<rect x="${fmt(colX)}" y="${fmt(sY)}" width="${fmt(
            roadSwatchW
          )}" height="${fmt(roadSwatchH)}" fill="${row.swatchFill}" stroke="${
            row.swatchStroke
          }" stroke-width="0.3"/>`
        );
        const labelX = colX + roadSwatchW + innerGapMm;
        lines.push(
          `<text x="${fmt(labelX)}" y="${fmt(
            baselineY
          )}" font-size="3" font-weight="700" fill="#000000">` +
            escapeXml(row.label) +
            `</text>`
        );
      };

      commercialRows.forEach((row, i) => renderSmvRow(row, colCommercialX, i));
      residentialRows.forEach((row, i) =>
        renderSmvRow(row, colResidentialX, i)
      );
      roadRows.forEach((row, i) => renderRoadRow(row, colRoadsX, i));

      lines.push(`</g>`);
    }
  }

  lines.push(`</svg>`);
  return { svg: lines.join("\n"), zonesSummary };
}

// ---------- Convenience: load + build in one call ----------

// Loads every available per-LGU GeoJSON from `publicDataDir`,
// builds the SVG, and returns the result. Used both by the CLI
// (passes the local public/data path) and by the API route (same
// path inside the Next.js process). `opts.smvBufferM` widens
// ribbon SMV zones at render time only — source data on disk stays
// at the authoritative 30 m legal width.
// Extract a class → ₱/m² value map from the LGU's valuations.json
// (the canonical schedule transcription). Walks land_classifications
// looking for { sub_classification, unit_value_2027_per_sqm } pairs.
// Falls back to {} silently if the file is missing or empty (e.g.
// Besao's valuations.json is just per-barangay overrides).
function extractClassValues(valuations) {
  const out = {};
  if (!valuations) return out;
  const lc = valuations.land_classifications;
  if (!Array.isArray(lc)) return out;
  for (const cat of lc) {
    if (!Array.isArray(cat?.items)) continue;
    for (const it of cat.items) {
      const klass = it?.sub_classification;
      const value = it?.unit_value_2027_per_sqm;
      if (klass && value != null && !out[klass]) {
        out[klass] = value;
      }
    }
  }
  return out;
}

function mergeFeatureCollections(...collections) {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) =>
      Array.isArray(collection?.features) ? collection.features : []
    ),
  };
}

export function buildSvgForSlug(slug, publicDataDir, opts = {}) {
  const file = (name) => path.join(publicDataDir, name);
  const outline = readJsonOptional(file(`${slug}.geojson`));
  if (!outline) {
    throw new Error(
      `Missing public/data/${slug}.geojson — run boundaries:fetch:${slug}`
    );
  }
  const valuations = readJsonOptional(file(`${slug}_valuations.json`));
  const classValues = extractClassValues(valuations);
  return buildSvg({
    slug,
    outline,
    barangays: readJsonOptional(file(`${slug}_barangays.geojson`)),
    zones: readJsonOptional(file(`${slug}_zones.geojson`)),
    water: readJsonOptional(file(`${slug}_osm_water.geojson`)),
    buildings: readJsonOptional(file(`${slug}_osm_buildings.geojson`)),
    roads: mergeFeatureCollections(
      readJsonOptional(file(`${slug}_osm_roads.geojson`)),
      readJsonOptional(file(`${slug}_print_roads.geojson`))
    ),
    places: readJsonOptional(file(`${slug}_osm_places.geojson`)),
    smvBufferM: opts.smvBufferM,
    classValues,
    municipalityName: valuations?.municipality ?? slug,
    revisionYear: valuations?.revision_year ?? null,
  });
}
