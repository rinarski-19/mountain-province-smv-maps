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
  isCommercialClass,
  isResidentialClass,
} from "./classifications.js";
import {
  filterProviderPoiFeatureCollection,
  LANDMARK_KIND_OPTIONS,
  landmarkIconPath,
  normalizeLandmarkKind,
} from "./landmark-icons.js";
import {
  isInsideLandmarkLabel,
  normalizeLandmarkLabelPlacement,
  normalizeLandmarkLabelSize,
} from "./landmark-labels.js";

// ---------- Paper / palette / scale constants ----------

// A3 portrait, mm. 6 mm bleed-safe margin (matches @page rule in the
// app's existing print CSS so output is consistent).
export const PAPER_W_MM = 297;
export const PAPER_H_MM = 420;
export const PAPER_ORIENTATIONS = Object.freeze({
  portrait: { widthMm: PAPER_W_MM, heightMm: PAPER_H_MM },
  landscape: { widthMm: PAPER_H_MM, heightMm: PAPER_W_MM },
});
export const PAGE_MARGIN_MM = 4;

export function normalizePrintOrientation(value) {
  return String(value ?? "").toLowerCase() === "landscape"
    ? "landscape"
    : "portrait";
}

export function paperSizeForOrientation(value) {
  return PAPER_ORIENTATIONS[normalizePrintOrientation(value)];
}

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
const SMV_LABEL_COLLISION_PAD_MM = 0.35;
// Print roads use the base cartographic widths. SMV ribbons handle their
// own print label padding, so roads should not get an extra print-only buff.
const PRINT_ROAD_WIDTH_SCALE = 1;
const BARANGAY_ROAD_WIDTH_SCALE = 1;

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

// Per-barangay print crop (opt-in via buildSvg's `barangayName`). Two
// margins around the target barangay's own boundary:
//   - BARANGAY_CROP_MARGIN_M sets the actual page bbox (how much
//     neighboring context bleeds onto the sheet).
//   - BARANGAY_FEATURE_FILTER_MARGIN_M is wider and decides which
//     water/building/road/place/zone features are worth including at
//     all before the (expensive) per-feature render loops run. It must
//     stay comfortably larger than the crop margin so edge-of-frame SMV
//     polygons don't lose their nearest-road tier lookup (see
//     TIER_BUFFER_MAX_DIST_M above) just because the road that defines
//     their tier sits a little outside the visible page.
const BARANGAY_CROP_MARGIN_M = 20;
const BARANGAY_FEATURE_FILTER_MARGIN_M = 500;

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// Cheap bbox-overlap prefilter — NOT a geometric clip. Keeps any
// feature whose own bounding box touches `bbox`. Used to shrink the
// whole-municipality water/buildings/roads/places/zones layers down to
// "stuff plausibly visible on this barangay's sheet" before rendering.
// Features that survive but still fall slightly outside the page just
// render off-canvas, clipped by the SVG's default overflow — harmless.
function featureCollectionNearBbox(fc, bbox) {
  if (!fc?.features?.length || !bbox) return fc;
  return {
    type: "FeatureCollection",
    features: fc.features.filter((f) => {
      if (!f?.geometry) return false;
      try {
        return bboxesOverlap(turf.bbox(f), bbox);
      } catch {
        return true;
      }
    }),
  };
}

// Point labels need an exact barangay membership test after the bbox
// prefilter. Otherwise a landmark just outside the selected barangay can
// still draw its external callout across the boundary before the SVG clip
// trims it, leaving a misleading partial label on the print.
function featureCollectionPointsInside(fc, polygon) {
  if (!fc?.features?.length || !polygon) return fc;
  return {
    type: "FeatureCollection",
    features: fc.features.filter((feature) => {
      if (feature?.geometry?.type !== "Point") return false;
      try {
        return turf.booleanPointInPolygon(
          turf.point(feature.geometry.coordinates),
          polygon,
          { ignoreBoundary: false }
        );
      } catch {
        return false;
      }
    }),
  };
}

// Exact (case-insensitive, trimmed) match against barangays.features'
// properties.name. Callers are expected to resolve any aliasing between
// the LGU schedule's canonical barangay name and the PSA/OSM boundary
// file's spelling BEFORE calling buildSvg — see the per-LGU
// slugForXName() helpers in lib/<slug>.js (e.g. "Kin-iway" (schedule)
// vs. "Kin-iway (Pob.)" (boundary file)) — so this stays a dumb exact
// match instead of duplicating that alias logic here.
function findBarangayFeature(barangays, barangayName) {
  const target = String(barangayName ?? "").trim().toLowerCase();
  if (!target) return null;
  return (
    (barangays?.features ?? []).find(
      (f) => String(f?.properties?.name ?? "").trim().toLowerCase() === target
    ) ?? null
  );
}

function printLabelKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

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

