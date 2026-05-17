"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import { CLASSIFICATION_INFO, styleForClass } from "@/lib/classifications";
import LandmarkAddForm from "./LandmarkAddForm";

const DEFAULT_STORAGE_KEY = "bauko-zones-v1";
const DEFAULT_BUNDLED_ZONES_URL = "/data/bauko_zones.geojson";
const DEFAULT_CLASS_KEYS = Object.keys(CLASSIFICATION_INFO);

// Visual styles for the chipped OSM road layer in edit mode.
// Keep lines solid (no dash pattern) to match the Bauko presentation style.
const ROAD_STYLE_DEFAULT = {
  color: "#2563eb",
  weight: 4,
  opacity: 0.85,
  dashArray: null,
};

// Frontage-band chip styles. Each chip is one road-segment's 30m or
// 60m band polygon (built by scripts/build-frontage-bands.mjs).
// Default is a translucent fill so the user can see them without
// obscuring the basemap; selected goes bold + thicker stroke.
const BAND_STYLE_0_30 = {
  color: "#dc2626",
  weight: 1.2,
  opacity: 0.7,
  fillColor: "#dc2626",
  fillOpacity: 0.08,
  dashArray: null,
};
const BAND_STYLE_0_30_HOVER = {
  color: "#dc2626",
  weight: 2,
  opacity: 1,
  fillColor: "#dc2626",
  fillOpacity: 0.18,
  dashArray: null,
};
const BAND_STYLE_0_30_SELECTED = {
  color: "#7f1d1d",
  weight: 2.5,
  opacity: 1,
  fillColor: "#dc2626",
  fillOpacity: 0.35,
  dashArray: null,
};
const BAND_STYLE_30_60 = {
  color: "#f59e0b",
  weight: 1,
  opacity: 0.6,
  fillColor: "#f59e0b",
  fillOpacity: 0.05,
  dashArray: "4 3",
};
const BAND_STYLE_30_60_HOVER = {
  color: "#f59e0b",
  weight: 1.8,
  opacity: 1,
  fillColor: "#f59e0b",
  fillOpacity: 0.14,
  dashArray: "4 3",
};
const BAND_STYLE_30_60_SELECTED = {
  color: "#92400e",
  weight: 2.4,
  opacity: 1,
  fillColor: "#f59e0b",
  fillOpacity: 0.32,
  dashArray: null,
};

function bandStyleFor(feature, selected) {
  const band = feature?.properties?.band;
  if (band === "0-30") return selected ? BAND_STYLE_0_30_SELECTED : BAND_STYLE_0_30;
  return selected ? BAND_STYLE_30_60_SELECTED : BAND_STYLE_30_60;
}
function bandHoverStyleFor(feature) {
  const band = feature?.properties?.band;
  if (band === "0-30") return BAND_STYLE_0_30_HOVER;
  return BAND_STYLE_30_60_HOVER;
}
const ROAD_STYLE_HOVER = {
  color: "#f59e0b",
  weight: 5,
  opacity: 1,
  dashArray: null,
};
const ROAD_STYLE_SELECTED = {
  color: "#ea580c",
  weight: 6,
  opacity: 1,
  dashArray: null,
};

// Clamp helper for the draggable editor panel — keeps the panel from
// being dragged off-screen.
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Identity for a chipped road feature. The fetch script writes one
// feature per (way, barangay) intersection, so the OSM way id alone
// isn't unique — we combine it with barangay slug plus the segment's
// first vertex to disambiguate the rare case where a single way
// crosses the same barangay twice.
function roadFeatureKey(feature) {
  const p = feature?.properties || {};
  const firstCoord = feature?.geometry?.coordinates?.[0];
  const tag = Array.isArray(firstCoord) ? firstCoord.join(",") : "";
  return `${p.osm_way_id ?? "?"}|${p.barangay_slug ?? "?"}|${tag}`;
}

function flattenLayerCandidates(input, out = []) {
  if (!input) return out;
  if (Array.isArray(input)) {
    for (const child of input) flattenLayerCandidates(child, out);
    return out;
  }
  if (typeof input.eachLayer === "function") {
    input.eachLayer((child) => flattenLayerCandidates(child, out));
    return out;
  }
  if (typeof input.toGeoJSON === "function") out.push(input);
  return out;
}

// Sliver detector for cut / clean operations. Drops two kinds of
// pathological pieces:
//   1. Tiny area — < minAreaM2 (50 m² default; a 5 m × 10 m parcel
//      survives, smaller fragments don't).
//   2. Thin strips — pieces with low compactness, computed as
//      4πA/P². A square scores ~0.78; a circle 1.0; a 100×1 m strip
//      ~0.03. Threshold 0.10 catches sliver strips without nuking
//      legitimate long-thin parcels (which usually clock 0.15+).
// Both filters fire — passes only if neither triggers.
function isSliverPolygon(polygonGeom, opts = {}) {
  const minAreaM2 = opts.minAreaM2 ?? 50;
  const minCompactness = opts.minCompactness ?? 0.1;
  try {
    const f = turf.feature(polygonGeom);
    const area = turf.area(f);
    if (area < minAreaM2) return true;
    // Sum the perimeter of every ring (outer + holes).
    const lineOrColl = turf.polygonToLine(f);
    let perim = 0;
    if (lineOrColl?.type === "Feature") {
      perim = turf.length(lineOrColl, { units: "meters" });
    } else if (lineOrColl?.features) {
      for (const lf of lineOrColl.features) {
        perim += turf.length(lf, { units: "meters" });
      }
    }
    if (perim > 0) {
      const compactness = (4 * Math.PI * area) / (perim * perim);
      if (compactness < minCompactness) return true;
    }
  } catch {}
  return false;
}

function extractCutResultLayers(event) {
  const layers = [];
  flattenLayerCandidates(event?.layer, layers);
  flattenLayerCandidates(event?.layers, layers);
  flattenLayerCandidates(event?.resultingLayers, layers);
  const seen = new Set();
  const unique = [];
  for (const layer of layers) {
    if (!layer || seen.has(layer)) continue;
    seen.add(layer);
    unique.push(layer);
  }
  return unique;
}

// Standard depth from the 2027 schedule: 30 m on each side of the road.
const DEFAULT_BUFFER_METERS = 30;

// Half-width of the carriageway that gets *cut out* of the corridor
// so the corridor renders as two parallel ribbons on either side of
// the road, not as one fat strip burying the road. Roughly the
// half-width of a 2-lane mountain road. Make it 0 to disable the
// cut-out (corridor returns to the old "fat strip" look).
const ROAD_INSET_METERS = 4;

// Flat-capped buffer of a (Multi)LineString. turf.buffer always uses
// rounded end caps (the underlying jsts.BufferParameters defaults to
// CAP_ROUND and the option isn't exposed), which makes corridor zones
// look like pills — bulging past the actual road endpoint.
//
// To get the perpendicular-cut "frontage strip" look LGU surveyors
// expect, we instead:
//   1. Offset the line by +r and -r perpendicular (turf.lineOffset)
//   2. Stitch the two parallel lines into a single closed ring,
//      connected by straight segments at each end
//
// The straight connectors at start/end ARE the flat caps. Sharp angles
// along the line can produce small self-intersections at offsets; we
// run buffer(0) on the result to clean those up.
function flatCapBuffer(input, halfWidthM) {
  if (!input) return null;
  // Accept either a Feature wrapper (what turf.multiLineString() and
  // turf.lineString() return) or a raw geometry object.
  const geom = input.type === "Feature" ? input.geometry : input;
  if (!geom) return null;
  const lines =
    geom.type === "MultiLineString"
      ? geom.coordinates
      : geom.type === "LineString"
        ? [geom.coordinates]
        : null;
  if (!lines || lines.length === 0) return null;

  const polys = [];
  for (const coords of lines) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    let polyForSegment = null;
    let leftRing;
    let rightRing;
    try {
      const ls = turf.lineString(coords);
      leftRing = turf.lineOffset(ls, halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
      rightRing = turf.lineOffset(ls, -halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
    } catch (e) {
      console.warn("flatCapBuffer: lineOffset failed for one segment", e);
    }
    if (leftRing?.length && rightRing?.length) {
      // Close the ring: left coords forward, right coords reversed,
      // then back to the starting vertex.
      const ring = [
        ...leftRing,
        ...rightRing.slice().reverse(),
        leftRing[0],
      ];
      try {
        const raw = turf.polygon([ring]);
        const rawArea = turf.area(raw);
        // Sharp corners can make lineOffset fold the ring onto itself;
        // buffer(0) normalises that. BUT on very curvy roads (e.g.
        // Mayag's 112-vertex mountain road) buffer(0) shaves a chunk
        // off one side instead of cleanly resolving the crossing —
        // that's the "only one side filled" bug. We detect it via the
        // area drop and fall through to the rounded-buffer fallback
        // below when even a small chunk of area was lost. Anything
        // ≥ 1% loss indicates lineOffset folded, which is a fall-back
        // trigger (Mayag's curve loses 7%, fine; an OSM-clean 7-vertex
        // straight loses 0.05% which stays on the flat-cap path).
        const cleaned = turf.buffer(raw, 0, { units: "meters" });
        if (cleaned && turf.area(cleaned) >= rawArea * 0.99) {
          polyForSegment = cleaned;
        }
      } catch (e) {
        console.warn("flatCapBuffer: polygon assembly failed", e);
      }
    }
    if (!polyForSegment) {
      // Fallback for self-intersecting flat-cap rings: use turf.buffer
      // (rounded caps) on the line. Slight visual mismatch with flat
      // cap segments at junctions, but reliably covers both sides for
      // any road geometry. Tested necessary on Bauko's Mayag interior
      // road (112-vertex 1.4km mountain road) — flat-cap approach loses
      // ~7% on the inside of tight curves.
      try {
        const ls = turf.lineString(coords);
        const rounded = turf.buffer(ls, halfWidthM, { units: "meters" });
        if (rounded?.geometry) polyForSegment = rounded;
      } catch (e) {
        console.warn("flatCapBuffer: rounded-buffer fallback failed", e);
      }
    }
    if (polyForSegment) polys.push(polyForSegment);
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  try {
    return turf.union(turf.featureCollection(polys));
  } catch {
    return polys[0];
  }
}

// Buffer a line (or multilinestring) into a corridor with the road
// itself cut out — two ribbons on each side, ROAD_INSET_METERS in
// from the centerline. Falls back to the plain symmetric buffer if
// outerHalfWidthM is too small for a meaningful inset, or if the
// difference operation throws (rare, but turf's polygon-clipping can
// trip on near-tangent geometry).
//
// Both the outer corridor edge AND the inner road-inset use flat caps
// so the corridor terminates with a perpendicular cut at each end
// rather than a rounded pill.
function bufferAlongsideRoad(geom, outerHalfWidthM) {
  const outer = flatCapBuffer(geom, outerHalfWidthM);
  if (!outer?.geometry) return null;
  if (ROAD_INSET_METERS <= 0 || outerHalfWidthM <= ROAD_INSET_METERS + 1) {
    return outer;
  }
  const inner = flatCapBuffer(geom, ROAD_INSET_METERS);
  if (!inner?.geometry) return outer;
  try {
    const diff = turf.difference(turf.featureCollection([outer, inner]));
    if (diff?.geometry) return diff;
  } catch (e) {
    // Difference can throw on certain edge cases — fall back gracefully.
  }
  return outer;
}

// SVG hatch pattern id rendered by LeafletMap.js (`<defs>` block at the top
// of the map). Edit-mode polygons reference the same pattern so a C-1 zone
// looks identical whether it's the static read-only layer or being edited.
const C1_HATCH_FILL = "url(#bauko-c1-smv-hatch)";

// ---- Multi-vertex helpers ----
// A polygon's coords from layer.getLatLngs() are nested arrays of L.LatLng:
//   - Polygon:        [[ring]]
//   - Polygon+holes:  [[outer], [hole1], [hole2]]
//   - MultiPolygon:   [[[outer1], [hole1a]], [[outer2]]]
// We flatten this into a list of { path: "0", "0-1", "1-0", … ; ring: [latlng, …] }
// so each vertex can be uniquely keyed as `${path}|${vertexIdx}`.
function ringsFromLatLngs(latlngs) {
  const out = [];
  const isLatLng = (v) =>
    v && typeof v.lat === "number" && typeof v.lng === "number";
  const walk = (node, path) => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (isLatLng(node[0])) {
      out.push({ path, ring: node });
    } else {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], path === "" ? String(i) : `${path}-${i}`);
      }
    }
  };
  walk(latlngs, "");
  return out;
}

function vertexKey(ringPath, vertexIdx) {
  return `${ringPath}|${vertexIdx}`;
}
function parseVertexKey(key) {
  const [ringPath, vIdxStr] = key.split("|");
  return { ringPath, vertexIdx: parseInt(vIdxStr, 10) };
}
function getRingByPath(latlngs, ringPath) {
  if (ringPath === "") return latlngs;
  let cur = latlngs;
  for (const i of ringPath.split("-").map(Number)) {
    cur = cur?.[i];
  }
  return cur;
}