function drawRoadLayers(lines, roadFeatures, project, roadWidthScale = 1) {
  if (!roadFeatures?.length) return;
  const TIER_PAINT_ORDER = ["other", "barangay", "provincial", "national"];
  const roadsByTier = { other: [], barangay: [], provincial: [], national: [] };
  for (const f of roadFeatures) {
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
      const base = (ROAD_WEIGHTS_MM[hw] ?? ROAD_DEFAULT_MM) * roadWidthScale;
      const bridge = isBridge(f);
      const casing = bridge ? "#000000" : roadCasingForTier(tier);
      const casingW = bridge
        ? base + ROAD_CASING_OFFSET_MM * roadWidthScale * 2.2
        : base + ROAD_CASING_OFFSET_MM * roadWidthScale;
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
      const base = (ROAD_WEIGHTS_MM[hw] ?? ROAD_DEFAULT_MM) * roadWidthScale;
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

// ---------- Helpers ----------

function readJsonOptional(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function makeProjection(bbox, paperW, paperH, fitFrame = null) {
  const [west, south, east, north] = bbox;
  const midLat = (north + south) / 2;
  // Web-mercator-aware horizontal squash: at 17°N (Mountain Province)
  // 1° longitude is ~95% as wide as 1° latitude. Without this the
  // LGU prints slightly stretched east-west.
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const effW = (east - west) * lonScale;
  const effH = north - south;
  const dataAspect = effW / effH;

  const frame =
    fitFrame ?? {
      x: PAGE_MARGIN_MM,
      y: PAGE_MARGIN_MM,
      width: paperW - 2 * PAGE_MARGIN_MM,
      height: paperH - 2 * PAGE_MARGIN_MM,
    };
  const usableW = frame.width;
  const usableH = frame.height;
  const paperAspect = usableW / usableH;

  let drawW, drawH;
  if (dataAspect > paperAspect) {
    drawW = usableW;
    drawH = drawW / dataAspect;
  } else {
    drawH = usableH;
    drawW = drawH * dataAspect;
  }
  const offsetX = frame.x + (usableW - drawW) / 2;
  const offsetY = frame.y + (usableH - drawH) / 2;

  return {
    project: (lon, lat) => [
      offsetX + ((lon - west) * lonScale) / effW * drawW,
      offsetY + ((north - lat) / effH) * drawH,
    ],
    unproject: (x, y) => [
      west + ((x - offsetX) / drawW * effW) / lonScale,
      north - ((y - offsetY) / drawH) * effH,
    ],
    drawWidthMm: drawW,
    drawHeightMm: drawH,
    offsetX,
    offsetY,
  };
}

function printMapFitFrame(paperW, paperH, printOrientation, hasBarangayTarget) {
  if (!hasBarangayTarget) return null;
  const sideInset = PAGE_MARGIN_MM + 1.5;
  // Barangay plates read better when the map owns the upper sheet and the
  // fixed legend/prepared-by furniture owns the footer. Otherwise the map is
  // centered against the entire A3 page, wasting a lot of visible paper above
  // the barangay and making detailed barangays like Bontoc Poblacion feel
  // smaller than they need to be.
  const footerReserve = printOrientation === "landscape" ? 62 : 104;
  const topInset = PAGE_MARGIN_MM + (printOrientation === "landscape" ? 2 : 4);
  return {
    x: sideInset,
    y: topInset,
    width: paperW - sideInset * 2,
    height: paperH - topInset - footerReserve,
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

const ZONE_LABEL_GRID_RATIOS = [
  0.06,
  0.17,
  0.28,
  0.39,
  0.5,
  0.61,
  0.72,
  0.83,
  0.94,
];

function featureBoundarySegments(feature) {
  const segments = [];
  const addRing = (ring) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1];
      const b = ring[i];
      if (
        Array.isArray(a) &&
        Array.isArray(b) &&
        Number.isFinite(a[0]) &&
        Number.isFinite(a[1]) &&
        Number.isFinite(b[0]) &&
        Number.isFinite(b[1])
      ) {
        segments.push([a, b]);
      }
    }
  };
  const geometry = feature?.geometry;
  if (geometry?.type === "Polygon") {
    for (const ring of geometry.coordinates ?? []) addRing(ring);
  } else if (geometry?.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates ?? []) {
      for (const ring of polygon ?? []) addRing(ring);
    }
  }
  return segments;
}

function pointSegmentDistanceMeters(pointCoord, segment) {
  const [lon, lat] = pointCoord;
  const [[lon1, lat1], [lon2, lat2]] = segment;
  const metersPerDegLat = 111_320;
  const metersPerDegLon =
    Math.cos((lat * Math.PI) / 180) * metersPerDegLat || metersPerDegLat;
  const px = lon * metersPerDegLon;
  const py = lat * metersPerDegLat;
  const ax = lon1 * metersPerDegLon;
  const ay = lat1 * metersPerDegLat;
  const bx = lon2 * metersPerDegLon;
  const by = lat2 * metersPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointBoundaryClearanceMeters(point, segments) {
  const coord = point?.geometry?.coordinates;
  if (!Array.isArray(coord) || !segments.length) return 0;
  let minDistance = Infinity;
  for (const segment of segments) {
    minDistance = Math.min(minDistance, pointSegmentDistanceMeters(coord, segment));
  }
  return Number.isFinite(minDistance) ? minDistance : 0;
}

// Candidate points for a zone label. pointOnFeature is useful, but for long
// frontage ribbons its first valid point can land in a skinny tail. Rank the
// deterministic candidates by their clearance from the polygon boundary so
// labels prefer the widest interior pocket.
function zoneLabelPointCandidates(feature) {
  const points = [];
  const add = (point) => {
    if (!point?.geometry || point.geometry.type !== "Point") return;
    const key = point.geometry.coordinates.map((v) => Number(v).toFixed(8)).join(",");
    if (!points.some((p) => p.key === key)) points.push({ key, point });
  };
  try {
    add(turf.pointOnFeature(feature));
  } catch {}
  try {
    add(turf.centroid(feature));
  } catch {}
  try {
    const [west, south, east, north] = turf.bbox(feature);
    for (const yRatio of ZONE_LABEL_GRID_RATIOS) {
      for (const xRatio of ZONE_LABEL_GRID_RATIOS) {
        add(
          turf.point([
            west + (east - west) * xRatio,
            south + (north - south) * yRatio,
          ])
        );
      }
    }
  } catch {}
  const segments = featureBoundarySegments(feature);
  let center = null;
  try {
    center = turf.centerOfMass(feature).geometry.coordinates;
  } catch {}
  return points
    .map(({ point }, index) => {
      let inside = false;
      try {
        inside = turf.booleanPointInPolygon(point, feature, {
          ignoreBoundary: true,
        });
      } catch {}
      const coord = point.geometry.coordinates;
      const centerPenalty = center
        ? Math.hypot(coord[0] - center[0], coord[1] - center[1]) * 111_320
        : 0;
      return {
        point,
        index,
        inside,
        clearance: inside ? pointBoundaryClearanceMeters(point, segments) : -1,
        centerPenalty,
      };
    })
    .sort((a, b) => {
      if (a.inside !== b.inside) return a.inside ? -1 : 1;
      if (b.clearance !== a.clearance) return b.clearance - a.clearance;
      if (a.centerPenalty !== b.centerPenalty) {
        return a.centerPenalty - b.centerPenalty;
      }
      return a.index - b.index;
    })
    .map(({ point }) => point);
}

function visibleZoneLabelPoint(entry, drawIndex, entries, extraPredicate = null) {
  for (const point of zoneLabelPointCandidates(entry.feat)) {
    try {
      if (
        !turf.booleanPointInPolygon(point, entry.feat, {
          ignoreBoundary: true,
        })
      ) {
        continue;
      }
      const coveredByDifferentClass = entries
        .slice(drawIndex + 1)
        .some(
          (later) =>
            later.klass !== entry.klass &&
            turf.booleanPointInPolygon(point, later.feat, {
              ignoreBoundary: true,
            })
        );
      if (!coveredByDifferentClass && (!extraPredicate || extraPredicate(point))) {
        return point;
      }
    } catch {}
  }
  return null;
}

function labelBoxFitsFeature(feature, x, y, width, height, unproject) {
  if (typeof unproject !== "function") return true;
  try {
    const samples = [
      [x - width / 2, y - height / 2],
      [x, y - height / 2],
      [x + width / 2, y - height / 2],
      [x + width / 2, y],
      [x + width / 2, y + height / 2],
      [x, y + height / 2],
      [x - width / 2, y + height / 2],
      [x - width / 2, y],
      [x, y],
    ].map(([px, py]) => turf.point(unproject(px, py)));
    // booleanContains is too strict for several imported SMV polygons that
    // have duplicate/self-intersecting vertices but still render correctly
    // in SVG. Testing the label box's perimeter and center directly keeps the
    // label inside the visible footprint and also supports MultiPolygons.
    return samples.every((point) =>
      turf.booleanPointInPolygon(point, feature, { ignoreBoundary: false })
    );
  } catch {
    return false;
  }
}

function labelBoxOverlapsAny(box, occupiedBoxes) {
  return occupiedBoxes.some(
    (other) =>
      box.minX < other.maxX &&
      box.maxX > other.minX &&
      box.minY < other.maxY &&
      box.maxY > other.minY
  );
}

function paddedLabelBox(box, pad = SMV_LABEL_COLLISION_PAD_MM) {
  return {
    minX: box.minX - pad,
    maxX: box.maxX + pad,
    minY: box.minY - pad,
    maxY: box.maxY + pad,
  };
}

// Print equivalent of the editor's "Inside SMV class — above icon" mode.
// The landmark icon is the visual anchor: keep the label centered directly
// above it instead of moving the text to a different interior point or
// falling back to a side callout when the SMV footprint is small.
function landmarkLabelScale(value) {
  if (value === "small") return 0.72;
  if (value === "medium") return 0.86;
  return 1;
}

function aboveIconLandmarkLabel(
  name,
  iconX,
  iconY,
  labelSize = "large",
  { compact = false } = {}
) {
  // A whole-municipality sheet is an overview, not a close-up POI map.
  // Keep its labels readable at A3 scale, but give dense town centers a
  // much smaller annotation footprint than barangay sheets.
  const maxWidth = compact ? 22 : 34;
  const hasExplicitBreak = /\r?\n/.test(String(name ?? ""));
  const scale = landmarkLabelScale(labelSize) * (compact ? 0.64 : 1);
  const fontSizes = (compact
    ? [2.25, 2.05, 1.85, 1.65, 1.45, 1.25]
    : [3.4, 3.1, 2.8, 2.5, 2.2, 1.9]
  ).map(
    (size) => size * scale
  );
  for (const fontSize of fontSizes) {
    const maxChars = Math.max(
      10,
      Math.floor(maxWidth / Math.max(1, fontSize * 0.62))
    );
    const lines = hasExplicitBreak
      ? labelLines(name)
      : wrappedLabelLines(name, maxChars);
    const lineStep = fontSize * 1.15;
    const textWidth =
      Math.max(...lines.map((line) => line.length), 1) * fontSize * 0.62;
    if (textWidth > maxWidth) continue;
    const textHeight = Math.max(fontSize, lines.length * lineStep);
    const y = iconY - 3.4 - textHeight / 2;
    return {
      x: iconX,
      y,
      fontSize,
      lineStep,
      lines,
      width: textWidth,
      height: textHeight,
      rectX: iconX - textWidth / 2,
      rectY: y - textHeight / 2,
    };
  }
  return null;
}

function calloutLandmarkLabel(
  name,
  iconX,
  iconY,
  labelSize = "large",
  placement = "callout-right",
  { compact = false } = {}
) {
  const nameLines = labelLines(name);
  const labelScale = landmarkLabelScale(labelSize) * (compact ? 0.64 : 1);
  const fontSize = (compact ? 1.35 : 2.05) * labelScale;
  const lineStep = (compact ? 1.55 : 2.25) * labelScale;
  const maxLineLength = Math.max(...nameLines.map((line) => line.length), 1);
  const width = Math.max(
    compact ? 5 : 8,
    maxLineLength * (compact ? 0.82 : 1.28) * labelScale + (compact ? 0.8 : 1.2)
  );
  const height = Math.max(
    compact ? 2.4 : 3.5,
    nameLines.length * lineStep + (compact ? 0.5 : 0.8)
  );
  const gap = compact ? 1.8 : 2.8;
  const key = normalizeLandmarkLabelPlacement(placement);
  if (key === "callout-left") {
    const textX = iconX - gap;
    const textY = iconY;
    return {
      lines: nameLines,
      fontSize,
      lineStep,
      rectX: textX - width + 0.6,
      rectY: textY - height / 2,
      width,
      height,
      textX,
      textY,
      textAnchor: "end",
    };
  }
  if (key === "callout-top" || key === "callout-bottom") {
    const textX = iconX;
    const textY =
      key === "callout-top"
        ? iconY - 3.4 - height / 2
        : iconY + 3.4 + height / 2;
    return {
      lines: nameLines,
      fontSize,
      lineStep,
      rectX: textX - width / 2,
      rectY: textY - height / 2,
      width,
      height,
      textX,
      textY,
      textAnchor: "middle",
    };
  }
  const textX = iconX + gap;
  const textY = iconY;
  return {
    lines: nameLines,
    fontSize,
    lineStep,
    rectX: textX - 0.6,
    rectY: textY - height / 2,
    width,
    height,
    textX,
    textY,
    textAnchor: "start",
  };
}

function getZoneClass(feat) {
  return (feat?.properties?.classification ?? "").toUpperCase();
}

// Print uses the shared classification palette so the live map, editor,
// legend, and paper export all show the same close red/yellow shades.
function printColorForClass(klass, slug) {
  return colorForClass(klass, slug);
}

function getZoneColor(klass, slug) {
  return printColorForClass(klass, slug);
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

// Commercial/residential category colors are now solid on print. Keep this
// empty so the old experimental C-1/C-2 hatch treatment cannot override the
// requested category-color treatment.
const HATCH_TEST_CLASSES = new Set();

function commercialHatchPatternId(klass) {
  return `smv-commercial-hatch-${String(klass ?? "C").replace(/[^A-Z0-9-]/gi, "-")}`;
}

function commercialHatchClipId(index, klass) {
  return `smv-commercial-hatch-clip-${String(klass ?? "C").replace(/[^A-Z0-9-]/gi, "-")}-${index}`;
}

function renderCommercialHatchLines({ feat, klass, clipId, project }) {
  const bounds = geometryProjectedBounds(feat.geometry, project);
  if (!bounds) return "";
  const color = printColorForClass(klass, null);
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
  const color = printColorForClass(klass, null);
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

// Tree-merge union: repeatedly halve the array, unioning pairs. Same
// approach as buildRoadCorridor's road-buffer merge — O(n log n) unions
// of 2 polygons each instead of one big n-way union, which matters once
// a class has dozens+ of separate ribbon segments. Falls back to keeping
// one half unmerged on any union failure so a bad polygon never wipes out
// the rest of the group.
function unionAllPolygons(feats) {
  if (!feats?.length) return null;
  let current = feats;
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
        next.push(u?.geometry ? u : a);
      } catch {
        next.push(a);
      }
    }
    current = next;
  }
  return current[0] ?? null;
}

// Unions same-class zone polygons into one feature per class, so
// adjacent/overlapping same-class zones (e.g. two buffered SMV ribbons
// that touch along a road) share a single clean outer boundary instead of
// each drawing its own edge — the fix for a doubled/darker stroke where
// same-class polygons meet. `entries` is [{feat, klass}, ...]; a class
// whose union fails keeps its polygons separate rather than silently
// dropping one.
function joinZonesByClass(entries) {
  const byClass = new Map();
  for (const entry of entries) {
    if (!entry?.feat?.geometry || !entry.klass) continue;
    const group = byClass.get(entry.klass) ?? [];
    group.push(entry.feat);
    byClass.set(entry.klass, group);
  }
  const joined = [];
  for (const [klass, feats] of byClass) {
    if (feats.length === 1) {
      joined.push({ feat: feats[0], klass });
      continue;
    }
    const unioned = unionAllPolygons(feats);
    if (unioned?.geometry) {
      joined.push({
        feat: {
          type: "Feature",
          properties: { classification: klass },
          geometry: unioned.geometry,
        },
        klass,
      });
    } else {
      for (const feat of feats) joined.push({ feat, klass });
    }
  }
  return joined;
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelLines(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
}

function wrappedLabelLines(value, maxChars) {
  const limit = Math.max(8, Number(maxChars) || 8);
  return labelLines(value).flatMap((line) => {
    if (!line || line.length <= limit) return [line];
    const words = line.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = "";
    for (const word of words) {
      if (word.length > limit) {
        if (current) chunks.push(current);
        for (let i = 0; i < word.length; i += limit) {
          chunks.push(word.slice(i, i + limit));
        }
        current = "";
        continue;
      }
      const next = current ? `${current} ${word}` : word;
      if (next.length > limit) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [line];
  });
}

const LANDMARK_COLORS = Object.fromEntries(
  LANDMARK_KIND_OPTIONS.map((option) => [option.value, option.color])
);

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
// Default print output must match the saved/live SMV geometry. If a wider,
// schematic plate is ever wanted, the API can opt in with ?smvBuffer=N.
const PRINT_RIBBON_BUFFER_M = 0;
// Besao testing: tiny building-footprint reference outlines can disappear on
// paper. Give only very small houses a slight render-only nudge; avoid a
// global buffer because dense settlements quickly overlap into blobs.
const PRINT_BUILDING_FOOTPRINT_BUFFER_M = 0.75;
const PRINT_BUILDING_FOOTPRINT_SMALL_AREA_M2 = 25;

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

// `smvBufferM` can override the default print ribbon widening. Source data
// on disk stays at its authoritative width (the 30 m depth-of-frontage from
// the LGU SMV ordinance) — only the printed paper shows the wider bands.
export function buildSvg({
  slug,
  outline,
  barangays,
  zones,
  water,
  buildings,
  roads,
  parcels,
  places,
  landmarks,
  orientation = "portrait",
    // Keep the saved/live geometry unchanged. The print renderer applies a
    // modest ribbon-only widening by default so frontage class labels fit;
    // callers can still provide smvBufferM for a different print width.
  smvBufferM = 0,
  showBuildingFootprints = null,
  showLocationLegend = false,
  locationLegendRows = [],
  classValues = {},
  municipalityName = null,
  revisionYear = null,
  // Optional: crop the sheet to one barangay instead of the whole
  // municipality. Must be the EXACT barangays.geojson properties.name
  // (callers resolve any LGU-schedule-vs-boundary-file spelling
  // aliasing before calling in — see findBarangayFeature() above).
  barangayName = null,
}) {
  if (!outline) throw new Error(`Missing outline for ${slug}`);
  const outlineFeature = outline.features?.[0];
  if (!outlineFeature) throw new Error(`Empty outline FC for ${slug}`);
  const printOrientation = normalizePrintOrientation(orientation);
  const { widthMm: paperW, heightMm: paperH } =
    paperSizeForOrientation(printOrientation);

  let targetBarangayFeature = null;
  if (barangayName) {
    targetBarangayFeature = findBarangayFeature(barangays, barangayName);
    if (!targetBarangayFeature) {
      throw new Error(
        `Barangay "${barangayName}" not found in ${slug}_barangays.geojson`
      );
    }
  }
  const isWholeMunicipalityPrint = !targetBarangayFeature;

  // Whole-municipality bbox by default. A barangay-scoped sheet instead
  // fits to that barangay's own extent (+ context margin), and the
  // heavy layers below get pre-filtered to roughly the same area so we
  // don't spend time projecting/rendering geometry nobody will see.
  let bbox = turf.bbox(outlineFeature);
  let renderBarangays = barangays;
  let renderZones = zones;
  let renderWater = water;
  let renderBuildings = buildings;
  let renderRoads = roads;
  let renderParcels = parcels;
  let renderPlaces = places;
  let renderLandmarks = landmarks;
  if (targetBarangayFeature) {
    bbox = turf.bbox(
      turf.buffer(targetBarangayFeature, BARANGAY_CROP_MARGIN_M, {
        units: "meters",
      })
    );
    const filterBbox = turf.bbox(
      turf.buffer(targetBarangayFeature, BARANGAY_FEATURE_FILTER_MARGIN_M, {
        units: "meters",
      })
    );
    renderZones = featureCollectionNearBbox(zones, filterBbox);
    renderWater = featureCollectionNearBbox(water, filterBbox);
    renderBuildings = featureCollectionNearBbox(buildings, filterBbox);
    renderRoads = featureCollectionNearBbox(roads, filterBbox);
    renderParcels = featureCollectionNearBbox(parcels, filterBbox);
    renderPlaces = featureCollectionPointsInside(
      featureCollectionNearBbox(places, filterBbox),
      targetBarangayFeature
    );
    renderLandmarks = featureCollectionPointsInside(
      featureCollectionNearBbox(landmarks, filterBbox),
      targetBarangayFeature
    );
    // renderBarangays stays the full set — the boundary-overlay loop
    // and the PER_BARANGAY_BUFFER_M lookup below both want every
    // barangay polygon, not just the target's.
  }
  const proj = makeProjection(
    bbox,
    paperW,
    paperH,
    printMapFitFrame(paperW, paperH, printOrientation, Boolean(targetBarangayFeature))
  );
  const project = proj.project;
  const lines = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
      `width="${paperW}mm" height="${paperH}mm" ` +
      `viewBox="0 0 ${paperW} ${paperH}" ` +
      `data-slug="${escapeXml(slug)}"` +
      ` data-orientation="${escapeXml(printOrientation)}"` +
      (targetBarangayFeature
        ? ` data-barangay="${escapeXml(barangayName)}"`
        : "") +
      ` data-generated="${new Date().toISOString()}">`
  );
  lines.push(
    `<style><![CDATA[` +
      `@page{size:${paperW}mm ${paperH}mm;margin:0}` +
      `html,body{margin:0;padding:0;width:${paperW}mm;height:${paperH}mm;overflow:hidden}` +
      `svg{display:block;width:${paperW}mm;height:${paperH}mm;max-width:none;max-height:none}` +
      `@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}` +
      `]]></style>`
  );
  lines.push(
    `<rect x="0" y="0" width="${paperW}" height="${paperH}" fill="${PALETTE.paper}"/>`
  );
  lines.push(`<defs>`);
  // Per-class hatch shape. "grid" = axis-aligned horizontal + vertical
  // lines (square cells, like graph paper). "vertical" = vertical lines
  // only (no horizontal). Classes not listed here fall back to "grid".
  // Add more classes/styles here as needed — tile size and stroke width
  // are shared (HATCH_TILE_MM / HATCH_STROKE_MM below).
  const HATCH_STYLE_BY_CLASS = {
    "C-1": "grid",
    "C-2": "vertical",
  };
  const HATCH_TILE_MM = 1.0;
  const HATCH_STROKE_MM = 0.22;
  for (const klass of ["C-1", "C-2", "C-3", "C-4"]) {
    // stroke-opacity = 1 → full, undiluted color (true book RGB, not
    // faded toward pink/white).
    const hatchColor = printColorForClass(klass, slug);
    const lineAttrs =
      `stroke="${hatchColor}" stroke-width="${HATCH_STROKE_MM}" stroke-opacity="1"`;
    const style = HATCH_STYLE_BY_CLASS[klass] ?? "grid";
    const verticalLine =
      `<line x1="0" y1="0" x2="0" y2="${HATCH_TILE_MM}" ${lineAttrs}/>`;
    const horizontalLine =
      `<line x1="0" y1="0" x2="${HATCH_TILE_MM}" y2="0" ${lineAttrs}/>`;
    const patternBody =
      style === "vertical" ? verticalLine : horizontalLine + verticalLine;
    lines.push(
      `<pattern id="${commercialHatchPatternId(klass)}" patternUnits="userSpaceOnUse" ` +
        `width="${HATCH_TILE_MM}" height="${HATCH_TILE_MM}">` +
        patternBody +
        `</pattern>`
    );
  }
  // On a barangay-scoped sheet, everything geographic (water, buildings,
  // zones, roads, other barangays' outlines, the municipal outline,
  // place labels, landmarks) gets clipped to the target barangay's own
  // polygon — outside it, the page stays plain white. The bold subject
  // boundary and the legend are drawn later, OUTSIDE this clip, so the
  // boundary stroke isn't cut in half at the clip edge and the legend
  // box is never affected by it.
  const barangayClipId = "barangay-print-clip";
  if (targetBarangayFeature) {
    const clipD = geometryToPathD(targetBarangayFeature.geometry, project);
    lines.push(
      `<clipPath id="${barangayClipId}"><path d="${clipD}"/></clipPath>`
    );
  }
  lines.push(`</defs>`);
  if (targetBarangayFeature) {
    lines.push(`<g clip-path="url(#${barangayClipId})">`);
  }

  // Water
  const waterFeats = renderWater?.features ?? [];
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
  const buildingFeats = renderBuildings?.features ?? [];
  const showBuildingFootprintsOverSmv =
    showBuildingFootprints ?? Boolean(targetBarangayFeature);
  if (buildingFeats.length && !showBuildingFootprintsOverSmv) {
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
  // Narrow ribbon-shaped zones (compactness < 0.15) receive the print-only
  // widening defined above. The saved GeoJSON and live map are unchanged.
  const zoneFeats = renderZones?.features ?? [];
  let zonesSummary = null;
  const zoneLabelEntries = [];
  const smvBoundaryEntries = [];
  if (zoneFeats.length) {
    // Paint order must match the live Leaflet layer: source GeoJSON order.
    // Sorting by value made some overlapping classes look "cleaner" on paper,
    // but it also meant print could disagree with the web map. The print
    // exporter should not reinterpret overlap priority behind the user's back.
    const sorted = zoneFeats
      .map((f) => ({ feat: f, area: featureArea(f) }))
      .filter((x) => x.area > 0);

    const byClass = {};
    let widened = 0;
    // Every classified zone prints as a solid color band — residential
    // class wins when both R + C are tagged on the same feature, falls
    // back to whatever class is present otherwise. Commercial hatching
    // is left to Illustrator post-processing.
    lines.push(`<g id="smv-residential-zones" fill-rule="evenodd" opacity="0.7">`);
    // Legacy summary counters. Road-tier/corridor clipping and automatic
    // SMV widening are disabled for normal print output so the print plate
    // honors the same joined/cut shapes shown on the live map.
    const widenedByBarangayOverride = 0;
    const clippedToCorridor = 0;

    // Keep every source feature as its own SVG path. The live map paints
    // the saved GeoJSON features directly; joining them here would erase
    // boundaries and make the print silhouette differ from the web map.
    const primaryEntries = [];
    const effectiveRibbonBufferM =
      Number.isFinite(smvBufferM) && smvBufferM > 0
        ? smvBufferM
        : PRINT_RIBBON_BUFFER_M;

    for (const { feat: f } of sorted) {
      // Render-time widening is explicit opt-in only (?smvBuffer=N). The
      // default path renders each saved source feature exactly, matching the
      // live map. If the buffer op fails (degenerate geometry,
      // self-intersection), fall back to the original.
      let renderFeat = f;
      if (
        effectiveRibbonBufferM > 0 &&
        ribbonCompactness(f) < RIBBON_COMPACTNESS
      ) {
        const bufferM = effectiveRibbonBufferM;
        if (bufferM > 0) {
          try {
            const buffered = turf.buffer(f, bufferM, { units: "meters" });
            if (buffered?.geometry) {
              renderFeat = buffered;
              widened++;
            }
          } catch {
            // keep original
          }
        }
      }
      const solidClass = residentialSolidZoneClass(f);
      const d = geometryToPathD(renderFeat.geometry, project);
      if (solidClass && d) {
        byClass[solidClass] = (byClass[solidClass] || 0) + 1;
        primaryEntries.push({ renderFeat, solidClass, originalFeat: f, d });
        smvBoundaryEntries.push({ d, solidClass });
      }
    }

    // Draw each saved source feature separately. This preserves the same
    // shape and internal boundaries visible in the live Leaflet map.
    for (const { renderFeat, originalFeat, solidClass, d } of primaryEntries) {
      const fill = HATCH_TEST_CLASSES.has(solidClass)
        ? `url(#${commercialHatchPatternId(solidClass)})`
        : getZoneColor(solidClass, slug);
      lines.push(
        `<path d="${d}" fill="${fill}" stroke="#000000" stroke-width="0.15" ` +
          `data-class="${escapeXml(solidClass)}"/>`
      );
      // Institutional keeps its blue-violet fill, but the class name is
      // already clear in the legend and should not be stamped inside every
      // institutional footprint on the printed map.
        if (
          solidClass !== "INSTITUTIONAL" ||
          String(originalFeat?.properties?.label_text ?? "").trim()
        ) {
        zoneLabelEntries.push({
          feat: renderFeat,
          klass: solidClass,
          drawIndex: zoneLabelEntries.length,
        });
      }
    }

    // Secondary/tertiary classification overlay: residentialSolidZoneClass()
    // only ever picks ONE class to paint solid (residential wins when both
    // are tagged), so a feature like classification=C-1 + secondary=R-1
    // used to paint as flat R-1 with the C-1 tag silently dropped. Here,
    // whichever commercial class is found among primary/secondary/tertiary
    // (see commercialHatchZoneClass — checks all three) gets drawn as a
    // hatch overlay ON TOP of the solid base, as long as it's not the same
    // class already painted solid above (avoids double-drawing a pure
    // commercial-only feature). Stays per-ORIGINAL-feature (not joined) —
    // the overlay is spatially specific to whichever individual parcel
    // carries the secondary tag, not the whole merged class shape.
    for (const { originalFeat: f, solidClass, d } of primaryEntries) {
      const hatchClass = commercialHatchZoneClass(f);
      if (hatchClass && hatchClass !== solidClass && HATCH_TEST_CLASSES.has(hatchClass)) {
        lines.push(
          `<path d="${d}" fill="url(#${commercialHatchPatternId(hatchClass)})" ` +
            `stroke="none" data-class="${escapeXml(hatchClass)}" data-overlay="secondary"/>`
        );
        byClass[hatchClass] = (byClass[hatchClass] || 0) + 1;
      }
    }
    lines.push(`</g>`);
    zonesSummary = {
      rendered: sorted.length,
      byClass,
      widened,
      widenedByBarangayOverride,
      clippedToCorridor,
      corridorBuildMs: null,
      effectiveRibbonBufferM,
      smvBufferM,
    };
  }

  // Cadastral parcel boundaries sit above the SMV fills but below roads.
  // They are intentionally line-only so the SMV class colors remain visible
  // underneath while road casings and fills remain legible on top.
  const parcelFeats = renderParcels?.features ?? [];
  if (parcelFeats.length) {
    lines.push(
      `<g id="parcels" fill="none" stroke="#111827" stroke-width="0.10" ` +
        `stroke-opacity="0.62" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const f of parcelFeats) {
      const d = geometryToPathD(f.geometry, project);
      if (!d) continue;
      lines.push(
        `<path d="${d}" data-layer="parcels" ` +
          `data-parcel-id="${escapeXml(f.properties?.parcel_id ?? "")}"/>`
      );
    }
    lines.push(`</g>`);
  }

  // Barangay building-footprint layer: draw Overture/OSM house/building
  // footprints like subtle cadastral parcel lines above the SMV fill. Only
  // tiny footprints are gently enlarged on paper; applying the buffer to every
  // house made dense settlements overlap badly.
  if (showBuildingFootprintsOverSmv && buildingFeats.length) {
    lines.push(
      `<g id="building-footprints" fill="none" stroke="#374151" stroke-width="0.12" ` +
        `stroke-opacity="0.36" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const f of buildingFeats) {
      let renderFeat = f;
      try {
        const areaM2 =
          Number.isFinite(f.properties?.area_m2) && f.properties.area_m2 > 0
            ? f.properties.area_m2
            : turf.area(f);
        if (areaM2 > 0 && areaM2 < PRINT_BUILDING_FOOTPRINT_SMALL_AREA_M2) {
          const buffered = turf.buffer(f, PRINT_BUILDING_FOOTPRINT_BUFFER_M, {
            units: "meters",
            steps: 2,
          });
          if (buffered?.geometry) renderFeat = buffered;
        }
      } catch {
        // Keep original footprint if the geometry is too small/odd to inspect.
      }
      const d = geometryToPathD(renderFeat.geometry, project);
      if (!d) continue;
      lines.push(
        `<path d="${d}" data-layer="building-footprints" ` +
          `data-osm-id="${escapeXml(f.properties?.osm_id ?? "")}"/>`
      );
    }
    lines.push(`</g>`);
  }

  // Solid grey SMV outlines sit above parcel lines so adjacent classes remain
  // legible in dense cadastral areas. Roads are drawn after these outlines but
  // before all text/POI annotations, keeping the network visible without
  // cutting through labels.
  if (smvBoundaryEntries.length) {
    lines.push(
      `<g id="smv-boundaries" fill="none" stroke="#6b7280" stroke-width="0.14" ` +
        `stroke-opacity="0.82" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const { d } of smvBoundaryEntries) {
      lines.push(`<path d="${d}" data-layer="smv-boundaries"/>`);
    }
    lines.push(`</g>`);
  }

  const roadFeats = renderRoads?.features ?? [];
  const roadWidthScale =
    PRINT_ROAD_WIDTH_SCALE *
    (targetBarangayFeature ? BARANGAY_ROAD_WIDTH_SCALE : 1);

  // Barangay outlines
  const barangayFeats = renderBarangays?.features ?? [];
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

  // Road overlay. Roads sit above SMV fills, building footprints, and class
  // outlines, but below SMV labels, place labels, and landmark callouts.
  drawRoadLayers(lines, roadFeats, project, roadWidthScale);

  // SMV class labels. Use pointOnFeature rather than a raw centroid so the
  // label remains inside concave and irregular zones. The live map's
  // permanent labels are parcel-focused, but printed maps need the class
  // code on every sufficiently large saved SMV zone.
  if (zoneLabelEntries.length) {
    lines.push(
      `<g id="zone-class-labels" font-family="Arial, Helvetica, sans-serif" ` +
        `text-anchor="middle" dominant-baseline="middle" font-weight="700" ` +
        `fill="#171717">`
    );
    const labelCandidates = zoneLabelEntries
      .map(({ feat, klass, drawIndex }) => {
        const bounds = geometryProjectedBounds(feat?.geometry, project);
        if (!bounds) return null;
        return {
          feat,
          klass,
          drawIndex,
          bounds,
          // Prioritize meaningful SMV footprints, not long thin road
          // ribbons whose projected bounding boxes can look deceptively
          // large even though they have almost no usable label area.
          area: featureArea(feat),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.area - a.area);
    const occupiedLabelBoxes = [];
    const labeledClasses = new Set();
    const labeledDrawIndexes = new Set();
    for (const { feat, klass, bounds, drawIndex } of labelCandidates) {
      try {
        const customLabel = String(feat?.properties?.label_text ?? "").trim();
        const classLabel =
          customLabel || CLASSIFICATION_INFO[klass]?.label || klass;
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        let point = null;
        let fontSize = 0;
        let textWidth = 0;
        let textHeight = 0;
        let vertical = false;
        // Prefer a normal horizontal label. Rotate only if no horizontal
        // label can fit completely inside the feature; the bbox aspect ratio
        // alone is not enough to justify rotating a readable label.
        for (const tryVertical of [false, true]) {
          const maxFontSize = Math.min(
            2.2,
            tryVertical
              ? width / 0.95
              : width / Math.max(1, classLabel.length * 0.72),
            tryVertical
              ? height / Math.max(1, classLabel.length * 0.62)
              : height * 0.32
          );
          // Keep horizontal labels readable, but allow them to shrink before
          // trying a vertical orientation. This matters for long class codes
          // such as R-10 in a polygon that is narrow only at its centroid.
          if (maxFontSize < 0.75) continue;
          const fontSizes = Array.from(
            new Set(
              [
                maxFontSize,
                maxFontSize * 0.9,
                maxFontSize * 0.8,
                maxFontSize * 0.7,
                maxFontSize * 0.6,
              ].map((size) => Number(size.toFixed(3)))
            )
          ).filter((size) => size >= 0.75);
          for (const candidateFontSize of fontSizes) {
            const candidateTextWidth = tryVertical
              ? candidateFontSize * 0.95
              : candidateFontSize * classLabel.length * 0.62;
            const candidateTextHeight = tryVertical
              ? candidateFontSize * classLabel.length * 0.62
              : candidateFontSize * 0.95;
            const candidatePoint = visibleZoneLabelPoint(
              { feat, klass },
              drawIndex,
              zoneLabelEntries,
              (candidate) => {
                const [candidateX, candidateY] = project(
                  candidate.geometry.coordinates[0],
                  candidate.geometry.coordinates[1]
                );
                return labelBoxFitsFeature(
                  feat,
                  candidateX,
                  candidateY,
                  candidateTextWidth,
                  candidateTextHeight,
                  proj.unproject
                ) && !labelBoxOverlapsAny(
                  paddedLabelBox({
                    minX: candidateX - candidateTextWidth / 2,
                    maxX: candidateX + candidateTextWidth / 2,
                    minY: candidateY - candidateTextHeight / 2,
                    maxY: candidateY + candidateTextHeight / 2,
                  }),
                  occupiedLabelBoxes
                );
              }
            );
            if (candidatePoint) {
              point = candidatePoint;
              fontSize = candidateFontSize;
              textWidth = candidateTextWidth;
              textHeight = candidateTextHeight;
              vertical = tryVertical;
              break;
            }
          }
          if (point) break;
        }
        if (!point) continue;
        const [lon, lat] = point.geometry.coordinates;
        const [x, y] = project(lon, lat);
        const box = {
          minX: x - textWidth / 2,
          maxX: x + textWidth / 2,
          minY: y - textHeight / 2,
          maxY: y + textHeight / 2,
        };
        const overlaps = labelBoxOverlapsAny(
          paddedLabelBox(box),
          occupiedLabelBoxes
        );
        if (overlaps) continue;
        occupiedLabelBoxes.push(paddedLabelBox(box));
        const rotation = vertical
          ? ` transform="rotate(-90 ${fmt(x)} ${fmt(y)})"`
          : "";
        lines.push(
          `<text x="${fmt(x)}" y="${fmt(y)}"${rotation} font-size="${fontSize.toFixed(2)}" ` +
            `stroke="#ffffff" stroke-width="${Math.max(0.08, fontSize * 0.13).toFixed(2)}" ` +
            `paint-order="stroke" stroke-linejoin="round">${escapeXml(classLabel)}</text>`
        );
        labeledClasses.add(klass);
        labeledDrawIndexes.add(drawIndex);
      } catch {}
    }

    // A narrow road-facing class can fail the normal visibility test when
    // every preferred candidate is covered by a later polygon or collides
    // with another label. Give each class one readable, contained fallback
    // in its largest usable footprint instead of shrinking text into every
    // tiny fragment.
    for (const klass of new Set(zoneLabelEntries.map((entry) => entry.klass))) {
      // Institutional is represented by its fill color and legend. Do not
      // let this emergency pass re-add the word after the normal pass
      // suppresses it.
      if (klass === "INSTITUTIONAL") continue;
      if (labeledClasses.has(klass)) continue;
      const classLabel = CLASSIFICATION_INFO[klass]?.label ?? klass;
      let fallbackPoint = null;
      let fallbackFontSize = 0;
      let fallbackVertical = false;
      const fallbackEntries = labelCandidates.filter((entry) => entry.klass === klass);
      // Use the same horizontal-first rule for the guaranteed class label,
      // then rotate only if the horizontal box cannot fit at all. Search all
      // polygons of this class; the largest one is not always the most
      // label-friendly after roads and concave boundaries are accounted for.
      for (const tryVertical of [false, true]) {
        for (const fontSize of [1.4, 1.2, 1.0, 0.9, 0.8, 0.75, 0.65, 0.55]) {
          const textWidth = tryVertical
            ? fontSize * 0.95
            : fontSize * classLabel.length * 0.62;
          const textHeight = tryVertical
            ? fontSize * classLabel.length * 0.62
            : fontSize * 0.95;
          for (const fallbackEntry of fallbackEntries) {
            for (const candidate of zoneLabelPointCandidates(fallbackEntry.feat)) {
              try {
                if (
                  !turf.booleanPointInPolygon(candidate, fallbackEntry.feat, {
                    ignoreBoundary: true,
                  })
                ) {
                  continue;
                }
                const [candidateX, candidateY] = project(
                  candidate.geometry.coordinates[0],
                  candidate.geometry.coordinates[1]
                );
                if (
                  !labelBoxFitsFeature(
                    fallbackEntry.feat,
                    candidateX,
                    candidateY,
                    textWidth,
                    textHeight,
                    proj.unproject
                  )
                ) {
                  continue;
                }
                const box = {
                  minX: candidateX - textWidth / 2,
                  maxX: candidateX + textWidth / 2,
                  minY: candidateY - textHeight / 2,
                  maxY: candidateY + textHeight / 2,
                };
                if (labelBoxOverlapsAny(paddedLabelBox(box), occupiedLabelBoxes)) {
                  continue;
                }
                // This is the class-guarantee pass. Containment and spacing
                // are both mandatory; merged class text is worse than a
                // missing duplicate on a very small ribbon.
                fallbackPoint = {
                  candidate,
                  drawIndex: fallbackEntry.drawIndex,
                  x: candidateX,
                  y: candidateY,
                  box: paddedLabelBox(box),
                };
                fallbackFontSize = fontSize;
                fallbackVertical = tryVertical;
                break;
              } catch {}
            }
            if (fallbackPoint) break;
          }
          if (fallbackPoint) break;
        }
        if (fallbackPoint) break;
      }
      // Last resort for malformed imported geometry: keep the number at a
      // verified interior point rather than dropping the class completely.
      // The normal path above still requires the whole text box to fit; this
      // branch is only reached when the source ring itself prevents that
      // geometric test from succeeding.
      if (!fallbackPoint) {
        for (const fallbackEntry of fallbackEntries) {
          for (const candidate of zoneLabelPointCandidates(fallbackEntry.feat)) {
            try {
              if (
                !turf.booleanPointInPolygon(candidate, fallbackEntry.feat, {
                  ignoreBoundary: false,
                })
              ) {
                continue;
              }
              const [candidateX, candidateY] = project(
                candidate.geometry.coordinates[0],
                candidate.geometry.coordinates[1]
              );
              const fontSize = 0.75;
              const textWidth = fontSize * classLabel.length * 0.62;
              const textHeight = fontSize * 0.95;
              const box = {
                minX: candidateX - textWidth / 2,
                maxX: candidateX + textWidth / 2,
                minY: candidateY - textHeight / 2,
                maxY: candidateY + textHeight / 2,
              };
              if (labelBoxOverlapsAny(paddedLabelBox(box), occupiedLabelBoxes)) {
                continue;
              }
              fallbackPoint = {
                candidate,
                drawIndex: fallbackEntry.drawIndex,
                x: candidateX,
                y: candidateY,
                box: paddedLabelBox(box),
              };
              fallbackFontSize = fontSize;
              fallbackVertical = false;
              break;
            } catch {}
          }
          if (fallbackPoint) break;
        }
      }
      if (!fallbackPoint) continue;
      occupiedLabelBoxes.push(fallbackPoint.box);
      const rotation = fallbackVertical
        ? ` transform="rotate(-90 ${fmt(fallbackPoint.x)} ${fmt(fallbackPoint.y)})"`
        : "";
      lines.push(
        `<text x="${fmt(fallbackPoint.x)}" y="${fmt(fallbackPoint.y)}"${rotation} ` +
          `font-size="${fallbackFontSize.toFixed(2)}" ` +
          `stroke="#ffffff" stroke-width="${Math.max(0.08, fallbackFontSize * 0.13).toFixed(2)}" ` +
          `paint-order="stroke" stroke-linejoin="round">${escapeXml(classLabel)}</text>`
      );
      labeledClasses.add(klass);
      if (fallbackPoint.drawIndex != null) {
        labeledDrawIndexes.add(fallbackPoint.drawIndex);
      }
    }

    // Final fallback-label pass: if a source SMV fragment is too awkward for
    // the normal contained-box rules, still stamp its class at an interior
    // anchor. Tiny fragments stay tiny, but large joined frontage ribbons
    // should not collapse to unreadable 0.72 mm text just because their
    // legal 30 m depth is narrow on paper.
    for (const { feat, klass, bounds, drawIndex } of labelCandidates) {
      // Custom labels are handled by the normal pass. This fallback should
      // never stamp the generic Institutional class name.
      if (klass === "INSTITUTIONAL") continue;
      if (labeledDrawIndexes.has(drawIndex)) continue;
      const classLabel = CLASSIFICATION_INFO[klass]?.label ?? klass;
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      const longest = Math.max(width, height);
      const shortest = Math.min(width, height);
      const areaM2 = featureArea(feat);
      const preferredVertical = height > width * 2.2 && width < 4;
      const fallbackCap =
        areaM2 > 5000 || longest > 35
          ? 1.55
          : areaM2 > 1200 || longest > 16
          ? 1.25
          : 0.82;
      const fallbackTarget = Math.max(
        longest * 0.045,
        shortest > 1 ? shortest * 0.78 : 0.7
      );
      const baseFontSize = Math.max(
        0.58,
        Math.min(fallbackCap, fallbackTarget)
      );
      const fontSizes = Array.from(
        new Set(
          [
            baseFontSize,
            baseFontSize * 0.88,
            baseFontSize * 0.76,
            baseFontSize * 0.64,
            0.52,
          ].map((size) => Number(size.toFixed(3)))
        )
      ).filter((size) => size >= 0.48);
      const orientations = preferredVertical ? [true, false] : [false, true];
      let placement = null;
      for (const allowCovered of [false, true]) {
        for (const vertical of orientations) {
          for (const fontSize of fontSizes) {
            const textWidth = vertical
              ? fontSize * 0.95
              : fontSize * classLabel.length * 0.62;
            const textHeight = vertical
              ? fontSize * classLabel.length * 0.62
              : fontSize * 0.95;
            const pad = fontSize < 0.65 ? 0.18 : SMV_LABEL_COLLISION_PAD_MM;
            for (const candidate of zoneLabelPointCandidates(feat)) {
              try {
                if (
                  !turf.booleanPointInPolygon(candidate, feat, {
                    ignoreBoundary: false,
                  })
                ) {
                  continue;
                }
                if (!allowCovered) {
                  const coveredByDifferentClass = zoneLabelEntries
                    .slice(drawIndex + 1)
                    .some(
                      (later) =>
                        later.klass !== klass &&
                        turf.booleanPointInPolygon(candidate, later.feat, {
                          ignoreBoundary: true,
                        })
                    );
                  if (coveredByDifferentClass) continue;
                }
                const [candidateLon, candidateLat] = candidate.geometry.coordinates;
                const [candidateX, candidateY] = project(candidateLon, candidateLat);
                const box = {
                  minX: candidateX - textWidth / 2,
                  maxX: candidateX + textWidth / 2,
                  minY: candidateY - textHeight / 2,
                  maxY: candidateY + textHeight / 2,
                };
                if (labelBoxOverlapsAny(paddedLabelBox(box, pad), occupiedLabelBoxes)) {
                  continue;
                }
                placement = {
                  x: candidateX,
                  y: candidateY,
                  box: paddedLabelBox(box, pad),
                  fontSize,
                  vertical,
                };
                break;
              } catch {}
            }
            if (placement) break;
          }
          if (placement) break;
        }
        if (placement) break;
      }
      if (!placement) {
        continue;
      }
      occupiedLabelBoxes.push(placement.box);
      const rotation = placement.vertical
        ? ` transform="rotate(-90 ${fmt(placement.x)} ${fmt(placement.y)})"`
        : "";
      lines.push(
        `<text x="${fmt(placement.x)}" y="${fmt(placement.y)}"${rotation} font-size="${placement.fontSize.toFixed(2)}" ` +
          `stroke="#ffffff" stroke-width="${Math.max(0.06, placement.fontSize * 0.12).toFixed(2)}" ` +
          `paint-order="stroke" stroke-linejoin="round" opacity="0.92">${escapeXml(classLabel)}</text>`
      );
      labeledDrawIndexes.add(drawIndex);
    }
    lines.push(`</g>`);
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
  const occupiedPrintAnnotationBoxes = [];
  const placeFeats = renderPlaces?.features ?? [];
  const targetBarangayPlaceKey = targetBarangayFeature
    ? printLabelKey(barangayName || targetBarangayFeature.properties?.name)
    : "";
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
      if (
        targetBarangayPlaceKey &&
        printLabelKey(name) === targetBarangayPlaceKey
      ) {
        continue;
      }
      const size = placeFontSizeMm(f.properties?.place);
      const placeBox = {
        minX: x - (name.length * size * 0.62) / 2,
        maxX: x + (name.length * size * 0.62) / 2,
        minY: y - size / 2,
        maxY: y + size / 2,
      };
      if (
        isWholeMunicipalityPrint &&
        labelBoxOverlapsAny(placeBox, occupiedPrintAnnotationBoxes)
      ) {
        continue;
      }
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
      if (isWholeMunicipalityPrint) {
        occupiedPrintAnnotationBoxes.push(placeBox);
      }
    }
    lines.push(`</g>`);
  }

  if (targetBarangayFeature) {
    // Close the geographic-content clip group opened right after <defs>.
    // Landmarks are drawn after this boundary pass so POI pins and callout
    // labels remain the top annotation layer instead of being crossed by
    // roads or the bold barangay outline.
    lines.push(`</g>`);

    // Redraw the subject barangay's own boundary in bold, UNCLIPPED, so
    // the stroke isn't cut in half at the clip edge (a clipped stroke
    // only shows its inner half-width) — gives a clean line right at
    // the white/content boundary.
    const targetD = geometryToPathD(targetBarangayFeature.geometry, project);
    if (targetD) {
      lines.push(
        `<g id="barangay-boundary-target" fill="none" ` +
          `stroke="${PALETTE.municipalityStroke}" stroke-width="0.6" ` +
          `stroke-linecap="round" stroke-linejoin="round">`
      );
      lines.push(`<path d="${targetD}"/>`);
      lines.push(`</g>`);
    }
  }

  // Landmark pins — rendered on top of SMV zones, boundaries, place labels,
  // roads, and the bold subject-barangay outline.
  const landmarkFeats = renderLandmarks?.features ?? [];
  if (landmarkFeats.length) {
    lines.push(
      `<g id="landmarks" font-family="Helvetica, Arial, sans-serif" ` +
        `font-weight="400">`
    );
    const landmarkEntries = landmarkFeats
      .map((feature, index) => ({
        feature,
        index,
        // Preserve all labels on barangay sheets. On the overview sheet,
        // keep public-service anchors visible before lower-priority POIs
        // when two labels compete for the same small piece of paper.
        priority:
          isWholeMunicipalityPrint
            ? {
                hospital: 100,
                school: 90,
                govt: 80,
                tourism: 70,
                business: 60,
                clinic: 55,
                food: 50,
                lodging: 45,
                fuel: 40,
                shop: 30,
              }[normalizeLandmarkKind(feature?.properties?.kind)] ?? 20
            : 0,
      }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index);

    for (const { feature: f } of landmarkEntries) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates;
      const [x, y] = project(lon, lat);
      const props = f.properties ?? {};
      const name = props.name;
      if (!name) continue;
      const kind = normalizeLandmarkKind(props.kind);
      const iconPath = escapeXml(landmarkIconPath(kind));
      const iconColor = LANDMARK_COLORS[kind] || LANDMARK_COLORS.business;
      const labelPlacement = normalizeLandmarkLabelPlacement(
        props.label_placement || props.labelPlacement
      );
      const labelSize = normalizeLandmarkLabelSize(
        props.label_size || props.labelSize
      );
      const compact = isWholeMunicipalityPrint;
      const cx = fmt(x);
      const cy = fmt(y);
      // Teardrop marker: rotate a rounded square, then rotate the
      // symbol back upright. Sized for A3 barangay prints.
      lines.push(`<g class="landmark" data-kind="${escapeXml(kind)}">`);
      lines.push(
        `<g transform="translate(${cx} ${cy})">` +
          `<rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="1.8" ` +
          `transform="rotate(-45)" fill="${iconColor}" stroke="#ffffff" ` +
          `stroke-width="0.58"/>` +
          `<rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="1.8" ` +
          `transform="rotate(-45)" fill="none" stroke="#1f2937" ` +
          `stroke-width="0.13" opacity="0.55"/>` +
          `<path d="${iconPath}" transform="translate(-1.2 -1.2) scale(0.1)" ` +
          `fill="none" stroke="#ffffff" stroke-width="1.7" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>` +
          `</g>`
      );
      const containedLabel =
        isInsideLandmarkLabel(labelPlacement)
          ? aboveIconLandmarkLabel(name, x, y, labelSize, { compact })
          : null;

      if (containedLabel) {
        const {
          x: textX,
          y: textY,
          fontSize,
          lineStep,
          lines: nameLines,
          rectX,
          rectY,
          width,
          height,
        } = containedLabel;
        const labelBox = {
          minX: rectX - (compact ? 0.45 : 0),
          maxX: rectX + width + (compact ? 0.45 : 0),
          minY: rectY - (compact ? 0.45 : 0),
          maxY: rectY + height + (compact ? 0.45 : 0),
        };
        if (
          compact &&
          labelBoxOverlapsAny(labelBox, occupiedPrintAnnotationBoxes)
        ) {
          lines.push(`</g>`);
          continue;
        }
        const textStartY = textY - ((nameLines.length - 1) * lineStep) / 2;
        const labelLinesXml = nameLines
          .map(
            (line, index) =>
              `<tspan x="${fmt(textX)}" dy="${index === 0 ? 0 : lineStep}">${escapeXml(line)}</tspan>`
          )
          .join("");
        // The selected above-icon mode keeps the name centered over its pin,
        // matching the live editor even when the local SMV footprint is too
        // small to contain the entire multiline name.
        lines.push(
          `<text x="${fmt(textX)}" y="${fmt(textStartY)}" font-size="${fontSize.toFixed(2)}" ` +
            `font-weight="400" text-anchor="middle" dominant-baseline="middle" ` +
            `fill="#0f172a" stroke="#ffffff" stroke-width="0.38" ` +
            `paint-order="stroke" stroke-linejoin="round">${labelLinesXml}</text>`
        );
        if (compact) occupiedPrintAnnotationBoxes.push(labelBox);
      } else {
        const callout = calloutLandmarkLabel(
          name,
          x,
          y,
          labelSize,
          labelPlacement,
          { compact }
        );
        const {
          textX,
          textY,
          rectX,
          rectY,
          width,
          height,
          fontSize,
          lineStep,
          lines: nameLines,
          textAnchor,
        } = callout;
        const labelBox = {
          minX: rectX - (compact ? 0.45 : 0),
          maxX: rectX + width + (compact ? 0.45 : 0),
          minY: rectY - (compact ? 0.45 : 0),
          maxY: rectY + height + (compact ? 0.45 : 0),
        };
        if (
          compact &&
          labelBoxOverlapsAny(labelBox, occupiedPrintAnnotationBoxes)
        ) {
          lines.push(`</g>`);
          continue;
        }
        const labelLinesXml = nameLines
          .map(
            (line, index) =>
              `<tspan x="${fmt(textX)}" dy="${index === 0 ? 0 : lineStep}">${escapeXml(line)}</tspan>`
          )
          .join("");
        const textStartY = textY - ((nameLines.length - 1) * lineStep) / 2;
        // White label halo box first, then text.
        lines.push(
          `<rect x="${fmt(rectX)}" y="${fmt(rectY)}" ` +
            `width="${fmt(width)}" ` +
            `height="${fmt(height)}" rx="0.7" fill="#ffffff" fill-opacity="0.86" ` +
            `stroke="#64748b" stroke-opacity="0.28" stroke-width="0.1"/>`
        );
        lines.push(
          `<text x="${fmt(textX)}" y="${fmt(textStartY)}" font-size="${fontSize.toFixed(2)}" ` +
            `font-weight="400" ` +
            `text-anchor="${textAnchor}" ` +
            `dominant-baseline="middle" ` +
            `fill="#0f172a">${labelLinesXml}</text>`
        );
        if (compact) occupiedPrintAnnotationBoxes.push(labelBox);
      }
      lines.push(`</g>`);
    }
    lines.push(`</g>`);
  }

  // Optional locations/descriptions legend. Default is off because these
  // descriptions can get long and quickly crowd a barangay sheet; enable
  // with ?locations=1 / ?locationLegend=1 when the printed plate needs the
  // ordinance text beside the map.
  if (showLocationLegend && locationLegendRows.length) {
    const locPad = 3;
    const locX = PAGE_MARGIN_MM;
    const locY = PAGE_MARGIN_MM;
    const locW = Math.min(paperW * 0.55, printOrientation === "landscape" ? 175 : 125);
    const locFont = 2.25;
    const locLineH = 2.65;
    const codeW = 10;
    const wrappedRows = locationLegendRows.map((row) => ({
      ...row,
      lines: wrappedLabelLines(row.description, printOrientation === "landscape" ? 82 : 56),
    }));
    const contentLineCount = wrappedRows.reduce(
      (sum, row) => sum + Math.max(1, row.lines.length),
      0
    );
    const locH =
      locPad * 2 +
      5 +
      wrappedRows.length * 1.0 +
      contentLineCount * locLineH;
    lines.push(`<g id="location-legend" font-family="Helvetica, Arial, sans-serif">`);
    lines.push(
      `<rect x="${fmt(locX)}" y="${fmt(locY)}" width="${fmt(locW)}" ` +
        `height="${fmt(locH)}" rx="1.2" fill="#ffffff" fill-opacity="0.94" ` +
        `stroke="#1f2937" stroke-width="0.3"/>`
    );
    let locCursorY = locY + locPad + 3.4;
    lines.push(
      `<text x="${fmt(locX + locPad)}" y="${fmt(locCursorY)}" ` +
        `font-size="3.1" font-weight="700" fill="#000000">LOCATIONS</text>`
    );
    locCursorY += 4;
    for (const row of wrappedRows) {
      const rowStartY = locCursorY;
      lines.push(
        `<text x="${fmt(locX + locPad)}" y="${fmt(rowStartY)}" ` +
          `font-size="${fmt(locFont)}" font-weight="700" fill="#111827">` +
          escapeXml(row.klass) +
          `</text>`
      );
      row.lines.forEach((line, lineIndex) => {
        lines.push(
          `<text x="${fmt(locX + locPad + codeW)}" y="${fmt(
            rowStartY + lineIndex * locLineH
          )}" font-size="${fmt(locFont)}" fill="#111827">` +
            escapeXml(line) +
            `</text>`
        );
      });
      locCursorY += Math.max(1, row.lines.length) * locLineH + 1.0;
    }
    lines.push(`</g>`);
  }

  // ----- legend block (4 columns) -----
  // Layout (left → right):
  //   Col 1: Commercial SMV classes (C-1, C-2, C-3, …)
  //   Col 2: Residential SMV classes (R-1, R-2, R-3, …)
  //   Col 3: Road tiers (national / provincial / barangay / other)
  //   Col 4: Landmark icon kinds
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
    const institutionalClasses = presentClasses.filter(
      (k) => k === "INSTITUTIONAL"
    );
    const roadTiers = [
      { tier: "national", label: "National", fill: PALETTE.roadFillTrunk, casing: PALETTE.roadCasingTrunk },
      { tier: "provincial", label: "Provincial", fill: PALETTE.roadFillProvincial, casing: PALETTE.roadCasingProvincial },
      { tier: "barangay", label: "Barangay", fill: PALETTE.roadFillBarangay, casing: PALETTE.roadCasingBarangay },
      { tier: "other", label: "Other", fill: PALETTE.roadFill, casing: "#888" },
    ];

    if (presentClasses.length > 0) {
      // ---- "Unit Land Value Map" — 4-column legend ----
      // Layout (top → bottom):
      //   1. Big centered title:  UNIT LAND VALUE MAP
      //   2. Info block:          MUNICIPALITY / PROVINCE OF / ISLAND OF
      //   3. LEGEND: label
      //   4. Column headers:      Commercial | Residential | Roads | Landmarks
      //   5. Column rows (side by side, each column flows independently):
      //        - Commercial:  [swatch] C-N   ₱value
      //        - Residential: [swatch] R-N   ₱value
      //        - Roads:       [swatch] National/Provincial/Barangay/Other
      //        - Landmarks:   [pin icon] Business/Government/etc.
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
        swatchFill: printColorForClass(k, slug),
        swatchStroke: "#374151",
        valueText: fmtValue(classValues[k]),
      }));
      const residentialRows = residentialClasses.map((k) => ({
        label: k,
        swatchFill: printColorForClass(k, slug),
        swatchStroke: "#374151",
        valueText: fmtValue(classValues[k]),
      }));
      const institutionalRows = institutionalClasses.map((k) => ({
        label: CLASSIFICATION_INFO[k]?.label ?? k,
        swatchFill: printColorForClass(k, slug),
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
      const landmarkRows = LANDMARK_KIND_OPTIONS.map((option) => ({
        kind: normalizeLandmarkKind(option.value),
        label: option.label,
        color: option.color,
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
      const landmarkIconW = 5;
      const landmarkLabelW = 20; // "Government", "Transport", etc.
      const landmarkColWidth = landmarkIconW + innerGapMm + landmarkLabelW;

      const colGapMm = 5;
      const innerWidthMm =
        smvColWidth +
        colGapMm +
        smvColWidth +
        colGapMm +
        roadColWidth +
        colGapMm +
        landmarkColWidth;
      const legendWidthMm = padMm * 2 + innerWidthMm;

      const titleHeightMm = 9;
      const infoLineHeightMm = 4.5;
      const infoRowsHeightMm = (targetBarangayFeature ? 4 : 3) * infoLineHeightMm;
      const legendLabelHeightMm = 5;
      const colHeaderHeightMm = 5;
      const smvRowHeightMm = 4.6;
      const roadRowHeightMm = 5.6;
      const landmarkRowHeightMm = 5.2;
      const institutionalHeightMm = institutionalRows.length
        ? institutionalRows.length * smvRowHeightMm
        : 0;

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
        roadRows.length * roadRowHeightMm,
        landmarkRows.length * landmarkRowHeightMm
      );
      void dataRows;

      const legendHeightMm =
        padMm * 2 +
        titleHeightMm +
        infoRowsHeightMm +
        legendLabelHeightMm +
        institutionalHeightMm +
        colHeaderHeightMm +
        colHeightMm;

      const legendX = paperW - PAGE_MARGIN_MM - legendWidthMm;
      const legendY = paperH - PAGE_MARGIN_MM - legendHeightMm;
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
      const infoRows = targetBarangayFeature
        ? [
            [
              "BARANGAY:",
              String(
                targetBarangayFeature.properties?.name ?? barangayName ?? ""
              ).toUpperCase(),
            ],
            ["MUNICIPALITY:", muniText],
            ["PROVINCE OF:", provinceText],
            ["ISLAND OF:", islandText],
          ]
        : [
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

      // Institutional is an SMV class, but it is outside the commercial
      // and residential value ladders. Keep it visible in the print legend
      // as its own blue-violet swatch instead of letting it disappear from
      // the three-column commercial/residential/roads layout.
      for (const [rowIndex, row] of institutionalRows.entries()) {
        const rowY = cursorY + rowIndex * smvRowHeightMm;
        const sY = rowY + (smvRowHeightMm - smvSwatchH) / 2;
        const baselineY = rowY + smvRowHeightMm * 0.72;
        lines.push(
          `<rect x="${fmt(legendX + padMm)}" y="${fmt(sY)}" width="${fmt(
            smvSwatchW
          )}" height="${fmt(smvSwatchH)}" fill="${row.swatchFill}" stroke="${
            row.swatchStroke
          }" stroke-width="0.25"/>`
        );
        lines.push(
          `<text x="${fmt(
            legendX + padMm + smvSwatchW + innerGapMm
          )}" y="${fmt(baselineY)}" font-size="3" font-weight="700" fill="#000000">` +
            `Institutional` +
            `</text>`
        );
      }
      cursorY += institutionalHeightMm;

      // ---- Column header row with underline ----
      const colCommercialX = legendX + padMm;
      const colResidentialX = colCommercialX + smvColWidth + colGapMm;
      const colRoadsX = colResidentialX + smvColWidth + colGapMm;
      const colLandmarksX = colRoadsX + roadColWidth + colGapMm;
      {
        const y = cursorY + colHeaderHeightMm * 0.6;
        const headers = [
          { label: "Commercial", x: colCommercialX, width: smvColWidth },
          { label: "Residential", x: colResidentialX, width: smvColWidth },
          { label: "Roads", x: colRoadsX, width: roadColWidth },
          { label: "Landmarks", x: colLandmarksX, width: landmarkColWidth },
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

      // Landmark rows: same teardrop marker family as the map pins,
      // compacted for the legend column.
      const renderLandmarkRow = (row, colX, rowIndex) => {
        const rowY = cursorY + rowIndex * landmarkRowHeightMm;
        const iconCx = colX + landmarkIconW / 2;
        const iconCy = rowY + landmarkRowHeightMm / 2;
        const iconPath = escapeXml(landmarkIconPath(row.kind));
        const iconColor = row.color || LANDMARK_COLORS[row.kind] || LANDMARK_COLORS.business;
        lines.push(
          `<g transform="translate(${fmt(iconCx)} ${fmt(iconCy)})">` +
            `<rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="1.8" ` +
            `transform="rotate(-45)" fill="${iconColor}" stroke="#ffffff" ` +
            `stroke-width="0.58"/>` +
            `<rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="1.8" ` +
            `transform="rotate(-45)" fill="none" stroke="#1f2937" ` +
            `stroke-width="0.13" opacity="0.55"/>` +
            `<path d="${iconPath}" transform="translate(-1.2 -1.2) scale(0.1)" ` +
            `fill="none" stroke="#ffffff" stroke-width="1.7" ` +
            `stroke-linecap="round" stroke-linejoin="round"/>` +
            `</g>`
        );
        lines.push(
          `<text x="${fmt(colX + landmarkIconW + innerGapMm)}" y="${fmt(
            rowY + landmarkRowHeightMm * 0.68
          )}" font-size="2.8" font-weight="700" fill="#000000">` +
            escapeXml(row.label) +
            `</text>`
        );
      };

      commercialRows.forEach((row, i) => renderSmvRow(row, colCommercialX, i));
      residentialRows.forEach((row, i) =>
        renderSmvRow(row, colResidentialX, i)
      );
      roadRows.forEach((row, i) => renderRoadRow(row, colRoadsX, i));
      landmarkRows.forEach((row, i) =>
        renderLandmarkRow(row, colLandmarksX, i)
      );

      lines.push(`</g>`);
    }
  }

  // ----- map furniture: prepared-by block, compass, and page border -----
  // Drawn last so it stays visible above map layers/legend.
  {
    const frameInset = 3.2;
    const frameW = paperW - frameInset * 2;
    const frameH = paperH - frameInset * 2;

    // Prepared-by block, lower-left.
    const prepX = frameInset + 7;
    const prepY = paperH - frameInset - 25;
    lines.push(`<g id="prepared-by" font-family="Helvetica, Arial, sans-serif" fill="#111827">`);
    lines.push(
      `<text x="${fmt(prepX)}" y="${fmt(prepY)}" font-size="3.4">Prepared by:</text>`
    );
    lines.push(
      `<text x="${fmt(prepX + 13)}" y="${fmt(prepY + 10.5)}" ` +
        `font-size="4" font-weight="700">Rinar M. Dengwas</text>`
    );
    lines.push(
      `<line x1="${fmt(prepX + 13)}" y1="${fmt(prepY + 12.3)}" ` +
        `x2="${fmt(prepX + 48)}" y2="${fmt(prepY + 12.3)}" ` +
        `stroke="#111827" stroke-width="0.25"/>`
    );
    lines.push(
      `<text x="${fmt(prepX + 21.2)}" y="${fmt(prepY + 17.2)}" ` +
        `font-size="3.5">Programmer</text>`
    );
    lines.push(`</g>`);

    // Compass rose, upper-right.
    const compassSize = printOrientation === "landscape" ? 34 : 32;
    const compassCx = paperW - frameInset - compassSize / 2 - 9;
    const compassCy = frameInset + compassSize / 2 + 9;
    const r = compassSize / 2;
    const spoke = (angleDeg, length, halfWidth) => {
      const a = ((angleDeg - 90) * Math.PI) / 180;
      const tip = [Math.cos(a) * length, Math.sin(a) * length];
      const leftA = a + Math.PI / 2;
      const base = [-Math.cos(a) * 2.2, -Math.sin(a) * 2.2];
      const left = [
        base[0] + Math.cos(leftA) * halfWidth,
        base[1] + Math.sin(leftA) * halfWidth,
      ];
      const right = [
        base[0] - Math.cos(leftA) * halfWidth,
        base[1] - Math.sin(leftA) * halfWidth,
      ];
      return `${fmt(tip[0])},${fmt(tip[1])} ${fmt(left[0])},${fmt(left[1])} ${fmt(
        right[0]
      )},${fmt(right[1])}`;
    };
    lines.push(
      `<g id="compass-rose" transform="translate(${fmt(compassCx)} ${fmt(compassCy)})" ` +
        `font-family="Helvetica, Arial, sans-serif" fill="#111827" ` +
        `stroke-linejoin="round">`
    );
    lines.push(
      `<circle cx="0" cy="0" r="${fmt(r - 1)}" fill="none" stroke="#111827" stroke-width="0.35"/>`
    );
    lines.push(
      `<circle cx="0" cy="0" r="${fmt(r - 3)}" fill="none" stroke="#9ca3af" stroke-width="0.18"/>`
    );
    for (const [angle, fill] of [
      [45, "#ffffff"],
      [135, "#ffffff"],
      [225, "#ffffff"],
      [315, "#ffffff"],
    ]) {
      lines.push(
        `<polygon points="${spoke(angle, r - 5, 2.1)}" fill="${fill}" stroke="#111827" stroke-width="0.25"/>`
      );
    }
    lines.push(
      `<polygon points="${spoke(0, r + 2, 3.1)}" fill="#ef233c" stroke="#111827" stroke-width="0.3"/>`
    );
    lines.push(
      `<polygon points="${spoke(90, r + 1, 3.0)}" fill="#111827" stroke="#111827" stroke-width="0.3"/>`
    );
    lines.push(
      `<polygon points="${spoke(180, r + 2, 3.1)}" fill="#111827" stroke="#111827" stroke-width="0.3"/>`
    );
    lines.push(
      `<polygon points="${spoke(270, r + 1, 3.0)}" fill="#ffffff" stroke="#111827" stroke-width="0.3"/>`
    );
    lines.push(`<circle cx="0" cy="0" r="1.6" fill="#111827"/>`);
    lines.push(`<text x="0" y="${fmt(-r - 4)}" font-size="4" font-weight="700" text-anchor="middle">N</text>`);
    lines.push(`<text x="${fmt(r + 5)}" y="1.3" font-size="3.6" font-weight="700" text-anchor="middle">E</text>`);
    lines.push(`<text x="0" y="${fmt(r + 7)}" font-size="3.6" font-weight="700" text-anchor="middle">S</text>`);
    lines.push(`<text x="${fmt(-r - 5)}" y="1.3" font-size="3.6" font-weight="700" text-anchor="middle">W</text>`);
    lines.push(`</g>`);

    // Page frame, on top of everything.
    lines.push(`<g id="page-border" fill="none">`);
    lines.push(
      `<rect x="${fmt(frameInset)}" y="${fmt(frameInset)}" width="${fmt(frameW)}" ` +
        `height="${fmt(frameH)}" stroke="#000000" stroke-width="1.1"/>`
    );
    lines.push(
      `<rect x="${fmt(frameInset + 1.5)}" y="${fmt(frameInset + 1.5)}" ` +
        `width="${fmt(frameW - 3)}" height="${fmt(frameH - 3)}" ` +
        `stroke="#111827" stroke-width="0.25"/>`
    );
    lines.push(`</g>`);
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

function extractLocationLegendRows(valuations) {
  const rows = [];
  const lc = valuations?.land_classifications;
  if (!Array.isArray(lc)) return rows;
  for (const cat of lc) {
    if (!Array.isArray(cat?.items)) continue;
    for (const it of cat.items) {
      const klass = it?.sub_classification;
      const description = it?.location_description;
      if (!klass || !description) continue;
      rows.push({
        klass,
        description,
      });
    }
  }
  return rows;
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
  const showOsmPois = opts.showOsmPois === true;
  const showLocationLegend = opts.showLocationLegend === true;
  return buildSvg({
    slug,
    outline,
    barangays: readJsonOptional(file(`${slug}_barangays.geojson`)),
    zones: readJsonOptional(file(`${slug}_zones.geojson`)),
    water: readJsonOptional(file(`${slug}_osm_water.geojson`)),
    buildings:
      readJsonOptional(file(`${slug}_overture_buildings.geojson`)) ??
      readJsonOptional(file(`${slug}_osm_buildings.geojson`)),
    roads: mergeFeatureCollections(
      readJsonOptional(file(`${slug}_osm_roads.geojson`)),
      readJsonOptional(file(`${slug}_print_roads.geojson`))
    ),
    parcels: readJsonOptional(file(`${slug}_parcels.geojson`)),
    places: showOsmPois ? readJsonOptional(file(`${slug}_osm_places.geojson`)) : null,
    landmarks: mergeFeatureCollections(
      showOsmPois
        ? filterProviderPoiFeatureCollection(
            readJsonOptional(file(`${slug}_osm_landmarks.geojson`)) ??
              readJsonOptional(file(`${slug}_landmarks.geojson`))
          )
        : null,
      readJsonOptional(file(`${slug}_custom_landmarks.geojson`))
    ),
    smvBufferM: opts.smvBufferM,
    showBuildingFootprints: opts.showBuildingFootprints ?? null,
    showLocationLegend,
    locationLegendRows: showLocationLegend
      ? extractLocationLegendRows(valuations)
      : [],
    orientation: opts.orientation ?? "portrait",
    classValues,
    municipalityName: valuations?.municipality ?? slug,
    revisionYear: valuations?.revision_year ?? null,
    barangayName: opts.barangayName ?? null,
  });
}