// A leaflet-geoman-driven layer for drawing/editing custom zones.
// Loads the leaflet-geoman plugin client-side, attaches a feature group,
// persists draws to localStorage as GeoJSON, and lets the user export the
// collection as a downloadable .geojson file.
//
// Note: this component is mounted by the parent only when drawMode is on,
// so the `visible` prop is currently always true once mounted. We still
// guard at the bottom of the component (after all hooks) in case that
// changes — never put the guard before the hooks.
export default function EditableZones({
  visible = true,
  storageKey = DEFAULT_STORAGE_KEY,
  bundledZonesUrl = DEFAULT_BUNDLED_ZONES_URL,
  exportFilename = "bauko_zones.geojson",
  saveEventName = "bauko:zones-saved",
  saveSlug = "bauko",
  savePathLabel = "public/data/bauko_zones.geojson",
  roadsUrl = null,
  frontageBandsUrl = null,
  showFrontageBands = false,
  barangaysUrl = null,
  activeStretchKey = null,
  stretchCatalog = [],
  municipalitySlug = "bauko",
  classKeys = null,
}) {
  const map = useMap();
  const groupRef = useRef(null);
  const selectedLayerRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const isRestoringRef = useRef(false);
  // Counter exposed (not anonymous) so memoised computations can
  // depend on it — e.g. the polygon layers tree below recomputes
  // whenever refresh() bumps this.
  const [forceCounter, force] = useState(0);
  const [activeClass, setActiveClass] = useState("R-3");
  const [secondaryClass, setSecondaryClass] = useState("");
  const [tertiaryClass, setTertiaryClass] = useState("");
  const [bufferMeters, setBufferMeters] = useState(DEFAULT_BUFFER_METERS);
  // OSM road selection — used by the click-to-tag flow. When this set
  // is non-empty, clicking a class chip buffers the selected road
  // segments into a new corridor zone (instead of just setting the
  // next-draw class). Keys are stringified feature indexes from
  // roadsUrl's FeatureCollection.
  const [selectedRoadKeys, setSelectedRoadKeys] = useState(() => new Set());
  const roadsLayerRef = useRef(null);
  const roadsByKeyRef = useRef(new Map()); // key → { feature, leafletLayer }
  // Frontage-band selection — parallel to roads but each chip is already
  // a polygon, so bake-to-zone uses the geometry directly (no buffer
  // step). Set members are the chip_id from the bands file.
  const [selectedBandKeys, setSelectedBandKeys] = useState(() => new Set());
  const bandsLayerRef = useRef(null);
  const bandsByKeyRef = useRef(new Map()); // chip_id → { feature, leafletLayer }
  const selectedBandKeysRef = useRef(selectedBandKeys);
  useEffect(() => {
    selectedBandKeysRef.current = selectedBandKeys;
  }, [selectedBandKeys]);

  // ---- Multi-vertex select / move / delete ----
  // When toggled on AND a polygon zone is selected, we hide Geoman's
  // single-vertex handles and render our own. Click a vertex to select
  // (single), Shift+click to add to selection, drag any selected vertex
  // to move all selected together, Delete key (or "Delete vertices"
  // button) removes all selected vertices.
  //
  // Off by default — leaves Geoman's stock per-layer editing intact
  // (drag single vertex, right-click to remove, click edge to insert).
  // When true (default), the bake step intersects the new polygon
  // against every existing zone in the group so it only fills the
  // empty gaps. When false, the bake paints the full corridor
  // regardless of what was already there. Persisted to localStorage
  // so users keep their preference between sessions.
  const [trimAgainstExisting, setTrimAgainstExisting] = useState(() => {
    try {
      const stored = window.localStorage.getItem("editor-trim-against-existing");
      return stored === null ? true : stored === "1";
    } catch {
      return true;
    }
  });
  const trimAgainstExistingRef = useRef(trimAgainstExisting);
  useEffect(() => {
    trimAgainstExistingRef.current = trimAgainstExisting;
    try {
      window.localStorage.setItem(
        "editor-trim-against-existing",
        trimAgainstExisting ? "1" : "0"
      );
    } catch {}
  }, [trimAgainstExisting]);

  // Transient notice surfaced after a bake when the auto-clip step
  // removed a meaningful chunk of the candidate area. Cleared after a
  // few seconds so it doesn't linger.
  const [bakeNotice, setBakeNotice] = useState("");

  // ---- Custom landmark adder (in-app pin tool) ----
  // When `placingLandmark` is on, the next map click drops a pending
  // pin and surfaces an inline form for name + kind. Submitting the
  // form pushes the new Feature to localStorage and dispatches a
  // custom event so LeafletMap can re-render the layer. If a sidebar
  // stretch is currently selected (activeStretchKey is set), the new
  // landmark inherits that key so it lights up alongside the stretch.
  const [placingLandmark, setPlacingLandmark] = useState(false);
  const [pendingLandmark, setPendingLandmark] = useState(null);
  // When `movingLandmark` is on, every in-app pin becomes drag-enabled.
  // Dropping a pin in this mode fires a `${slug}:landmark-move` event
  // that this component listens for to persist the new lat/lng.
  const [movingLandmark, setMovingLandmark] = useState(false);
  const placingLandmarkRef = useRef(placingLandmark);
  const movingLandmarkRef = useRef(movingLandmark);
  useEffect(() => {
    movingLandmarkRef.current = movingLandmark;
  }, [movingLandmark]);
  useEffect(() => {
    placingLandmarkRef.current = placingLandmark;
  }, [placingLandmark]);
  const customLandmarksKey = `custom-landmarks-local-v1:${municipalitySlug}`;

  // Delete a single in-app landmark. Prefers matching by stable
  // `properties.id`; falls back to (name + lng + lat) for pins that
  // somehow lack an id. Coordinates are compared with a tiny epsilon
  // to absorb floating-point round-trips through JSON.
  const deleteLandmark = ({ id, name, lng, lat }) => {
    try {
      const raw = window.localStorage.getItem(customLandmarksKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return;
      const EPS = 1e-9;
      const next = arr.filter((f) => {
        const p = f?.properties || {};
        if (id && p.id === id) return false; // primary match
        if (!id && name && p.name === name) {
          const c = f?.geometry?.coordinates || [];
          if (
            Math.abs((c[0] ?? 0) - (lng ?? 0)) < EPS &&
            Math.abs((c[1] ?? 0) - (lat ?? 0)) < EPS
          ) {
            return false; // coord-fallback match
          }
        }
        return true;
      });
      if (next.length === arr.length) {
        console.warn(
          "deleteLandmark: no matching entry found for",
          { id, name, lng, lat }
        );
        return;
      }
      window.localStorage.setItem(customLandmarksKey, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent(`${municipalitySlug}:custom-landmarks-updated`)
      );
    } catch (e) {
      console.warn("deleteLandmark failed:", e);
    }
  };

  // Move a single in-app landmark to new coordinates. Same id-first,
  // (name + old coords) fallback matching as `deleteLandmark`. Fired
  // by LeafletMap when the user drops a pin in `movingLandmark` mode.
  const moveLandmark = ({ id, name, oldLng, oldLat, newLng, newLat }) => {
    if (
      !Number.isFinite(newLng) ||
      !Number.isFinite(newLat)
    ) {
      console.warn("moveLandmark: invalid new coords", { newLng, newLat });
      return;
    }
    try {
      const raw = window.localStorage.getItem(customLandmarksKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return;
      const EPS = 1e-9;
      let matched = false;
      const next = arr.map((f) => {
        if (matched) return f;
        const p = f?.properties || {};
        const c = f?.geometry?.coordinates || [];
        const idMatch = id && p.id === id;
        const fallbackMatch =
          !id &&
          name &&
          p.name === name &&
          Math.abs((c[0] ?? 0) - (oldLng ?? 0)) < EPS &&
          Math.abs((c[1] ?? 0) - (oldLat ?? 0)) < EPS;
        if (!idMatch && !fallbackMatch) return f;
        matched = true;
        return {
          ...f,
          properties: {
            ...p,
            updated_at: new Date().toISOString(),
          },
          geometry: {
            ...(f?.geometry || { type: "Point" }),
            type: "Point",
            coordinates: [newLng, newLat],
          },
        };
      });
      if (!matched) {
        console.warn(
          "moveLandmark: no matching entry found for",
          { id, name, oldLng, oldLat }
        );
        return;
      }
      window.localStorage.setItem(customLandmarksKey, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent(`${municipalitySlug}:custom-landmarks-updated`)
      );
    } catch (e) {
      console.warn("moveLandmark failed:", e);
    }
  };

  // Broadcast the move-mode toggle to LeafletMap so it can re-render
  // the custom-landmarks layer with `draggable: true` on every in-app
  // pin. Plain custom-event bus — they're sibling renders so we can't
  // just thread a prop down without lifting state.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(`${municipalitySlug}:moving-landmark-mode`, {
        detail: { enabled: movingLandmark },
      })
    );
  }, [movingLandmark, municipalitySlug]);

  // Listen for events from the in-pin Leaflet popups (which live in
  // LeafletMap's render). Three events:
  //   - "delete" → remove by id (or name + coords fallback)
  //   - "edit"   → seed pendingLandmark with the existing values so
  //                 the user can re-pick stretches / fix the location.
  //   - "move"   → persist the new lat/lng after the user drags a pin.
  useEffect(() => {
    const editName = `${municipalitySlug}:landmark-edit`;
    const deleteName = `${municipalitySlug}:landmark-delete`;
    const moveName = `${municipalitySlug}:landmark-move`;
    const onEdit = (e) => {
      const f = e?.detail;
      if (!f) return;
      const props = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      setPendingLandmark({
        id: props.id,
        lat: coords[1],
        lng: coords[0],
        name: props.name || "",
        kind: props.kind || "business",
        stretchKeys: Array.isArray(props.stretch_keys)
          ? [...props.stretch_keys]
          : props.stretch_key
            ? [props.stretch_key]
            : [],
      });
    };
    const onDelete = (e) => {
      const detail = e?.detail;
      if (!detail) return;
      if (window.confirm("Delete this landmark? This can't be undone.")) {
        deleteLandmark(detail);
      }
    };
    const onMove = (e) => {
      const detail = e?.detail;
      if (!detail) return;
      moveLandmark(detail);
    };
    window.addEventListener(editName, onEdit);
    window.addEventListener(deleteName, onDelete);
    window.addEventListener(moveName, onMove);
    return () => {
      window.removeEventListener(editName, onEdit);
      window.removeEventListener(deleteName, onDelete);
      window.removeEventListener(moveName, onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipalitySlug]);

  // Toggle a CSS class on the map container so the cursor turns to a
  // crosshair while the user is in placing mode — clear feedback
  // that the next click drops a pin.
  useEffect(() => {
    if (!map) return undefined;
    const el = map.getContainer();
    if (placingLandmark) {
      el.classList.add("placing-landmark");
    } else {
      el.classList.remove("placing-landmark");
    }
    return () => el.classList.remove("placing-landmark");
  }, [placingLandmark, map]);

  const commitLandmark = (data) => {
    if (!data?.name?.trim()) return;
    const keys = Array.isArray(data.stretchKeys)
      ? data.stretchKeys.filter(Boolean)
      : data.stretchKey
        ? [data.stretchKey]
        : [];
    // If we're editing an existing in-app landmark, keep its stable
    // id so localStorage updates replace the entry in place instead
    // of appending a duplicate.
    const editingId = data.id || null;
    const id =
      editingId ||
      `lm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const feature = {
      type: "Feature",
      properties: {
        id,
        name: data.name.trim(),
        kind: data.kind || "business",
        source: "in-app",
        ...(editingId
          ? { updated_at: new Date().toISOString() }
          : { added_at: new Date().toISOString() }),
        // Array form is the primary going forward — one pin can be
        // referenced by multiple schedule stretches. Omit the property
        // entirely if no links so old singletons don't bloat the file.
        ...(keys.length > 0 ? { stretch_keys: keys } : {}),
      },
      geometry: {
        type: "Point",
        coordinates: [data.lng, data.lat],
      },
    };
    try {
      const raw = window.localStorage.getItem(customLandmarksKey);
      const arr = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(arr) ? arr : [];
      const idx = editingId
        ? list.findIndex((f) => f?.properties?.id === editingId)
        : -1;
      const next =
        idx >= 0
          ? [...list.slice(0, idx), feature, ...list.slice(idx + 1)]
          : [...list, feature];
      window.localStorage.setItem(customLandmarksKey, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent(`${municipalitySlug}:custom-landmarks-updated`)
      );
    } catch (e) {
      console.warn("Could not save landmark to localStorage:", e);
    }
    setPendingLandmark(null);
  };

  // ---- Polygon layers tree (Photoshop-style) ----
  // Hierarchical view of every zone polygon, grouped by barangay →
  // SMV class. Click a polygon row to select it on the map; per-row
  // and per-group delete buttons. Polygons are assigned to a barangay
  // by centroid containment against the municipality's barangay
  // boundaries.
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [expandedTreeKeys, setExpandedTreeKeys] = useState(() => new Set());
  const [barangaysData, setBarangaysData] = useState(null);
  useEffect(() => {
    if (!barangaysUrl) return undefined;
    let cancelled = false;
    fetch(barangaysUrl, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setBarangaysData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [barangaysUrl]);

  const [multiVertexMode, setMultiVertexMode] = useState(false);
  const multiVertexModeRef = useRef(multiVertexMode);
  useEffect(() => {
    multiVertexModeRef.current = multiVertexMode;
  }, [multiVertexMode]);
  const [selectedVertexKeys, setSelectedVertexKeys] = useState(() => new Set());
  const selectedVertexKeysRef = useRef(selectedVertexKeys);
  useEffect(() => {
    selectedVertexKeysRef.current = selectedVertexKeys;
  }, [selectedVertexKeys]);
  const vertexLayerRef = useRef(null);
  const vertexMarkersByKeyRef = useRef(new Map()); // key → L.Marker
  const vertexDragStateRef = useRef(null);
  const cutScopedGroupRef = useRef(null);
  // Snapshot of the selected polygon's properties at the moment Cut
  // mode is enabled. Geoman's pm:cut event sometimes fires without
  // `event.originalLayer`, in which case onCut had no source for
  // classification — the result polygon would render as grey
  // UNCLASSIFIED. Capturing the props here gives us a reliable
  // fallback that travels through the entire cut transaction.
  const cutSourcePropsRef = useRef(null);
  // Bumped on every selectLayer call so the multi-vertex effect can
  // rebuild handles when the user switches between polygons.
  const [selectedLayerVersion, setSelectedLayerVersion] = useState(0);
  const [editorState, setEditorState] = useState({
    canUndo: false,
    canRedo: false,
    hasSelection: false,
  });
  const availableClassKeys = useMemo(() => {
    const incoming = Array.isArray(classKeys)
      ? classKeys
          .map((key) => normaliseClassKey(key))
          .filter(Boolean)
      : [];
    const ordered = incoming.length ? incoming : DEFAULT_CLASS_KEYS;
    const deduped = Array.from(new Set(ordered));
    if (!deduped.includes("UNCLASSIFIED")) deduped.push("UNCLASSIFIED");
    return deduped;
  }, [classKeys]);
  const dualClassKeys = useMemo(
    () => availableClassKeys.filter((k) => k !== "UNCLASSIFIED"),
    [availableClassKeys]
  );

  // ---- Polygon layers tree (memoised) ----
  // { barangaySlug: { name, classes: { classKey: [layer, ...] } } }
  // Plus an "_unassigned" bucket for polygons whose centroid falls
  // outside every barangay (rare — happens with slivers right on a
  // boundary or imports that overshoot the municipal outline).
  // Recomputes on every refresh() call (forceCounter dep) and when
  // barangays data loads.
  const polygonTree = useMemo(() => {
    const tree = {};
    const group = groupRef.current;
    if (!group) return tree;
    const brgyFeatures = barangaysData?.features || [];
    // Pre-compute barangay bboxes for fast rejection.
    const brgyIndex = brgyFeatures.map((f) => ({
      feature: f,
      bbox: (() => {
        try {
          return turf.bbox(f);
        } catch {
          return null;
        }
      })(),
      name:
        f.properties?.name ||
        f.properties?.NAME_3 ||
        f.properties?.ADM4_EN ||
        "(unnamed)",
      slug:
        f.properties?.slug ||
        (f.properties?.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
    }));

    group.eachLayer((layer) => {
      // Collect every classification tier this polygon belongs to.
      // A polygon with primary=C-3, secondary=R-3, tertiary=R-4 will
      // appear under THREE class buckets (C-3, R-3, R-4) in its
      // barangay. Each appearance is tagged with the tier so the row
      // can show a "2°" / "3°" badge.
      const props = layer.feature?.properties || {};
      const primary = normaliseClassKey(props.classification);
      const secondary = normaliseClassKey(props.secondary_classification);
      const tertiary = normaliseClassKey(props.tertiary_classification);
      const tierListings = [];
      if (primary) tierListings.push({ klass: primary, tier: "primary" });
      if (secondary && secondary !== primary) {
        tierListings.push({ klass: secondary, tier: "secondary" });
      }
      if (
        tertiary &&
        tertiary !== primary &&
        tertiary !== secondary
      ) {
        tierListings.push({ klass: tertiary, tier: "tertiary" });
      }
      // Polygons with no classification at all still need a home.
      if (tierListings.length === 0) {
        tierListings.push({ klass: "UNCLASSIFIED", tier: "primary" });
      }

      // Get a representative point for the layer. getCenter on a
      // polygon-with-holes / MultiPolygon returns the bbox center,
      // which is good enough for barangay containment.
      let centerLatLng = null;
      try {
        if (typeof layer.getBounds === "function") {
          centerLatLng = layer.getBounds().getCenter();
        }
      } catch {}

      let brgyName = "(no barangay)";
      let brgySlug = "_unassigned";
      if (centerLatLng && brgyIndex.length > 0) {
        const pt = turf.point([centerLatLng.lng, centerLatLng.lat]);
        for (const b of brgyIndex) {
          // bbox pre-reject
          if (b.bbox) {
            if (
              centerLatLng.lng < b.bbox[0] ||
              centerLatLng.lng > b.bbox[2] ||
              centerLatLng.lat < b.bbox[1] ||
              centerLatLng.lat > b.bbox[3]
            ) {
              continue;
            }
          }
          try {
            if (turf.booleanPointInPolygon(pt, b.feature)) {
              brgyName = b.name;
              brgySlug = b.slug || b.name.toLowerCase().replace(/\s+/g, "-");
              break;
            }
          } catch {}
        }
      }

      if (!tree[brgySlug]) {
        tree[brgySlug] = { name: brgyName, classes: {} };
      }
      for (const { klass, tier } of tierListings) {
        if (!tree[brgySlug].classes[klass]) {
          tree[brgySlug].classes[klass] = [];
        }
        tree[brgySlug].classes[klass].push({ layer, tier });
      }
    });
    return tree;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceCounter, barangaysData]);

  const toggleTreeKey = (key) => {
    setExpandedTreeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Re-render the floating toolbar when feature edits happen.
  const refresh = () => force((n) => n + 1);
  const syncEditorState = () => {
    setEditorState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
      hasSelection: !!selectedLayerRef.current,
    });
  };

  const selectLayer = (layer) => {
    const previous = selectedLayerRef.current;
    if (previous && previous !== layer) {
      applyFeatureStyle(previous, previous.feature?.properties?.classification);
      // Drop the previous layer's vertex-edit markers — only the
      // currently-selected layer should ever have vertex handles.
      try {
        if (previous.pm?.enabled?.()) previous.pm.disable();
      } catch {}
    }
    selectedLayerRef.current = layer;
    if (layer) {
      applyFeatureStyle(layer, layer.feature?.properties?.classification, true);
      if (layer.bringToFront) layer.bringToFront();
      // Per-layer vertex editing — only this polygon gets handles, so
      // we never instantiate vertex markers for the other ~hundreds
      // of holes across all the other corridors. Massive perf win
      // vs leaflet-geoman's global edit mode.
      //
      // We skip this when multi-vertex mode is active — our own marker
      // layer takes over (rendered by the effect below). Toggling
      // multi-vertex off restores Geoman's per-layer handles.
      try {
        if (
          layer.pm &&
          !layer.pm.enabled?.() &&
          !multiVertexModeRef.current
        ) {
          layer.pm.enable({
            // Loosened from `false` because Geoman would silently
            // reject vertex moves on complex polygons-with-holes
            // (e.g. a baked frontage corridor with the road carved
            // out): the user would drag the vertex but it would snap
            // back and look like "the vertex won't move". Allow the
            // move; we can validate at save time if it ever bites.
            allowSelfIntersection: true,
            preventMarkerRemoval: false,
            snappable: true,
          });
        }
      } catch (e) {
        console.warn("Could not enable per-layer edit:", e);
      }
      setSecondaryClass(
        normaliseClassKey(layer.feature?.properties?.secondary_classification) ??
          ""
      );
      setTertiaryClass(
        normaliseClassKey(layer.feature?.properties?.tertiary_classification) ??
          ""
      );
    } else {
      setSecondaryClass("");
      setTertiaryClass("");
    }
    // Bump the version so the multi-vertex effect rebuilds its handles
    // for the newly-selected polygon. Also clear any vertex selection
    // — selections don't carry across polygons.
    setSelectedLayerVersion((v) => v + 1);
    setSelectedVertexKeys(new Set());
    syncEditorState();
  };

  const prepareLayer = (layer) => {
    // Prevent layer clicks from bubbling to the map-level "clear selection"
    // handler. Without this, some fills (notably hatched C-1) can appear
    // unselectable because map-click immediately clears the selection again.
    if (layer.options) {
      layer.options.bubblingMouseEvents = false;
      // While drawing a new polygon, don't snap to existing zone vertices.
      // This avoids accidentally latching onto nearby vertices and creating
      // unintended geometry when tracing beside an existing zone.
      layer.options.snapIgnore = true;
    }
    layer.on("click", (e) => {
      if (map.pm?.globalDrawModeEnabled?.()) return;
      if (e.originalEvent) {
        L.DomEvent.stop(e.originalEvent);
      }
      selectLayer(layer);
    });
  };

  const pushHistory = (shouldPersist = true) => {
    const group = groupRef.current;
    if (!group || isRestoringRef.current) return;
    const snapshot = JSON.stringify(group.toGeoJSON());
    if (historyRef.current[historyIndexRef.current] === snapshot) {
      syncEditorState();
      return;
    }
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;
    if (shouldPersist) localStorage.setItem(storageKey, snapshot);
    syncEditorState();
  };

  const restoreHistory = (nextIndex) => {
    const group = groupRef.current;
    const snapshot = historyRef.current[nextIndex];
    if (!group || snapshot == null) return;
    isRestoringRef.current = true;
    group.clearLayers();
    selectedLayerRef.current = null;
    loadGeoJSONIntoGroup(JSON.parse(snapshot), group, prepareLayer);
    historyIndexRef.current = nextIndex;
    localStorage.setItem(storageKey, snapshot);
    isRestoringRef.current = false;
    syncEditorState();
    refresh();
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    restoreHistory(historyIndexRef.current - 1);
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    restoreHistory(historyIndexRef.current + 1);
  };

  const deleteSelected = () => {
    const group = groupRef.current;
    const layer = selectedLayerRef.current;
    if (!group || !layer) return;
    group.removeLayer(layer);
    try {
      map.removeLayer(layer);
    } catch {}
    selectedLayerRef.current = null;
    pushHistory();
    refresh();
  };

  // Clean the selected polygon's geometry: dedupe/colinear vertices,
  // resolve self-intersections (the typical cause of the "tiny red
  // spikes inside the hole" artifact), and drop sliver parts smaller
  // than the threshold.
  //
  // Pipeline:
  //   1. turf.cleanCoords — removes duplicate / colinear vertices
  //      that confuse downstream ops.
  //   2. turf.unkinkPolygon — splits self-intersecting outer rings
  //      into separate valid Polygons. A figure-8 polygon becomes two
  //      circles; a polygon with a spike that crosses its own edge
  //      becomes a clean main piece + a tiny isolated spike piece.
  //   3. Area filter — drop any resulting piece below SLIVER_MIN_M2.
  //   4. Re-merge: 1 piece → Polygon, 2+ → MultiPolygon, 0 → no-op
  //      with an alert (so we don't accidentally wipe the user's zone).
  //
  // Source class properties are preserved on the result.
  const cleanSelectedGeometry = () => {
    const group = groupRef.current;
    const layer = selectedLayerRef.current;
    if (!group || !layer || typeof layer.toGeoJSON !== "function") return;
    let gj;
    try {
      gj = layer.toGeoJSON();
    } catch {
      return;
    }
    if (!gj?.geometry) return;

    const sourceProps = { ...(gj.properties || {}) };
    const SLIVER_MIN_M2 = 50;

    // 1. cleanCoords
    let cleaned;
    try {
      cleaned = turf.cleanCoords(gj);
    } catch {
      cleaned = gj;
    }

    // 2. Build a flat list of single-Polygon features so we can
    //    process each via unkinkPolygon. For MultiPolygons we explode
    //    first so a kink in one part doesn't merge with another.
    const candidates = [];
    if (cleaned.geometry.type === "Polygon") {
      candidates.push(cleaned);
    } else if (cleaned.geometry.type === "MultiPolygon") {
      for (const c of cleaned.geometry.coordinates) {
        candidates.push(
          turf.feature({ type: "Polygon", coordinates: c }, sourceProps)
        );
      }
    }

    const piecesGeoms = [];
    for (const cand of candidates) {
      let unkinked = null;
      try {
        const out = turf.unkinkPolygon(cand);
        if (out?.features?.length) {
          unkinked = out.features;
        }
      } catch {}
      if (unkinked) {
        for (const f of unkinked) {
          if (f?.geometry?.type === "Polygon") piecesGeoms.push(f.geometry);
        }
      } else {
        // unkink failed or wasn't necessary — keep candidate as-is
        if (cand.geometry?.type === "Polygon") {
          piecesGeoms.push(cand.geometry);
        }
      }
    }

    // 3. Drop slivers — either tiny by area OR narrow thin strips
    //    (compactness < 0.10). Both filters in isSliverPolygon.
    const kept = [];
    let droppedCount = 0;
    let droppedAreaTotal = 0;
    for (const g of piecesGeoms) {
      let a = 0;
      try {
        a = turf.area(turf.feature(g));
      } catch {}
      if (isSliverPolygon(g, { minAreaM2: SLIVER_MIN_M2, minCompactness: 0.1 })) {
        droppedCount += 1;
        droppedAreaTotal += a;
      } else {
        kept.push(g);
      }
    }

    if (kept.length === 0) {
      alert(
        `Cleaning would remove everything — all ${piecesGeoms.length} ` +
          `geometry pieces look like slivers (under ${SLIVER_MIN_M2} m² area ` +
          `or below 0.10 compactness). Nothing changed.`
      );
      return;
    }

    // 4. Rebuild the geometry
    let newGeom;
    if (kept.length === 1) {
      newGeom = kept[0];
    } else {
      newGeom = {
        type: "MultiPolygon",
        coordinates: kept.map((p) => p.coordinates),
      };
    }

    const newFeature = {
      type: "Feature",
      properties: sourceProps,
      geometry: newGeom,
    };
    const wrap = L.geoJSON(newFeature, { style: () => ({}) });
    let newLayer = null;
    wrap.eachLayer((sub) => {
      sub.feature = newFeature;
      applyFeatureStyle(sub, sourceProps.classification);
      prepareLayer(sub);
      group.addLayer(sub);
      newLayer = sub;
    });

    // Remove the old layer
    if (selectedLayerRef.current === layer) {
      selectedLayerRef.current = null;
    }
    try {
      if (layer.pm?.enabled?.()) layer.pm.disable();
    } catch {}
    try {
      group.removeLayer(layer);
    } catch {}
    try {
      map.removeLayer(layer);
    } catch {}

    pushHistory();
    refresh();
    if (newLayer) selectLayer(newLayer);

    if (droppedCount > 0) {
      // Surface what was trimmed so the user knows the clean wasn't a
      // no-op. Friendlier than a silent change.
      setBakeNotice(
        `Cleaned: removed ${droppedCount} sliver part${droppedCount === 1 ? "" : "s"} (${droppedAreaTotal.toFixed(0)} m² total).`
      );
      setTimeout(() => setBakeNotice(""), 5000);
    } else {
      setBakeNotice("Geometry cleaned — no slivers were below threshold.");
      setTimeout(() => setBakeNotice(""), 3000);
    }
  };

  // Explode the selected MultiPolygon into N separate Polygon layers,
  // each inheriting the source's classification (+ secondary/tertiary).
  // Useful when bake or DXF-import produced one MultiPolygon feature
  // covering several disconnected pieces — the user typically wants to
  // delete or reclassify just one of those pieces.
  const explodeSelectedMultiPolygon = () => {
    const group = groupRef.current;
    const layer = selectedLayerRef.current;
    if (!group || !layer || typeof layer.toGeoJSON !== "function") return;
    let gj;
    try {
      gj = layer.toGeoJSON();
    } catch {
      return;
    }
    if (gj?.geometry?.type !== "MultiPolygon") return;
    const parts = gj.geometry.coordinates;
    if (!Array.isArray(parts) || parts.length < 2) return;

    const sourceProps = { ...(gj.properties || {}) };
    const newLayers = [];
    for (const polyCoords of parts) {
      const subFeature = {
        type: "Feature",
        properties: { ...sourceProps },
        geometry: { type: "Polygon", coordinates: polyCoords },
      };
      const wrap = L.geoJSON(subFeature, { style: () => ({}) });
      wrap.eachLayer((sub) => {
        // Make sure each new sub gets the full feature payload — not
        // just whatever L.geoJSON populated.
        sub.feature = subFeature;
        applyFeatureStyle(sub, sourceProps.classification);
        prepareLayer(sub);
        group.addLayer(sub);
        newLayers.push(sub);
      });
    }

    // Remove the original MultiPolygon now that its parts are standalone.
    if (selectedLayerRef.current === layer) {
      selectedLayerRef.current = null;
    }
    try {
      if (layer.pm?.enabled?.()) layer.pm.disable();
    } catch {}
    try {
      group.removeLayer(layer);
    } catch {}
    try {
      map.removeLayer(layer);
    } catch {}

    pushHistory();
    refresh();
    // Auto-select the first new piece so the user has a starting point
    // for the typical "now delete the small one" follow-up.
    if (newLayers[0]) {
      selectLayer(newLayers[0]);
    }
  };

  const setSelectedSecondaryClass = () => {
    const selected = selectedLayerRef.current;
    const klass = normaliseClassKey(secondaryClass);
    if (!selected || !klass) return;
    const primary = normaliseClassKey(selected.feature?.properties?.classification);
    const tertiary = normaliseClassKey(
      selected.feature?.properties?.tertiary_classification
    );
    if (klass === primary || klass === tertiary) return;
    selected.feature = selected.feature || { type: "Feature", properties: {} };
    selected.feature.properties = {
      ...(selected.feature.properties || {}),
      secondary_classification: klass,
    };
    applyFeatureStyle(selected, selected.feature?.properties?.classification, true);
    if (selected.bringToFront) selected.bringToFront();
    pushHistory();
    refresh();
  };

  const clearSelectedSecondaryClass = () => {
    const selected = selectedLayerRef.current;
    if (!selected) return;
    const props = { ...(selected.feature?.properties || {}) };
    delete props.secondary_classification;
    if (
      normaliseClassKey(props.tertiary_classification) ===
      normaliseClassKey(props.classification)
    ) {
      delete props.tertiary_classification;
      setTertiaryClass("");
    }
    selected.feature = selected.feature || { type: "Feature", properties: {} };
    selected.feature.properties = props;
    setSecondaryClass("");
    applyFeatureStyle(selected, selected.feature?.properties?.classification, true);
    if (selected.bringToFront) selected.bringToFront();
    pushHistory();
    refresh();
  };

  const setSelectedTertiaryClass = () => {
    const selected = selectedLayerRef.current;
    const klass = normaliseClassKey(tertiaryClass);
    if (!selected || !klass) return;
    const primary = normaliseClassKey(selected.feature?.properties?.classification);
    const secondary = normaliseClassKey(
      selected.feature?.properties?.secondary_classification
    );
    if (klass === primary || klass === secondary) return;
    selected.feature = selected.feature || { type: "Feature", properties: {} };
    selected.feature.properties = {
      ...(selected.feature.properties || {}),
      tertiary_classification: klass,
    };
    applyFeatureStyle(selected, selected.feature?.properties?.classification, true);
    if (selected.bringToFront) selected.bringToFront();
    pushHistory();
    refresh();
  };

  const clearSelectedTertiaryClass = () => {
    const selected = selectedLayerRef.current;
    if (!selected) return;
    const props = { ...(selected.feature?.properties || {}) };
    delete props.tertiary_classification;
    if (
      normaliseClassKey(props.secondary_classification) ===
      normaliseClassKey(props.classification)
    ) {
      delete props.secondary_classification;
      setSecondaryClass("");
    }
    selected.feature = selected.feature || { type: "Feature", properties: {} };
    selected.feature.properties = props;
    setTertiaryClass("");
    applyFeatureStyle(selected, selected.feature?.properties?.classification, true);
    if (selected.bringToFront) selected.bringToFront();
    pushHistory();
    refresh();
  };

  // Keep the latest activeClass + bufferMeters available to the pm:create handler.
  // Declared above the main effect so the closure inside it sees the ref.
  const activeClassRef = useRef(activeClass);
  const bufferMetersRef = useRef(bufferMeters);
  const selectedRoadKeysRef = useRef(selectedRoadKeys);
  useEffect(() => {
    activeClassRef.current = activeClass;
  }, [activeClass]);
  useEffect(() => {
    bufferMetersRef.current = bufferMeters;
  }, [bufferMeters]);
  useEffect(() => {
    selectedRoadKeysRef.current = selectedRoadKeys;
  }, [selectedRoadKeys]);

  // ---- OSM roads layer: click-to-tag pipeline ----
  // Fetch the chipped roads file once per (roadsUrl, visible) cycle.
  // Each segment becomes a clickable LineString; click toggles its
  // membership in selectedRoadKeys. The class-chip onClick further
  // down checks the ref and, if any roads are selected, buffers them
  // into a new corridor zone instead of just setting the next-draw
  // class.
  useEffect(() => {
    if (!roadsUrl || !visible || !map) return;
    let cancelled = false;
    const byKey = new Map();
    roadsByKeyRef.current = byKey;

    // Dedicated pane so road lines sit above tiles + zones but below
    // barangay outlines, and so that disabling visibility is a single
    // CSS toggle if we ever want it.
    if (!map.getPane("osm-roads-pane")) {
      const pane = map.createPane("osm-roads-pane");
      pane.style.zIndex = 442;
    }

    fetch(roadsUrl, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (cancelled || !fc?.features) return;
        const layer = L.geoJSON(fc, {
          pane: "osm-roads-pane",
          style: () => ROAD_STYLE_DEFAULT,
          // pmIgnore on the parent group + every child line tells
          // leaflet-geoman to skip the road network entirely. Without
          // this, the global snap (snapDistance: 8px) latches a
          // dragged zone vertex onto whichever road centerline is
          // closest, which routinely produces weird "bent into the
          // road" shapes when editing corridor polygons that hug a
          // road.
          pmIgnore: true,
          onEachFeature: (feature, leafletLayer) => {
            // Belt-and-suspenders: also flag each child line. The
            // parent group's pmIgnore is enough for Geoman 2.19+, but
            // some snap probes still walk children directly.
            leafletLayer.options = leafletLayer.options || {};
            leafletLayer.options.pmIgnore = true;
            leafletLayer.options.snapIgnore = true;
            const key = roadFeatureKey(feature);
            byKey.set(key, { feature, leafletLayer });
            leafletLayer.on("click", (ev) => {
              // Road selection is intentionally gated by Shift+click so
              // ordinary clicks don't accidentally tag segments.
              if (!ev?.originalEvent?.shiftKey) return;
              L.DomEvent.stopPropagation(ev);
              setSelectedRoadKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            });
            leafletLayer.on("mouseover", () => {
              if (!selectedRoadKeysRef.current.has(key)) {
                leafletLayer.setStyle(ROAD_STYLE_HOVER);
              }
            });
            leafletLayer.on("mouseout", () => {
              if (!selectedRoadKeysRef.current.has(key)) {
                leafletLayer.setStyle(ROAD_STYLE_DEFAULT);
              }
            });
            const tip = [
              feature.properties?.name || "(unnamed road)",
              feature.properties?.highway,
              feature.properties?.barangay_name,
              `${feature.properties?.length_m ?? "?"} m`,
            ]
              .filter(Boolean)
              .join(" · ");
            leafletLayer.bindTooltip(tip, { sticky: true });
          },
        });
        layer.addTo(map);
        roadsLayerRef.current = layer;
      })
      .catch(() => {
        // Roads file missing or unreadable — that's fine, click-to-tag
        // just won't be available. The pencil/draw flow still works.
      });

    return () => {
      cancelled = true;
      if (roadsLayerRef.current) {
        map.removeLayer(roadsLayerRef.current);
        roadsLayerRef.current = null;
      }
      roadsByKeyRef.current = new Map();
    };
  }, [roadsUrl, visible, map]);

  // Fetch the chipped frontage-bands file when the bands toggle is on.
  // Each chip is one road segment's 0–30 m or 30–60 m polygon. Shift+
  // click toggles selection; the chip-onClick down below converts the
  // selected band polygons directly into a zone (no buffering needed —
  // they're already the right shape).
  useEffect(() => {
    if (!frontageBandsUrl || !visible || !map || !showFrontageBands) return;
    let cancelled = false;
    const byKey = new Map();
    bandsByKeyRef.current = byKey;

    // Pane below the roads layer so road centerlines still take click
    // priority where they overlap with band fills.
    if (!map.getPane("frontage-bands-edit-pane")) {
      const pane = map.createPane("frontage-bands-edit-pane");
      pane.style.zIndex = 435;
    }

    fetch(frontageBandsUrl, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (cancelled || !fc?.features) return;
        const layer = L.geoJSON(fc, {
          pane: "frontage-bands-edit-pane",
          style: (feature) => bandStyleFor(feature, false),
          // Bands are non-editable guides — keep them out of geoman's
          // snap + edit pipeline.
          pmIgnore: true,
          onEachFeature: (feature, leafletLayer) => {
            leafletLayer.options = leafletLayer.options || {};
            leafletLayer.options.pmIgnore = true;
            leafletLayer.options.snapIgnore = true;
            const key = feature.properties?.chip_id;
            if (!key) return;
            byKey.set(key, { feature, leafletLayer });
            leafletLayer.on("click", (ev) => {
              // Same UX as road click — Shift gates the selection so
              // ordinary clicks don't accidentally toggle bands when
              // the user just wants to pan or click through to a zone.
              if (!ev?.originalEvent?.shiftKey) return;
              L.DomEvent.stopPropagation(ev);
              setSelectedBandKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            });
            leafletLayer.on("mouseover", () => {
              if (!selectedBandKeysRef.current.has(key)) {
                leafletLayer.setStyle(bandHoverStyleFor(feature));
              }
            });
            leafletLayer.on("mouseout", () => {
              if (!selectedBandKeysRef.current.has(key)) {
                leafletLayer.setStyle(bandStyleFor(feature, false));
              }
            });
            const tip = [
              feature.properties?.label,
              feature.properties?.road_name || "(unnamed road)",
              feature.properties?.road_highway,
              feature.properties?.barangay_name,
            ]
              .filter(Boolean)
              .join(" · ");
            leafletLayer.bindTooltip(tip, { sticky: true });
          },
        });
        layer.addTo(map);
        bandsLayerRef.current = layer;
      })
      .catch(() => {
        // Bands file missing — silently skip; bands just won't be
        // available. Run `npm run bands:<slug>` to generate.
      });

    return () => {
      cancelled = true;
      if (bandsLayerRef.current) {
        map.removeLayer(bandsLayerRef.current);
        bandsLayerRef.current = null;
      }
      bandsByKeyRef.current = new Map();
    };
  }, [frontageBandsUrl, visible, map, showFrontageBands]);

  // Restyle every band chip whenever the selection set changes.
  useEffect(() => {
    const byKey = bandsByKeyRef.current;
    if (!byKey) return;
    for (const [key, { feature, leafletLayer }] of byKey) {
      leafletLayer.setStyle(bandStyleFor(feature, selectedBandKeys.has(key)));
    }
  }, [selectedBandKeys]);

  // ---- Multi-vertex tool: render handles when toggled on ----
  useEffect(() => {
    // Tear down any previous markers + state.
    const tearDown = () => {
      if (vertexLayerRef.current) {
        try {
          map.removeLayer(vertexLayerRef.current);
        } catch {}
        vertexLayerRef.current = null;
      }
      vertexMarkersByKeyRef.current = new Map();
      vertexDragStateRef.current = null;
    };
    tearDown();

    const sel = selectedLayerRef.current;

    // When multi-vertex mode is OFF, restore Geoman's per-layer edit
    // on the currently-selected polygon (if any) so the user gets the
    // built-in single-vertex drag + edge-insert behavior back.
    if (!multiVertexMode) {
      if (sel && sel.pm && !sel.pm.enabled?.()) {
        try {
          sel.pm.enable({
            // Same loosening as in selectLayer — Geoman's intersection
            // check silently rejects vertex moves on complex baked
            // corridors, which the user perceives as "vertex won't
            // move".
            allowSelfIntersection: true,
            preventMarkerRemoval: false,
            snappable: true,
          });
        } catch {}
      }
      return;
    }

    if (!sel || typeof sel.getLatLngs !== "function") return;
    // While our markers are active, suppress Geoman's vertex handles
    // on the selected layer to avoid two sets of markers overlapping.
    if (sel.pm?.enabled?.()) {
      try {
        sel.pm.disable();
      } catch {}
    }

    // Dedicated pane so vertex handles always sit above the polygon
    // fills and the labels overlay.
    if (!map.getPane("vertex-pane")) {
      const pane = map.createPane("vertex-pane");
      pane.style.zIndex = 470;
    }

    const vGroup = L.layerGroup().addTo(map);
    vertexLayerRef.current = vGroup;
    const markers = new Map();
    vertexMarkersByKeyRef.current = markers;

    const rings = ringsFromLatLngs(sel.getLatLngs());
    for (const { path, ring } of rings) {
      for (let vi = 0; vi < ring.length; vi++) {
        const ll = ring[vi];
        const key = vertexKey(path, vi);
        const isSel = selectedVertexKeysRef.current.has(key);
        const marker = L.marker(ll, {
          icon: L.divIcon({
            className: `vertex-handle${isSel ? " is-selected" : ""}`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
          pane: "vertex-pane",
          draggable: true,
          keyboard: false,
          // We don't need geoman to track this layer.
          pmIgnore: true,
        });

        marker.on("click", (e) => {
          const shift = !!e.originalEvent?.shiftKey;
          setSelectedVertexKeys((prev) => {
            const next = new Set(prev);
            if (shift) {
              if (next.has(key)) next.delete(key);
              else next.add(key);
            } else {
              // Plain click: select solo. If already the sole
              // selection, deselect.
              if (next.size === 1 && next.has(key)) {
                next.clear();
              } else {
                next.clear();
                next.add(key);
              }
            }
            return next;
          });
        });

        marker.on("contextmenu", (e) => {
          e.originalEvent?.preventDefault?.();
          // Right-click removes just this vertex.
          removeVerticesByKey(new Set([key]));
        });

        marker.on("dragstart", () => {
          // If the dragged vertex isn't already selected, treat the
          // drag as a solo move (don't drag an unrelated selection).
          const cur = selectedVertexKeysRef.current;
          const dragSel = cur.has(key) ? cur : new Set([key]);
          const layerLatLngs = sel.getLatLngs();
          const startPositions = new Map();
          for (const k of dragSel) {
            const { ringPath, vertexIdx } = parseVertexKey(k);
            const r = getRingByPath(layerLatLngs, ringPath);
            const v = r?.[vertexIdx];
            if (v) startPositions.set(k, L.latLng(v.lat, v.lng));
          }
          vertexDragStateRef.current = {
            dragKey: key,
            dragStartLatLng: marker.getLatLng(),
            selection: dragSel,
            startPositions,
          };
        });

        marker.on("drag", () => {
          const ds = vertexDragStateRef.current;
          if (!ds) return;
          const cur = marker.getLatLng();
          const dLat = cur.lat - ds.dragStartLatLng.lat;
          const dLng = cur.lng - ds.dragStartLatLng.lng;
          const layerLatLngs = sel.getLatLngs();
          for (const k of ds.selection) {
            const start = ds.startPositions.get(k);
            if (!start) continue;
            const newLatLng = L.latLng(start.lat + dLat, start.lng + dLng);
            const { ringPath, vertexIdx } = parseVertexKey(k);
            const r = getRingByPath(layerLatLngs, ringPath);
            if (!r || !r[vertexIdx]) continue;
            r[vertexIdx] = newLatLng;
            // Move the visible marker for every selected vertex EXCEPT
            // the one being dragged (Leaflet already moved it).
            if (k !== ds.dragKey) {
              const otherMarker = vertexMarkersByKeyRef.current.get(k);
              if (otherMarker) otherMarker.setLatLng(newLatLng);
            }
          }
          sel.setLatLngs(layerLatLngs);
        });

        marker.on("dragend", () => {
          vertexDragStateRef.current = null;
          pushHistory();
          refresh();
        });

        marker.addTo(vGroup);
        markers.set(key, marker);
      }
    }

    return () => {
      tearDown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiVertexMode, selectedLayerVersion]);

  // Restyle vertex handles when the per-vertex selection changes.
  useEffect(() => {
    const markers = vertexMarkersByKeyRef.current;
    if (!markers) return;
    for (const [key, marker] of markers) {
      const isSel = selectedVertexKeys.has(key);
      const iconEl = marker.getElement();
      if (iconEl) {
        iconEl.classList.toggle("is-selected", isSel);
      }
    }
  }, [selectedVertexKeys]);

  // Remove a set of vertices from the currently-selected polygon.
  // Validates each ring keeps at least 3 vertices — silently skips
  // removals that would degenerate a ring.
  const removeVerticesByKey = (keys) => {
    const sel = selectedLayerRef.current;
    if (!sel || typeof sel.getLatLngs !== "function") return;
    const latlngs = sel.getLatLngs();
    // Group keys by ring path so we can remove descending indices and
    // count survivors per ring.
    const byRing = new Map(); // ringPath → Set<vertexIdx>
    for (const k of keys) {
      const { ringPath, vertexIdx } = parseVertexKey(k);
      if (!byRing.has(ringPath)) byRing.set(ringPath, new Set());
      byRing.get(ringPath).add(vertexIdx);
    }
    let anyRemoved = false;
    for (const [ringPath, indices] of byRing) {
      const ring = getRingByPath(latlngs, ringPath);
      if (!Array.isArray(ring)) continue;
      const survivors = ring.length - indices.size;
      if (survivors < 3) {
        console.warn(
          `Refusing to remove ${indices.size} vertices from ring ${ringPath} — would leave ${survivors}, polygons need ≥3.`
        );
        continue;
      }
      // Remove from highest index downward to keep lower indices stable.
      const sorted = [...indices].sort((a, b) => b - a);
      for (const i of sorted) ring.splice(i, 1);
      anyRemoved = true;
    }
    if (!anyRemoved) return;
    sel.setLatLngs(latlngs);
    // Selection no longer references valid indices — clear it and let
    // the version bump rebuild markers from scratch.
    setSelectedVertexKeys(new Set());
    setSelectedLayerVersion((v) => v + 1);
    pushHistory();
    refresh();
  };

  // Restyle every road sub-layer whenever the selection set changes.
  useEffect(() => {
    const byKey = roadsByKeyRef.current;
    if (!byKey) return;
    for (const [key, { leafletLayer }] of byKey) {
      leafletLayer.setStyle(
        selectedRoadKeys.has(key) ? ROAD_STYLE_SELECTED : ROAD_STYLE_DEFAULT
      );
    }
  }, [selectedRoadKeys]);

  // Convert the currently-selected road segments AND/OR frontage-band
  // chips into a zone tagged with `klass`. Used by the class chip
  // onClick when the user has either kind of selection active. Returns
  // true if it added a zone (so the chip handler knows to short-circuit
  // out of its other branches).
  //
  // Two paths feed into the resulting polygon:
  //   - Selected ROADS    → buffered along centerline (flat-cap, with
  //                         optional road-inset carve-out)
  //   - Selected BANDS    → polygon used directly (already the right
  //                         shape — no buffer step)
  // If both kinds are selected, the results are unioned into a single
  // zone polygon so the user gets one combined shape.
  const bakeRoadsIntoCorridor = (klass) => {
    const group = groupRef.current;
    const roadByKey = roadsByKeyRef.current;
    const bandByKey = bandsByKeyRef.current;
    const roadSel = selectedRoadKeysRef.current;
    const bandSel = selectedBandKeysRef.current;
    if (!group) return false;
    if (roadSel.size === 0 && bandSel.size === 0) return false;

    const candidatePolys = [];

    // ---- Path 1: roads → flat-cap buffer ----
    if (roadByKey && roadSel.size > 0) {
      const coordsList = [];
      for (const key of roadSel) {
        const entry = roadByKey.get(key);
        const geom = entry?.feature?.geometry;
        if (geom?.type === "LineString") {
          coordsList.push(geom.coordinates);
        } else if (geom?.type === "MultiLineString") {
          for (const line of geom.coordinates) coordsList.push(line);
        }
      }
      if (coordsList.length) {
        try {
          const mls = turf.multiLineString(coordsList);
          const buffered = bufferAlongsideRoad(mls, bufferMetersRef.current);
          if (buffered?.geometry) candidatePolys.push(buffered);
        } catch (e) {
          console.warn("bakeRoadsIntoCorridor: road buffer failed", e);
        }
      }
    }

    // ---- Path 2: bands → use polygons directly ----
    if (bandByKey && bandSel.size > 0) {
      for (const key of bandSel) {
        const entry = bandByKey.get(key);
        const feat = entry?.feature;
        if (!feat?.geometry) continue;
        candidatePolys.push({
          type: "Feature",
          properties: feat.properties ?? {},
          geometry: feat.geometry,
        });
      }
    }

    if (candidatePolys.length === 0) return false;

    // Combine into one geometry via tree-reduce. We previously called
    // turf.union once across the whole array — if that threw (rare,
    // but possible on degenerate polygons), we'd silently drop N-1
    // candidates and only keep the first. Tree-reduce keeps going past
    // a bad pair and ends with a Polygon (touching pieces) or
    // MultiPolygon (disjoint pieces) — both render as a single
    // editable Leaflet layer.
    let combined = null;
    for (const cand of candidatePolys) {
      if (!combined) {
        combined = cand;
        continue;
      }
      try {
        const merged = turf.union(turf.featureCollection([combined, cand]));
        if (merged?.geometry) {
          combined = merged;
        }
      } catch (e) {
        console.warn(
          "bakeRoadsIntoCorridor: union step failed, keeping previous combined geometry",
          e
        );
      }
    }
    if (!combined?.geometry) return false;

    // Normalise the merged geometry. turf.union (and the band-buffer
    // pipeline before it) routinely leaves:
    //   - Duplicate consecutive vertices where two chips meet
    //   - Colinear vertices along a long straight road segment
    //   - Tiny self-intersection nubs from the lineOffset stitching
    // Geoman's vertex marker layout silently skips duplicate/colinear
    // vertices, which is what the user sees as "this vertex won't
    // move" — there's no marker on it. cleanCoords drops the dupes,
    // and a 0-buffer pass repairs any degenerate ring topology so the
    // polygon is truly simple before we wrap it in a Leaflet layer.
    try {
      combined = turf.cleanCoords(combined);
    } catch (e) {
      // cleanCoords is finicky on MultiPolygon-with-holes; leave as-is
      // if it errors.
    }
    try {
      const repaired = turf.buffer(combined, 0, { units: "meters" });
      if (repaired?.geometry) combined = repaired;
    } catch {}
    if (!combined?.geometry) return false;

    // Clip the new polygon against every existing zone in the group so
    // we never paint on top of an already-classified area. Without this
    // the user would get double-tagged overlaps that look messy on the
    // map and confuse downstream consumers of the GeoJSON (which expect
    // one class per parcel).
    //
    // We iterate one-by-one rather than unioning all existing first —
    // it's slower per call but more resilient to malformed legacy
    // polygons (one bad union would break everything; one bad
    // difference just leaves that zone unsubtracted).
    //
    // The user can disable this via the "Trim against existing zones"
    // toggle in the panel — useful when re-painting a corridor that
    // should overlap an older zone (e.g., promoting an R-2 strip to
    // C-2 along the same road).
    let trimmed = combined;
    let clipBbox;
    let originalArea = 0;
    try {
      originalArea = turf.area(combined);
    } catch {}
    try {
      clipBbox = turf.bbox(trimmed);
    } catch {
      clipBbox = null;
    }
    let clipsHit = 0;
    if (clipBbox && trimAgainstExistingRef.current) {
      group.eachLayer((existing) => {
        if (!trimmed?.geometry) return;
        // Skip the layer being subtracted by, in case bake somehow
        // re-iterates over the freshly-added shape (it shouldn't, since
        // we add after this loop — defensive).
        let existingFeature;
        try {
          existingFeature = existing.toGeoJSON();
        } catch {
          return;
        }
        if (
          !existingFeature?.geometry ||
          !["Polygon", "MultiPolygon"].includes(existingFeature.geometry.type)
        ) {
          return;
        }
        // Bbox pre-filter: skip zones whose bounding box can't possibly
        // overlap our candidate. With hundreds of existing polygons,
        // this is the difference between a snappy click and a 5-second
        // freeze on a populated municipality.
        let eb;
        try {
          eb = turf.bbox(existingFeature);
        } catch {
          return;
        }
        if (
          eb[2] < clipBbox[0] ||
          eb[0] > clipBbox[2] ||
          eb[3] < clipBbox[1] ||
          eb[1] > clipBbox[3]
        ) {
          return;
        }
        try {
          const diff = turf.difference(
            turf.featureCollection([trimmed, existingFeature])
          );
          if (diff?.geometry) {
            // Track that we actually subtracted something so we can tell
            // the user when the entire candidate got eaten.
            clipsHit += 1;
            trimmed = diff;
            // Update the bbox so subsequent rejects can be tighter.
            try {
              clipBbox = turf.bbox(trimmed);
            } catch {}
          } else {
            // Difference returned null = candidate fully covered by this
            // existing zone. Nothing left to add.
            trimmed = null;
          }
        } catch {
          // Degenerate polygon — leave trimmed as-is and move on.
        }
      });
    }

    if (!trimmed?.geometry) {
      alert(
        "This area is already fully classified — every part of the " +
          "selection overlaps an existing zone. Nothing new was added.\n\n" +
          "If you meant to repaint over existing zones, untick " +
          '"Trim against existing zones" in the editor panel and try again.'
      );
      setSelectedRoadKeys(new Set());
      setSelectedBandKeys(new Set());
      return false;
    }
    // From here on use the clipped version.
    combined = trimmed;

    // If the clip removed a meaningful chunk (>25% of the candidate's
    // original area), tell the user so they're not surprised when only
    // one side of a road fills. This was a common confusion before —
    // user shift+clicks a road, picks a class, and only the empty side
    // gets painted because the other side already had an old zone.
    if (clipsHit > 0 && originalArea > 0) {
      try {
        const trimmedArea = turf.area(combined);
        const pctTrimmed = Math.round((1 - trimmedArea / originalArea) * 100);
        if (pctTrimmed >= 25) {
          console.info(
            `Bake auto-trimmed ${pctTrimmed}% of the candidate area where it overlapped ${clipsHit} existing zone(s).`
          );
          setBakeNotice(
            `Trimmed ${pctTrimmed}% — overlapped ${clipsHit} existing zone${clipsHit === 1 ? "" : "s"}. Untick "Trim against existing zones" to paint over.`
          );
          setTimeout(() => setBakeNotice(""), 5000);
        }
      } catch {}
    }

    const props = {
      classification: klass,
      // Source label reflects what fed in: roads-only, bands-only, or
      // both. Useful for later audits — bands-derived zones don't have
      // a buffer width because their depth is baked in (30 m or 60 m).
      source:
        roadSel.size > 0 && bandSel.size > 0
          ? "road+band-tag"
          : bandSel.size > 0
            ? "band-tag"
            : "road-tag",
      ...(roadSel.size > 0 ? { buffer_m: bufferMetersRef.current } : {}),
      ...(roadSel.size > 0 ? { road_keys: [...roadSel] } : {}),
      ...(bandSel.size > 0 ? { band_keys: [...bandSel] } : {}),
      // True when at least one existing zone clipped this candidate.
      // Useful for audits ("is this an outline shape, or what survived
      // after clipping against neighbors?").
      ...(clipsHit > 0 ? { clipped_against_existing: clipsHit } : {}),
    };
    const wrap = L.geoJSON(
      { type: "Feature", properties: props, geometry: combined.geometry },
      { style: () => ({}) }
    );
    // Capture the last sub-layer added so we can auto-select it below.
    // For Polygon geometries, wrap has a single sub-layer; for
    // MultiPolygons (disjoint chips), it still becomes one Leaflet
    // polygon layer that handles all rings — Geoman lets the user
    // edit each ring's vertices in place.
    let newLayer = null;
    wrap.eachLayer((sub) => {
      sub.feature = sub.feature || { type: "Feature", properties: {} };
      sub.feature.properties = { ...sub.feature.properties, ...props };
      applyFeatureStyle(sub, klass);
      prepareLayer(sub);
      group.addLayer(sub);
      newLayer = sub;
    });

    setSelectedRoadKeys(new Set());
    setSelectedBandKeys(new Set());
    pushHistory();
    refresh();
    // Auto-select the freshly-added zone so its vertex handles appear
    // immediately — the user can drag/insert/delete vertices straight
    // away without having to click the new shape first. selectLayer
    // also wires up Geoman's per-layer edit mode (snap, marker
    // removal, etc.).
    if (newLayer) {
      selectLayer(newLayer);
    }
    return true;
  };

  useEffect(() => {
    // Geoman is imported at module scope in LeafletMap.js so its init-hook
    // is already registered on L.Map by the time react-leaflet creates the
    // map. If `map.pm` is still missing, bail out loudly rather than crash.
    if (!map.pm) {
      console.error(
        "leaflet-geoman didn't attach to the map. Make sure '@geoman-io/leaflet-geoman-free' is imported before MapContainer mounts."
      );
      return;
    }

    const group = L.featureGroup().addTo(map);
    groupRef.current = group;

    let cancelled = false;

    // Local browser edits win. If there are no browser edits yet, load the
    // bundled offline zones file so exported zones can be committed permanently.
    (async () => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          loadGeoJSONIntoGroup(JSON.parse(saved), group, prepareLayer);
          pushHistory(false);
          refresh();
          return;
        }

        const res = await fetch(bundledZonesUrl);
        if (!res.ok || cancelled) return;
        const fc = await res.json();
        if (!cancelled) {
          loadGeoJSONIntoGroup(fc, group, prepareLayer);
          pushHistory(false);
          refresh();
        }
      } catch (e) {
        console.warn("Failed to load saved zones", e);
      }
    })();

    // Geoman global options & toolbar
    map.pm.setGlobalOptions({
      layerGroup: group,
      snappable: true,
      snapDistance: 8,
      // Don't reject self-intersecting moves at the global level —
      // baked frontage corridors are complex polygons-with-holes and
      // Geoman's check would silently swallow legitimate vertex drags.
      // Per-layer pm.enable mirrors this setting.
      allowSelfIntersection: true,
      tooltips: false,
    });
    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: true,
      drawCircle: false,
      drawText: false,
      rotateMode: false,
      // Hide the global edit button — it puts *every* polygon into
      // vertex-edit mode at once, which with hundreds of holes (from
      // the road-inset corridors) tanks performance. Per-layer edit
      // happens automatically when a polygon is selected (see
      // selectLayer below).
      editMode: false,
    });
    // Belt-and-suspenders: if global edit gets toggled some other way,
    // immediately disable it.
    map.on("pm:globaleditmodetoggled", (e) => {
      if (e.enabled) {
        try {
          map.pm.disableGlobalEditMode();
        } catch {}
      }
    });

    // Scope leaflet-geoman's Cut tool to only the currently-selected
    // polygon. By default Cut subtracts the drawn shape from EVERY
    // layer in `layerGroup` that overlaps — so cutting at an
    // intersection where C-1, R-1 and a bunch of corridors overlap
    // would punch a hole in all of them. Two-pronged guard:
    //   1. pmIgnore = true on every non-selected layer so geoman's
    //      overlap scan skips them.
    //   2. Swap the global layerGroup to a single-layer FeatureGroup
    //      containing only the selection.
    // Both are restored on exit so subsequent draws / edits behave
    // normally.
    const onGlobalCutModeToggled = (e) => {
      if (e.enabled) {
        const selected = selectedLayerRef.current;
        if (!selected) {
          // No selection → bail out. Wait a tick so we don't recurse
          // inside geoman's enable transaction.
          setTimeout(() => {
            try {
              map.pm.disableGlobalCutMode();
            } catch {}
          }, 0);
          return;
        }
        // Snapshot the selected layer's props NOW so the eventual
        // pm:cut handler has a reliable source for classification,
        // regardless of what Geoman puts in event.originalLayer.
        cutSourcePropsRef.current = {
          ...(selected.feature?.properties || {}),
        };
        const cutScope = L.featureGroup([selected]);
        cutScopedGroupRef.current = cutScope;
        group.eachLayer((layer) => {
          if (layer !== selected) {
            layer.options = layer.options || {};
            layer.options.pmIgnore = true;
          }
        });
        try {
          map.pm.setGlobalOptions({
            layerGroup: cutScope,
          });
        } catch {}
      } else {
        cutScopedGroupRef.current = null;
        cutSourcePropsRef.current = null;
        group.eachLayer((layer) => {
          if (layer.options && "pmIgnore" in layer.options) {
            delete layer.options.pmIgnore;
          }
        });
        try {
          map.pm.setGlobalOptions({ layerGroup: group });
        } catch {}
      }
    };

    const onCut = (e) => {
      if (isRestoringRef.current) return;

      // Resolve the "original" polygon being cut. Three fallbacks
      // because Geoman versions are inconsistent about which fields
      // they populate on the pm:cut event:
      //   1. event.originalLayer    — set in modern Geoman
      //   2. event.target           — sometimes set on global cut
      //   3. selectedLayerRef.current — cut is scoped to selection,
      //                                  so this is virtually always
      //                                  the right layer
      const original =
        e?.originalLayer ??
        e?.target ??
        selectedLayerRef.current ??
        null;

      // Classification source priority:
      //   1. The snapshot we captured when Cut mode started (most
      //      reliable — guaranteed to be the user's intended source).
      //   2. The original layer's props if 1 isn't set (e.g., the
      //      handler somehow fired without going through the toggle).
      //   3. Empty object (last resort — result will be UNCLASSIFIED).
      // The original's secondary/tertiary tags carry through too.
      const sourceProps =
        cutSourcePropsRef.current ??
        original?.feature?.properties ??
        {};

      // Pre-filter cut result layers: drop sliver / thin-strip pieces
      // before they ever land on the map. Geoman emits one layer per
      // resulting polygon, and on cuts that cross a road-inset hole
      // it can produce many narrow strip artifacts as well as the
      // intended main pieces. Same compactness threshold as the
      // Clean geometry button.
      let droppedCutSlivers = 0;
      const resultLayers = extractCutResultLayers(e)
        .filter((layer) => layer && layer !== original)
        .filter((layer) => {
          let gj;
          try {
            gj = layer.toGeoJSON();
          } catch {
            return true; // can't measure → keep it, user can clean manually
          }
          if (!gj?.geometry) return true;
          // Test each polygon part. If ALL parts are slivers, drop the
          // whole layer. If at least one part is non-sliver, keep
          // (Clean geometry can refine later).
          const polygons =
            gj.geometry.type === "MultiPolygon"
              ? gj.geometry.coordinates.map((c) => ({
                  type: "Polygon",
                  coordinates: c,
                }))
              : [gj.geometry];
          const allSliver = polygons.every((g) =>
            isSliverPolygon(g, { minAreaM2: 50, minCompactness: 0.1 })
          );
          if (allSliver) droppedCutSlivers += 1;
          return !allSliver;
        });

      if (original) {
        if (selectedLayerRef.current === original) {
          selectedLayerRef.current = null;
        }
        try {
          group.removeLayer(original);
        } catch {}
        try {
          map.removeLayer(original);
        } catch {}
      }

      if (resultLayers.length === 0) {
        pushHistory();
        refresh();
        return;
      }

      for (const layer of resultLayers) {
        layer.feature = layer.feature || { type: "Feature", properties: {} };
        // Source-class properties WIN here (previously they were
        // being overwritten by Geoman's empty `feature.properties`
        // object, which is why cut results rendered grey
        // UNCLASSIFIED). Anything Geoman did set is preserved unless
        // sourceProps explicitly carries the same key.
        layer.feature.properties = {
          ...(layer.feature.properties || {}),
          ...sourceProps,
        };
        applyFeatureStyle(layer, layer.feature.properties?.classification);
        prepareLayer(layer);
        if (!group.hasLayer(layer)) {
          group.addLayer(layer);
        }
      }

      // Select the first resulting piece so follow-up edits are immediate.
      selectLayer(resultLayers[0]);
      pushHistory();
      refresh();
      if (droppedCutSlivers > 0) {
        // Tell the user we filtered the cut output — otherwise they'd
        // wonder why some thin-strip artifacts they saw a moment ago
        // disappeared.
        setBakeNotice(
          `Cut: auto-dropped ${droppedCutSlivers} sliver strip${droppedCutSlivers === 1 ? "" : "s"} (thin/narrow leftover pieces).`
        );
        setTimeout(() => setBakeNotice(""), 5000);
      }
    };

    // Tag any newly drawn shape with the currently selected classification.
    // For polylines (corridors along roads), buffer them by `bufferMeters`
    // and replace the line with the resulting polygon so we end up with a
    // proper zone tagged with the active class.
    const onCreate = (e) => {
      const klass = activeClassRef.current;
      const isPolyline =
        e.shape === "Line" ||
        (e.layer instanceof L.Polyline && !(e.layer instanceof L.Polygon));

      if (isPolyline) {
        const lineFeature = e.layer.toGeoJSON();
        let buffered;
        try {
          buffered = bufferAlongsideRoad(
            lineFeature,
            bufferMetersRef.current
          );
        } catch (err) {
          console.warn("Could not buffer line:", err);
          buffered = null;
        }
        // Drop the original polyline; replace with the buffered polygon.
        group.removeLayer(e.layer);
        try {
          map.removeLayer(e.layer);
        } catch {}

        if (!buffered || !buffered.geometry) {
          refresh();
          return;
        }
        const props = {
          classification: klass,
          source: "corridor",
          buffer_m: bufferMetersRef.current,
        };
        const layer = L.geoJSON(
          { ...buffered, properties: props },
          {
            style: () => ({}),
          }
        );
        // L.geoJSON returns a layer group; pull the inner polygon and add it.
        layer.eachLayer((sub) => {
          sub.feature = sub.feature || { type: "Feature", properties: {} };
          sub.feature.properties = { ...sub.feature.properties, ...props };
          applyFeatureStyle(sub, klass);
          prepareLayer(sub);
          group.addLayer(sub);
        });
        pushHistory();
        refresh();
        return;
      }

      e.layer.feature = e.layer.feature || {
        type: "Feature",
        properties: {},
      };
      e.layer.feature.properties = {
        ...(e.layer.feature.properties || {}),
        classification: klass,
      };
      applyFeatureStyle(e.layer, klass);
      prepareLayer(e.layer);
      group.addLayer(e.layer);
      selectLayer(e.layer);
      pushHistory();
      refresh();
    };
    const onRemove = () => {
      if (isRestoringRef.current) return;
      selectedLayerRef.current = null;
      pushHistory();
      refresh();
    };
    const onEdit = () => pushHistory();
    const onMapClick = (e) => {
      // If the user has the "+ Landmark" placing tool active, this
      // click drops a pending pin. Otherwise (default behaviour), the
      // click clears any layer selection.
      if (placingLandmarkRef.current && e?.latlng) {
        setPendingLandmark({
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          name: "",
          kind: "business",
          // Always an array — one landmark can link to many stretches.
          // Auto-seeded with whatever's active in the sidebar so the
          // user gets one click for "link to this stretch".
          stretchKeys: activeStretchKey ? [activeStretchKey] : [],
        });
        setPlacingLandmark(false);
        return;
      }
      selectLayer(null);
    };
    const setDrawingActive = (active) => {
      map.getContainer().classList.toggle("zone-editing-active", active);
    };
    const onDrawStart = () => setDrawingActive(true);
    const onDrawEnd = () => setDrawingActive(false);
    const onGlobalMode = (e) => setDrawingActive(!!e.enabled);
    const onKeyDown = (e) => {
      const target = e.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (isTyping) return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const wantsUndo = mod && !e.altKey && key === "z" && !e.shiftKey;
      const wantsRedo =
        mod && !e.altKey && (key === "y" || (key === "z" && e.shiftKey));
      const wantsDelete =
        !mod && !e.altKey && (e.key === "Delete" || e.key === "Backspace");

      // Escape cancels the "+ Landmark" placing mode, any pending
      // landmark form, or the "Move pin" mode — gives a no-mouse-needed
      // way to bail out.
      if (
        e.key === "Escape" &&
        (placingLandmarkRef.current ||
          pendingLandmark ||
          movingLandmarkRef.current)
      ) {
        e.preventDefault();
        setPlacingLandmark(false);
        setPendingLandmark(null);
        setMovingLandmark(false);
        return;
      }
      if (wantsUndo) {
        e.preventDefault();
        undo();
      } else if (wantsRedo) {
        e.preventDefault();
        redo();
      } else if (
        wantsDelete &&
        multiVertexModeRef.current &&
        selectedVertexKeysRef.current.size > 0
      ) {
        // In multi-vertex mode with vertices selected, Delete removes
        // those vertices (not the whole zone). Avoids the user
        // accidentally nuking a corridor while trying to trim a corner.
        e.preventDefault();
        removeVerticesByKey(selectedVertexKeysRef.current);
      } else if (wantsDelete && selectedLayerRef.current) {
        e.preventDefault();
        deleteSelected();
      }
    };

    map.on("pm:create", onCreate);
    map.on("pm:remove", onRemove);
    map.on("pm:edit", onEdit);
    map.on("click", onMapClick);
    map.on("pm:drawstart", onDrawStart);
    map.on("pm:drawend", onDrawEnd);
    map.on("pm:globaleditmodetoggled", onGlobalMode);
    map.on("pm:globaldragmodetoggled", onGlobalMode);
    map.on("pm:globalremovalmodetoggled", onGlobalMode);
    map.on("pm:globalcutmodetoggled", onGlobalCutModeToggled);
    map.on("pm:cut", onCut);
    group.on("pm:edit", onEdit);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      map.off("pm:create", onCreate);
      map.off("pm:remove", onRemove);
      map.off("pm:edit", onEdit);
      map.off("click", onMapClick);
      map.off("pm:drawstart", onDrawStart);
      map.off("pm:drawend", onDrawEnd);
      map.off("pm:globaleditmodetoggled", onGlobalMode);
      map.off("pm:globaldragmodetoggled", onGlobalMode);
      map.off("pm:globalremovalmodetoggled", onGlobalMode);
      map.off("pm:globalcutmodetoggled", onGlobalCutModeToggled);
      map.off("pm:cut", onCut);
      group.off("pm:edit", onEdit);
      document.removeEventListener("keydown", onKeyDown);
      // Ensure cut scope and pmIgnore flags never leak across remounts.
      try {
        cutScopedGroupRef.current = null;
        group.eachLayer((layer) => {
          if (layer.options && "pmIgnore" in layer.options) {
            delete layer.options.pmIgnore;
          }
        });
        map.pm.setGlobalOptions({ layerGroup: group });
      } catch {}
      try {
        map.pm.removeControls();
      } catch {}
      try {
        map.removeLayer(group);
      } catch {}
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const exportGeoJSON = () => {
    const group = groupRef.current;
    if (!group) return;
    // group.toGeoJSON() already pulls each layer.feature.properties, which
    // we keep in sync via setProps() below.
    const fc = group.toGeoJSON();
    const blob = new Blob([JSON.stringify(fc, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save the current zones into public/data/<slug>_zones.geojson via the
  // /api/zones/save route. In local dev, the route writes straight to
  // the filesystem. On the deployed Vercel build, it commits the file
  // to GitHub via the Contents API, which triggers a rebuild — every
  // browser refreshing within ~90s sees the new zones, and local devs
  // can `git pull` to pick up the change.
  //
  // The route requires Authorization: Bearer <SAVE_PASSWORD>. We cache
  // the password in localStorage after the first successful save so
  // returning editors don't have to retype it each time.
  const SAVE_PW_KEY = "zones-save-password-v1";
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const promptForSavePassword = (reason) => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(SAVE_PW_KEY) || "";
    const pw = window.prompt(
      `${reason ? reason + "\n\n" : ""}Save password (shared with your team):`,
      stored
    );
    if (pw == null) return null;
    if (pw) {
      try {
        window.localStorage.setItem(SAVE_PW_KEY, pw);
      } catch {}
    }
    return pw;
  };
  const saveToProject = async () => {
    const group = groupRef.current;
    if (!group) return;
    setSaveStatus("saving");

    const url = `/api/zones/save?slug=${encodeURIComponent(saveSlug)}`;
    const fc = group.toGeoJSON();
    const body = JSON.stringify(fc);
    const send = (pw) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(pw ? { Authorization: `Bearer ${pw}` } : {}),
        },
        body,
      });

    // Strategy: send with whatever password is in localStorage (or none).
    // On localhost the dev server accepts no-auth, so this succeeds with
    // zero friction. In production, the server returns 401 → we prompt
    // the user once, retry, then surface a hard error if still rejected.
    let cachedPw = "";
    try {
      cachedPw = window.localStorage.getItem(SAVE_PW_KEY) || "";
    } catch {}

    try {
      let res = await send(cachedPw);

      if (res.status === 401) {
        const promptedPw = promptForSavePassword(
          cachedPw
            ? "Save password rejected. Try again:"
            : "Enter the team save password to publish your edits:"
        );
        if (!promptedPw) {
          setSaveStatus("idle");
          return;
        }
        res = await send(promptedPw);
        if (res.status === 401) {
          // Wrong password the second time too — clear the cache so the
          // next save attempt starts fresh.
          try {
            window.localStorage.removeItem(SAVE_PW_KEY);
          } catch {}
          throw new Error("Save password rejected.");
        }
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Tell the rest of the app that the on-disk zones file just changed,
      // so the read-only SMV-zones layer (used outside edit mode) can
      // refetch and stay in sync with what the user just saved.
      window.dispatchEvent(new CustomEvent(saveEventName));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1800);
    } catch (e) {
      console.error("Save to project failed:", e);
      alert(
        "Could not save to project file.\n" +
          e.message +
          "\n\nLocal dev: make sure `npm run dev` is running.\n" +
          "Deployed: confirm SAVE_PASSWORD + GITHUB_* env vars are set on Vercel."
      );
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2400);
    }
  };

  const importGeoJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fc = JSON.parse(reader.result);
      const group = groupRef.current;
      if (!group) return;
        loadGeoJSONIntoGroup(fc, group, prepareLayer);
        pushHistory();
        refresh();
      } catch (e) {
        alert("Could not parse GeoJSON: " + e.message);
      }
    };
    reader.readAsText(file);
  };

  // ---- DXF import flow ----
  // Uploads a .dxf to /api/zones/import-dxf, which runs the Python
  // converter and writes the resulting FeatureCollection straight to
  // public/data/<slug>_zones[_dxf].geojson. Once the request resolves,
  // we re-fetch that file and load it into the editor so the new zones
  // are visible immediately (no page reload needed).
  //
  // The on-disk file is replaced wholesale, so we confirm first to
  // avoid accidental destruction of in-progress edits. Local-dev only;
  // the server route returns 501 in production with a helpful message
  // that we forward to the user.
  const [dxfStatus, setDxfStatus] = useState("idle"); // idle | uploading | done | error
  const importDxfToProject = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".dxf")) {
      alert("Please pick a .dxf file.");
      return;
    }
    const ok = confirm(
      `Import ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) into ${savePathLabel}?\n\n` +
        `This REPLACES every zone in that file with the polygons extracted ` +
        `from the DXF. Any unsaved edits in the current editor session will ` +
        `also be overwritten on disk.`
    );
    if (!ok) return;

    setDxfStatus("uploading");

    const url = `/api/zones/import-dxf?slug=${encodeURIComponent(saveSlug)}`;
    const form = new FormData();
    form.append("dxf", file);

    const send = (pw) =>
      fetch(url, {
        method: "POST",
        headers: pw ? { Authorization: `Bearer ${pw}` } : undefined,
        body: form,
      });

    let cachedPw = "";
    try {
      cachedPw = window.localStorage.getItem(SAVE_PW_KEY) || "";
    } catch {}

    try {
      let res = await send(cachedPw);

      if (res.status === 401) {
        const promptedPw = promptForSavePassword(
          cachedPw
            ? "Save password rejected. Try again:"
            : "Enter the team save password to import this DXF:"
        );
        if (!promptedPw) {
          setDxfStatus("idle");
          return;
        }
        res = await send(promptedPw);
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Pull the freshly-written file back into the editor. We use a
      // cache-buster so the browser doesn't serve a stale copy from
      // the dev-server's HTTP cache.
      const fresh = await fetch(`${bundledZonesUrl}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (fresh.ok) {
        const fc = await fresh.json();
        const group = groupRef.current;
        if (group) {
          group.clearLayers();
          selectedLayerRef.current = null;
          loadGeoJSONIntoGroup(fc, group, prepareLayer);
          pushHistory();
          refresh();
        }
      }

      // Tell the rest of the app to reload its read-only zones layer.
      window.dispatchEvent(new CustomEvent(saveEventName));

      setDxfStatus("done");
      // Show a quick breakdown so the user knows what landed.
      const breakdown = Object.entries(data.classCounts || {})
        .sort()
        .map(([k, n]) => `${k}: ${n}`)
        .join(", ");
      alert(
        `Imported ${data.featureCount} polygons into ${data.path}.\n\n` +
          `Class breakdown — ${breakdown}\n\n` +
          `Visit /?m=${saveSlug} to review. Commit + push when ready.`
      );
      setTimeout(() => setDxfStatus("idle"), 1800);
    } catch (e) {
      console.error("DXF import failed:", e);
      alert(
        "Could not import DXF.\n" +
          e.message +
          "\n\nLocal dev: ensure Python 3 + ezdxf + pyproj + shapely are " +
          "installed.\nDeployed: DXF import only runs in local dev — " +
          "convert there, then commit + push the result."
      );
      setDxfStatus("error");
      setTimeout(() => setDxfStatus("idle"), 2400);
    }
  };

  const clearAll = () => {
    if (!confirm("Delete all custom zones from this map?")) return;
    const group = groupRef.current;
    if (!group) return;
    selectedLayerRef.current = null;
    group.clearLayers();
    pushHistory();
    refresh();
  };

  // ---- Draggable + collapsible editor panel state ----
  // panelPos is { top, left } in pixels relative to .leaflet-container.
  // null means "use the default bottom-anchored position" (so users who
  // haven't dragged keep the legacy bottom-left placement). Persisted to
  // localStorage per municipality so re-opening the editor restores the
  // exact spot the user left the panel at.
  const PANEL_UI_KEY = `editor-panel-ui-v1:${saveSlug}`;
  const [panelPos, setPanelPos] = useState(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const panelRef = useRef(null);
  const dragStateRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PANEL_UI_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.pos && typeof parsed.pos.top === "number") {
          setPanelPos(parsed.pos);
        }
        if (typeof parsed.collapsed === "boolean") {
          setPanelCollapsed(parsed.collapsed);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSlug]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PANEL_UI_KEY,
        JSON.stringify({ pos: panelPos, collapsed: panelCollapsed })
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelPos, panelCollapsed, saveSlug]);

  const onPanelHeaderMouseDown = (e) => {
    // Left-button only; don't initiate drag from inside the collapse
    // button (which has its own click handler).
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;

    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: panelRect.left - parentRect.left,
      startTop: panelRect.top - parentRect.top,
      parentWidth: parentRect.width,
      parentHeight: parentRect.height,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
    };

    const onMove = (ev) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startX;
      const dy = ev.clientY - ds.startY;
      const maxLeft = Math.max(0, ds.parentWidth - ds.panelWidth);
      const maxTop = Math.max(0, ds.parentHeight - ds.panelHeight);
      const left = clamp(ds.startLeft + dx, 0, maxLeft);
      const top = clamp(ds.startTop + dy, 0, maxTop);
      setPanelPos({ left, top });
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  // The panel <div> is an absolute child of .leaflet-container, so by
  // default any click inside it bubbles to Leaflet's container click
  // listener — which deselects the active polygon BEFORE React fires the
  // chip's onClick. That made every reassign run with selection=null and
  // silently no-op. disableClickPropagation kills the bubble at the panel
  // boundary so React-side handlers run with the right state.
  const panelRefCallback = (node) => {
    panelRef.current = node;
    if (node) {
      L.DomEvent.disableClickPropagation(node);
      L.DomEvent.disableScrollPropagation(node);
    }
  };

  if (!visible) return null;
  const selectedLayer = selectedLayerRef.current;
  // True when the selected polygon is a MultiPolygon with 2+ parts —
  // i.e. when "Split parts" would do something meaningful.
  // Recomputed on every render so it tracks reclassifications too;
  // forceCounter is implicitly a dep since render reflects edits.
  const selectedIsExplodable = (() => {
    if (!selectedLayer || typeof selectedLayer.toGeoJSON !== "function") {
      return false;
    }
    try {
      const gj = selectedLayer.toGeoJSON();
      return (
        gj?.geometry?.type === "MultiPolygon" &&
        Array.isArray(gj.geometry.coordinates) &&
        gj.geometry.coordinates.length >= 2
      );
    } catch {
      return false;
    }
  })();
  const selectedPrimaryClass = normaliseClassKey(
    selectedLayer?.feature?.properties?.classification
  );
  const selectedSecondaryCurrent = normaliseClassKey(
    selectedLayer?.feature?.properties?.secondary_classification
  );
  const selectedTertiaryCurrent = normaliseClassKey(
    selectedLayer?.feature?.properties?.tertiary_classification
  );
  const secondaryClassKey = normaliseClassKey(secondaryClass);
  const tertiaryClassKey = normaliseClassKey(tertiaryClass);
  const canApplySecondary =
    !!editorState.hasSelection &&
    !!secondaryClassKey &&
    secondaryClassKey !== selectedPrimaryClass &&
    secondaryClassKey !== selectedTertiaryCurrent;
  const canApplyTertiary =
    !!editorState.hasSelection &&
    !!tertiaryClassKey &&
    tertiaryClassKey !== selectedPrimaryClass &&
    tertiaryClassKey !== selectedSecondaryCurrent;
  const secondaryApplied =
    !!editorState.hasSelection &&
    !!secondaryClassKey &&
    secondaryClassKey === selectedSecondaryCurrent;
  const tertiaryApplied =
    !!editorState.hasSelection &&
    !!tertiaryClassKey &&
    tertiaryClassKey === selectedTertiaryCurrent;

  const panelStyle = {
    position: "absolute",
    zIndex: 1000,
    background: "white",
    borderRadius: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    fontSize: 12,
    maxWidth: 280,
    overflow: "hidden",
    ...(panelPos
      ? { top: panelPos.top, left: panelPos.left }
      : { bottom: 16, left: 60 }),
  };
  // Friendly label for whatever class the selected zone currently has.
  // Falls back to "—" for unclassified zones so the title is still clear.
  const selectedLabel = selectedPrimaryClass
    ? CLASSIFICATION_INFO[selectedPrimaryClass]?.label ?? selectedPrimaryClass
    : null;
  // Build a friendly pre-bake summary when roads and/or bands are
  // selected. Distinguishes the three combinations so the user knows
  // exactly what'll happen on a chip click.
  const pickPlural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const headerTitle = bakeNotice
    ? bakeNotice
    : selectedRoadKeys.size > 0 && selectedBandKeys.size > 0
      ? `${pickPlural(selectedRoadKeys.size, "road")} + ${pickPlural(
          selectedBandKeys.size,
          "band chip"
        )} selected — click a class`
      : selectedRoadKeys.size > 0
        ? `${pickPlural(selectedRoadKeys.size, "road segment")} selected — click a class`
        : selectedBandKeys.size > 0
          ? `${pickPlural(selectedBandKeys.size, "band chip")} selected — click a class`
          : editorState.hasSelection
            ? selectedLabel
              ? `Selected: ${selectedLabel} — click a chip to reassign`
              : "Reassign zone"
            : "Draw zone, Shift+click a road or band";

  // Helper for the layers tree — delete one polygon layer and clear its
  // selection if it was the selected one.
  const removeOneFromTree = (layer) => {
    const group = groupRef.current;
    if (!group || !layer) return;
    if (selectedLayerRef.current === layer) {
      selectedLayerRef.current = null;
    }
    try {
      if (layer.pm?.enabled?.()) layer.pm.disable();
    } catch {}
    group.removeLayer(layer);
    pushHistory();
    refresh();
    syncEditorState();
  };

  // Sorted barangay slugs — alphabetical by display name, with the
  // "(no barangay)" bucket last so it doesn't drown the tree at the top.
  const treeBrgyOrder = Object.keys(polygonTree).sort((a, b) => {
    if (a === "_unassigned") return 1;
    if (b === "_unassigned") return -1;
    return (polygonTree[a]?.name || a).localeCompare(
      polygonTree[b]?.name || b
    );
  });

  return (
    <>
    <div ref={panelRefCallback} style={panelStyle}>
      {/* Draggable header — also doubles as the panel title. Click the
          chevron to collapse the body. */}
      <div
        onMouseDown={onPanelHeaderMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px 6px 10px",
          background: "#f1f5f9",
          borderBottom: panelCollapsed ? "none" : "1px solid #e2e8f0",
          cursor: dragStateRef.current ? "grabbing" : "move",
          userSelect: "none",
          fontWeight: 600,
          fontSize: 11,
          color: "#0f172a",
        }}
        title="Drag to move"
      >
        <span style={{ color: "#94a3b8", letterSpacing: "0.05em" }}>⋮⋮</span>
        <span
          style={{
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {headerTitle}
        </span>
        <button
          type="button"
          onClick={() => setPanelCollapsed((c) => !c)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            ...smallBtn,
            padding: "1px 6px",
            fontSize: 11,
            background: "white",
          }}
          title={panelCollapsed ? "Expand panel" : "Collapse panel"}
          aria-expanded={!panelCollapsed}
        >
          {panelCollapsed ? "▸" : "▾"}
        </button>
      </div>
      {!panelCollapsed && (
        <div style={{ padding: 10 }}>
      {selectedRoadKeys.size > 0 && (
        <button
          type="button"
          onClick={() => setSelectedRoadKeys(new Set())}
          style={{
            ...smallBtn,
            marginBottom: 6,
            fontSize: 11,
            color: "#475569",
          }}
          title="Deselect all road segments"
        >
          Clear road selection
        </button>
      )}
      {selectedBandKeys.size > 0 && (
        <button
          type="button"
          onClick={() => setSelectedBandKeys(new Set())}
          style={{
            ...smallBtn,
            marginBottom: 6,
            marginLeft: selectedRoadKeys.size > 0 ? 6 : 0,
            fontSize: 11,
            color: "#475569",
          }}
          title="Deselect all frontage-band chips"
        >
          Clear band selection
        </button>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {availableClassKeys.map((k) => {
          const info = CLASSIFICATION_INFO[k];
          const isActive = activeClass === k;
          // Visual reflection of the currently-selected polygon's class
          // ladder. Distinct from `isActive` (the next-draw class):
          //   - selectedAsPrimary   → solid ring + dot marker
          //   - selectedAsSecondary → dashed ring
          //   - selectedAsTertiary  → dotted ring
          // All three can co-exist on different chips when a zone has
          // overlapping classifications.
          const selectedAsPrimary =
            editorState.hasSelection && selectedPrimaryClass === k;
          const selectedAsSecondary =
            editorState.hasSelection && selectedSecondaryCurrent === k;
          const selectedAsTertiary =
            editorState.hasSelection && selectedTertiaryCurrent === k;
          const selectionRing = selectedAsPrimary
            ? `0 0 0 2px ${info.color}, 0 0 0 4px white`
            : selectedAsSecondary
              ? `0 0 0 2px ${info.color}88, 0 0 0 4px white`
              : selectedAsTertiary
                ? `0 0 0 1px ${info.color}66, 0 0 0 3px white`
                : "none";
          return (
            <button
              key={k}
              onClick={() => {
                setActiveClass(k);
                // Click-to-tag flow: if road segments are selected,
                // buffer them into a corridor zone tagged with this
                // class and clear the selection. Takes precedence
                // over the polygon-reassign branch below.
                if (bakeRoadsIntoCorridor(k)) return;
                // If a shape is currently selected, reassign its
                // classification on the spot — same chip click that picks
                // the next-draw class also retags the active selection.
                const selected = selectedLayerRef.current;
                if (selected) {
                  const existingSecondary = normaliseClassKey(
                    selected.feature?.properties?.secondary_classification
                  );
                  const existingTertiary = normaliseClassKey(
                    selected.feature?.properties?.tertiary_classification
                  );
                  selected.feature = selected.feature || {
                    type: "Feature",
                    properties: {},
                  };
                  const nextProps = {
                    ...(selected.feature.properties || {}),
                    classification: k,
                  };
                  // Avoid duplicate dual tags like primary=C-3 + secondary=C-3.
                  if (existingSecondary === k) {
                    delete nextProps.secondary_classification;
                    setSecondaryClass("");
                  }
                  if (existingTertiary === k) {
                    delete nextProps.tertiary_classification;
                    setTertiaryClass("");
                  }
                  selected.feature.properties = nextProps;
                  applyFeatureStyle(selected, k, true);
                  if (selected.bringToFront) selected.bringToFront();
                  pushHistory();
                  refresh();
                }
              }}
              style={{
                position: "relative",
                padding: "3px 7px",
                borderRadius: 4,
                border: `1px solid ${info.color}`,
                background: isActive ? info.color : "white",
                color: isActive ? "white" : info.color,
                cursor: "pointer",
                fontSize: 11,
                font: "inherit",
                boxShadow: selectionRing,
                fontWeight: selectedAsPrimary ? 700 : 400,
                // Give the chip a little breathing room so the ring doesn't
                // touch its neighbours when a selection exists.
                margin: selectionRing !== "none" ? 1 : 0,
              }}
              title={
                selectedAsPrimary
                  ? `Selected zone is ${info.label} (click another chip to reassign)`
                  : editorState.hasSelection
                    ? `Reassign selected zone to ${info.label}`
                    : `${info.label} — ${info.category}`
              }
            >
              {info.label === "Unclassified" ? "—" : info.label}
              {selectedAsPrimary && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: info.color,
                    border: "1px solid white",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#475569" }}>Corridor width:</span>
        <input
          type="number"
          min={1}
          max={500}
          step={5}
          value={bufferMeters}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n) && n > 0) setBufferMeters(n);
          }}
          style={{
            width: 64,
            padding: "2px 4px",
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            font: "inherit",
            fontSize: 11,
          }}
        />
        <span style={{ color: "#475569" }}>m each side</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "#475569" }}>Secondary class:</span>
        <select
          value={secondaryClass}
          onChange={(e) => setSecondaryClass(e.target.value)}
          style={{
            minWidth: 102,
            padding: "2px 4px",
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            font: "inherit",
            fontSize: 11,
            background: "white",
          }}
        >
          <option value="">None</option>
          {dualClassKeys.map((k) => (
            <option key={`secondary-${k}`} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          onClick={setSelectedSecondaryClass}
          disabled={!canApplySecondary}
          style={{
            ...smallBtn,
            ...actionButtonStyle(secondaryClassKey, canApplySecondary, secondaryApplied),
          }}
          title={
            !editorState.hasSelection
              ? "Select a zone first"
              : !secondaryClassKey
                ? "Pick a secondary class"
                : secondaryClassKey === selectedPrimaryClass
                  ? "Secondary class cannot be the same as primary"
                  : secondaryClassKey === selectedTertiaryCurrent
                    ? "Secondary class cannot be the same as tertiary"
                    : secondaryApplied
                      ? "Already applied"
                      : "Apply selected secondary class to the selected zone"
          }
        >
          {secondaryApplied ? "Secondary ✓" : "Apply secondary"}
        </button>
        <button
          onClick={clearSelectedSecondaryClass}
          disabled={!editorState.hasSelection || !selectedSecondaryCurrent}
          style={{
            ...smallBtn,
            ...(selectedSecondaryCurrent
              ? { color: "#b91c1c", borderColor: "#fecaca", background: "#fff1f2" }
              : null),
          }}
          title={
            selectedSecondaryCurrent
              ? "Clear secondary class on selected zone"
              : "No secondary class to clear"
          }
        >
          Clear secondary
        </button>
        {editorState.hasSelection && (
          <span style={{ color: "#64748b", fontSize: 10 }}>
            Current: {selectedSecondaryCurrent ?? "None"}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "#475569" }}>Tertiary class:</span>
        <select
          value={tertiaryClass}
          onChange={(e) => setTertiaryClass(e.target.value)}
          style={{
            minWidth: 102,
            padding: "2px 4px",
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            font: "inherit",
            fontSize: 11,
            background: "white",
          }}
        >
          <option value="">None</option>
          {dualClassKeys.map((k) => (
            <option key={`tertiary-${k}`} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          onClick={setSelectedTertiaryClass}
          disabled={!canApplyTertiary}
          style={{
            ...smallBtn,
            ...actionButtonStyle(tertiaryClassKey, canApplyTertiary, tertiaryApplied),
          }}
          title={
            !editorState.hasSelection
              ? "Select a zone first"
              : !tertiaryClassKey
                ? "Pick a tertiary class"
                : tertiaryClassKey === selectedPrimaryClass
                  ? "Tertiary class cannot be the same as primary"
                  : tertiaryClassKey === selectedSecondaryCurrent
                    ? "Tertiary class cannot be the same as secondary"
                    : tertiaryApplied
                      ? "Already applied"
                      : "Apply selected tertiary class to the selected zone"
          }
        >
          {tertiaryApplied ? "Tertiary ✓" : "Apply tertiary"}
        </button>
        <button
          onClick={clearSelectedTertiaryClass}
          disabled={!editorState.hasSelection || !selectedTertiaryCurrent}
          style={{
            ...smallBtn,
            ...(selectedTertiaryCurrent
              ? { color: "#b91c1c", borderColor: "#fecaca", background: "#fff1f2" }
              : null),
          }}
          title={
            selectedTertiaryCurrent
              ? "Clear tertiary class on selected zone"
              : "No tertiary class to clear"
          }
        >
          Clear tertiary
        </button>
        {editorState.hasSelection && (
          <span style={{ color: "#64748b", fontSize: 10 }}>
            Current: {selectedTertiaryCurrent ?? "None"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={undo}
          disabled={!editorState.canUndo}
          style={smallBtn}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={!editorState.canRedo}
          style={smallBtn}
          title="Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)"
        >
          Redo
        </button>
        <button
          onClick={deleteSelected}
          disabled={!editorState.hasSelection}
          style={{ ...smallBtn, color: "#b91c1c" }}
          title="Delete selected zone (Delete/Backspace)"
        >
          Delete selected
        </button>
        {selectedIsExplodable && (
          <button
            onClick={explodeSelectedMultiPolygon}
            style={{ ...smallBtn, color: "#1d4ed8", fontWeight: 600 }}
            title="The selected zone is a MultiPolygon with several disconnected parts. Split it into separate polygons so each piece can be deleted, edited, or reclassified independently. The new pieces inherit this zone's class (primary + secondary + tertiary)."
          >
            Split parts
          </button>
        )}
        {editorState.hasSelection && (
          <button
            onClick={cleanSelectedGeometry}
            style={{ ...smallBtn, color: "#7c3aed", fontWeight: 600 }}
            title="Repair the selected polygon: removes duplicate vertices, splits self-intersecting outer rings (the typical cause of stray spike artifacts inside a hole), and drops sliver parts smaller than 50 m². Class properties are preserved."
          >
            Clean geometry
          </button>
        )}
        <button
          onClick={() => {
            setPlacingLandmark((on) => !on);
            // Cancel any in-flight pending landmark when toggling.
            setPendingLandmark(null);
          }}
          style={{
            ...smallBtn,
            background: placingLandmark ? "#fef3c7" : "white",
            borderColor: placingLandmark ? "#d97706" : "#cbd5e1",
            color: placingLandmark ? "#92400e" : "#7c3aed",
            fontWeight: placingLandmark ? 700 : 600,
          }}
          title={
            placingLandmark
              ? "Click the map to drop a pin (Esc to cancel)"
              : activeStretchKey
                ? `Add a custom landmark. The new pin will be auto-linked to the active stretch (${activeStretchKey}) so it lights up when that stretch is selected.`
                : "Add a custom landmark. Click this, then click the map to drop a pin and name it."
          }
        >
          {placingLandmark ? "Click map to pin…" : "+ Landmark"}
        </button>
        <button
          onClick={() => {
            setMovingLandmark((on) => !on);
            // Can't be in placing mode and moving mode simultaneously —
            // they'd fight over the next map click. Drop any pending
            // form too so the user has a clean slate.
            setPlacingLandmark(false);
            setPendingLandmark(null);
          }}
          style={{
            ...smallBtn,
            background: movingLandmark ? "#fef3c7" : "white",
            borderColor: movingLandmark ? "#d97706" : "#cbd5e1",
            color: movingLandmark ? "#92400e" : "#7c3aed",
            fontWeight: movingLandmark ? 700 : 600,
          }}
          title={
            movingLandmark
              ? "Drag any pin to reposition it. Click this button again (or press Esc) to exit move mode."
              : "Turn every in-app landmark pin into a drag-handle. Drag a pin to a new spot — the position is saved automatically."
          }
        >
          {movingLandmark ? "Drop pin where you want…" : "Move pin"}
        </button>
        <button
          onClick={() => setMultiVertexMode((m) => !m)}
          disabled={!editorState.hasSelection}
          style={{
            ...smallBtn,
            background: multiVertexMode ? "#dbeafe" : "white",
            borderColor: multiVertexMode ? "#1d4ed8" : "#cbd5e1",
            color: multiVertexMode ? "#1d4ed8" : "inherit",
            fontWeight: multiVertexMode ? 600 : 400,
          }}
          title={
            multiVertexMode
              ? "Switch back to Geoman's single-vertex editing"
              : "Click to enable multi-vertex selection: Shift+click to add vertices, drag any selected to move all, Delete to remove"
          }
        >
          {multiVertexMode ? "Vertices: multi ✓" : "Vertices: multi"}
        </button>
        {multiVertexMode && selectedVertexKeys.size > 0 && (
          <button
            onClick={() => removeVerticesByKey(selectedVertexKeysRef.current)}
            style={{ ...smallBtn, color: "#b91c1c", fontWeight: 600 }}
            title="Remove the selected vertices from this polygon (Delete key)"
          >
            Delete {selectedVertexKeys.size} vert
            {selectedVertexKeys.size === 1 ? "ex" : "ices"}
          </button>
        )}
        <label
          style={{
            ...smallBtn,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            background: trimAgainstExisting ? "white" : "#fef3c7",
            borderColor: trimAgainstExisting ? "#cbd5e1" : "#d97706",
            color: trimAgainstExisting ? "inherit" : "#92400e",
          }}
          title={
            trimAgainstExisting
              ? "When ON, baking a road / band only fills areas that aren't already classified. Untick to paint over existing zones (full corridor on both sides)."
              : "Trimming is OFF — bakes will paint over existing zones. Tick to re-enable trimming."
          }
        >
          <input
            type="checkbox"
            checked={trimAgainstExisting}
            onChange={(e) => setTrimAgainstExisting(e.target.checked)}
            style={{ margin: 0 }}
          />
          Trim against existing
        </label>
        <button
          onClick={() => setLayerPanelOpen((o) => !o)}
          style={{
            ...smallBtn,
            background: layerPanelOpen ? "#dbeafe" : "white",
            borderColor: layerPanelOpen ? "#1d4ed8" : "#cbd5e1",
            color: layerPanelOpen ? "#1d4ed8" : "inherit",
            fontWeight: layerPanelOpen ? 600 : 400,
          }}
          title="Photoshop-style layers tree, grouped by barangay → SMV class. Click a row to select on the map; × removes the polygon."
        >
          {layerPanelOpen ? "Layers tree ✓" : "Layers tree"}
        </button>
        <button
          onClick={saveToProject}
          disabled={saveStatus === "saving"}
          style={{
            ...smallBtn,
            background:
              saveStatus === "saved"
                ? "#dcfce7"
                : saveStatus === "error"
                  ? "#fee2e2"
                  : "#dbeafe",
            borderColor:
              saveStatus === "saved"
                ? "#16a34a"
                : saveStatus === "error"
                  ? "#dc2626"
                  : "#1d4ed8",
            color:
              saveStatus === "saved"
                ? "#166534"
                : saveStatus === "error"
                  ? "#991b1b"
                  : "#1d4ed8",
            fontWeight: 600,
          }}
          title={`Write the current zones to ${savePathLabel} (dev only)`}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved ✓"
              : saveStatus === "error"
                ? "Save failed"
                : "Save to project"}
        </button>
        <button onClick={exportGeoJSON} style={smallBtn}>
          Export GeoJSON
        </button>
        <label style={{ ...smallBtn, cursor: "pointer" }}>
          Import…
          <input
            type="file"
            accept="application/geo+json,application/json,.geojson,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importGeoJSON(f);
              e.target.value = "";
            }}
          />
        </label>
        <label
          style={{
            ...smallBtn,
            cursor: dxfStatus === "uploading" ? "wait" : "pointer",
            background:
              dxfStatus === "done"
                ? "#dcfce7"
                : dxfStatus === "error"
                  ? "#fee2e2"
                  : dxfStatus === "uploading"
                    ? "#fef3c7"
                    : "white",
            borderColor:
              dxfStatus === "done"
                ? "#16a34a"
                : dxfStatus === "error"
                  ? "#dc2626"
                  : dxfStatus === "uploading"
                    ? "#d97706"
                    : "#cbd5e1",
            color:
              dxfStatus === "done"
                ? "#166534"
                : dxfStatus === "error"
                  ? "#991b1b"
                  : dxfStatus === "uploading"
                    ? "#92400e"
                    : "inherit",
            opacity: dxfStatus === "uploading" ? 0.85 : 1,
          }}
          title={`Upload an AutoCAD .dxf — the LGU's working zones file — and replace ${savePathLabel} with the converted polygons. Local dev only.`}
        >
          {dxfStatus === "uploading"
            ? "Importing DXF…"
            : dxfStatus === "done"
              ? "DXF imported ✓"
              : dxfStatus === "error"
                ? "DXF failed"
                : "Import DXF…"}
          <input
            type="file"
            accept=".dxf,application/dxf,image/vnd.dxf"
            style={{ display: "none" }}
            disabled={dxfStatus === "uploading"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importDxfToProject(f);
              e.target.value = "";
            }}
          />
        </label>
        <button onClick={clearAll} style={{ ...smallBtn, color: "#b91c1c" }}>
          Clear
        </button>
      </div>
      <div style={{ marginTop: 6, color: "#666", fontSize: 11, lineHeight: 1.4 }}>
        Pick a class, then use the toolbar (top-left). The{" "}
        <b>polyline tool</b> traces a road and auto-buffers it; the{" "}
        <b>polygon / rectangle tools</b> draw freeform zones.{" "}
        <b>Shift+click a road</b> to select road segments for class tagging.{" "}
        <b>Click a zone to select it</b> — clicking a class chip while
        something is selected reassigns it. Optional{" "}
        <b>Secondary / Tertiary class</b> lets one zone illustrate overlap
        (for example C-3 + R-3 + R-4). Saves to localStorage automatically.
      </div>
        </div>
      )}
    </div>

    {/* Pending custom-landmark form — extracted to its own component
        for cleanliness. Header + scrollable body + sticky footer so
        the Cancel / Add buttons stay reachable no matter how many
        stretch chips the user attaches. */}
    <LandmarkAddForm
      pending={pendingLandmark}
      setPending={setPendingLandmark}
      stretchCatalog={stretchCatalog}
      onCommit={commitLandmark}
      onCancel={() => setPendingLandmark(null)}
    />

    {/* ---- Polygon layers tree (Photoshop-style) ----
        Floating panel on the right side, toggleable via the "Layers tree"
        button in the editor toolbar. Two-level grouping: barangay → SMV
        class → polygon. Click a polygon row to select on the map; × to
        delete that polygon. */}
    {layerPanelOpen && (
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 1000,
          width: 260,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "white",
          borderRadius: 8,
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          fontSize: 12,
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "6px 8px",
            background: "#f1f5f9",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            fontSize: 11,
            color: "#0f172a",
          }}
        >
          <span style={{ flex: 1 }}>Polygon layers</span>
          <button
            type="button"
            onClick={() => setLayerPanelOpen(false)}
            style={{
              ...smallBtn,
              padding: "1px 6px",
              fontSize: 11,
              background: "white",
            }}
            title="Close panel"
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: 4 }}>
          {treeBrgyOrder.length === 0 ? (
            <div style={{ padding: 12, color: "#94a3b8" }}>
              No zone polygons yet. Draw or import some to see them here.
            </div>
          ) : (
            treeBrgyOrder.map((brgySlug) => {
              const brgy = polygonTree[brgySlug];
              const brgyKey = `brgy:${brgySlug}`;
              const brgyOpen = expandedTreeKeys.has(brgyKey);
              // Unique polygon count — polygons that appear in multiple
              // class buckets (primary + secondary + tertiary) only get
              // counted once here. The per-class (N) counts further down
              // do include each tier listing.
              const seenLayers = new Set();
              for (const entries of Object.values(brgy.classes)) {
                for (const entry of entries) seenLayers.add(entry.layer);
              }
              const brgyTotal = seenLayers.size;
              return (
                <div key={brgySlug} style={{ marginBottom: 2 }}>
                  <div
                    onClick={() => toggleTreeKey(brgyKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 6px",
                      cursor: "pointer",
                      background: brgyOpen ? "#eff6ff" : "transparent",
                      borderRadius: 4,
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    <span style={{ width: 12, color: "#64748b" }}>
                      {brgyOpen ? "▾" : "▸"}
                    </span>
                    <span style={{ flex: 1 }}>{brgy.name}</span>
                    <span style={{ color: "#64748b", fontWeight: 400 }}>
                      ({brgyTotal})
                    </span>
                  </div>
                  {brgyOpen && (
                    <div style={{ paddingLeft: 14 }}>
                      {Object.keys(brgy.classes)
                        .sort()
                        .map((klass) => {
                          const layers = brgy.classes[klass];
                          const info =
                            CLASSIFICATION_INFO[klass] ||
                            CLASSIFICATION_INFO.UNCLASSIFIED;
                          const classKey = `class:${brgySlug}|${klass}`;
                          const classOpen = expandedTreeKeys.has(classKey);
                          return (
                            <div key={klass} style={{ marginBottom: 2 }}>
                              <div
                                onClick={() => toggleTreeKey(classKey)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 6px",
                                  cursor: "pointer",
                                  borderRadius: 4,
                                  color: "#0f172a",
                                }}
                              >
                                <span style={{ width: 12, color: "#64748b" }}>
                                  {classOpen ? "▾" : "▸"}
                                </span>
                                <span
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 2,
                                    background: info.color,
                                    border: "1px solid rgba(0,0,0,0.2)",
                                  }}
                                />
                                <span
                                  style={{
                                    flex: 1,
                                    fontWeight: 500,
                                    color: info.color,
                                  }}
                                >
                                  {info.label}
                                </span>
                                <span
                                  style={{ color: "#64748b", fontWeight: 400 }}
                                >
                                  ({layers.length})
                                </span>
                              </div>
                              {classOpen && (
                                <div style={{ paddingLeft: 22 }}>
                                  {layers.map((entry, idx) => {
                                    const layer = entry.layer;
                                    const tier = entry.tier; // "primary" | "secondary" | "tertiary"
                                    const isSel =
                                      selectedLayerRef.current === layer;
                                    const tierBadge =
                                      tier === "secondary"
                                        ? "2°"
                                        : tier === "tertiary"
                                          ? "3°"
                                          : null;
                                    return (
                                      <div
                                        key={`${idx}-${tier}`}
                                        onClick={() => selectLayer(layer)}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 4,
                                          padding: "2px 6px",
                                          cursor: "pointer",
                                          borderRadius: 3,
                                          background: isSel
                                            ? `${info.color}22`
                                            : "transparent",
                                          fontWeight: isSel ? 600 : 400,
                                          color: isSel ? info.color : "#475569",
                                          opacity: tier === "primary" ? 1 : 0.85,
                                          fontStyle:
                                            tier === "primary" ? "normal" : "italic",
                                        }}
                                        title={
                                          tier === "primary"
                                            ? `Primary class ${info.label}`
                                            : tier === "secondary"
                                              ? `Listed under ${info.label} as secondary overlay (primary is different)`
                                              : `Listed under ${info.label} as tertiary overlay (primary + secondary are different)`
                                        }
                                      >
                                        <span style={{ flex: 1 }}>
                                          {info.label} #{idx + 1}
                                          {tierBadge && (
                                            <span
                                              style={{
                                                marginLeft: 5,
                                                padding: "0 4px",
                                                fontSize: 10,
                                                fontStyle: "normal",
                                                fontWeight: 600,
                                                background: info.color,
                                                color: "white",
                                                borderRadius: 3,
                                                verticalAlign: "middle",
                                              }}
                                            >
                                              {tierBadge}
                                            </span>
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // Removing from any listing
                                            // removes the underlying single
                                            // polygon — all its tier
                                            // appearances disappear together.
                                            removeOneFromTree(layer);
                                          }}
                                          style={{
                                            padding: "0 5px",
                                            borderRadius: 3,
                                            border: "1px solid transparent",
                                            background: "transparent",
                                            color: "#b91c1c",
                                            cursor: "pointer",
                                            fontSize: 13,
                                            lineHeight: 1,
                                          }}
                                          title="Delete this polygon (removes all its tier listings)"
                                          aria-label="Delete"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    )}
    </>
  );
}

const smallBtn = {
  padding: "3px 7px",
  borderRadius: 4,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#cbd5e1",
  background: "white",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  lineHeight: "inherit",
  fontWeight: "inherit",
};

function actionButtonStyle(classKey, enabled, applied) {
  if (!classKey || !enabled) return {};
  const info = CLASSIFICATION_INFO[classKey];
  if (!info) return {};
  if (applied) {
    return {
      borderColor: info.color,
      background: info.color,
      color: "white",
      fontWeight: 700,
    };
  }
  return {
    borderColor: info.color,
    background: `${info.color}18`,
    color: info.color,
    fontWeight: 700,
  };
}

function loadGeoJSONIntoGroup(fc, group, prepareLayer) {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    return;
  }
  L.geoJSON(fc, {
    onEachFeature: (ft, layer) => {
      applyFeatureStyle(layer, ft.properties?.classification);
      // Attach the click-to-select handler so loaded zones (e.g. the
      // bundled C-1 polygon) are editable, draggable, and deletable in
      // edit mode — without this, only freshly-drawn shapes were live.
      if (typeof prepareLayer === "function") {
        prepareLayer(layer);
      }
      group.addLayer(layer);
    },
  });
}

function applyFeatureStyle(layer, classification, selected = false) {
  const s = styleForClass(classification);
  const isC1 = classification === "C-1";
  if (!layer.setStyle) return;
  // Default: no border. When selected, a thick ring in the *class color*
  // appears — that way reassigning a shape from one class to another
  // visibly updates both stroke and fill, not just fill underneath a
  // generic blue ring.
  layer.setStyle({
    ...s,
    stroke: selected,
    weight: selected ? 4 : 0,
    color: s.color,
    opacity: selected ? 1 : 0,
    dashArray: undefined,
    fillColor: isC1 ? C1_HATCH_FILL : s.fillColor,
    fillOpacity: isC1 ? 1 : selected ? 0.75 : 0.55,
  });
}

function normaliseClassKey(value) {
  const key = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!key) return null;
  return CLASSIFICATION_INFO[key] ? key : null;
}
