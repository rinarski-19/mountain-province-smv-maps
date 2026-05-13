"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import { CLASSIFICATION_INFO, styleForClass } from "@/lib/classifications";

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

// Standard depth from the 2027 schedule: 30 m on each side of the road.
const DEFAULT_BUFFER_METERS = 30;

// Half-width of the carriageway that gets *cut out* of the corridor
// so the corridor renders as two parallel ribbons on either side of
// the road, not as one fat strip burying the road. Roughly the
// half-width of a 2-lane mountain road. Make it 0 to disable the
// cut-out (corridor returns to the old "fat strip" look).
const ROAD_INSET_METERS = 4;

// Buffer a line (or multilinestring) into a corridor with the road
// itself cut out — two ribbons on each side, ROAD_INSET_METERS in
// from the centerline. Falls back to the plain symmetric buffer if
// outerHalfWidthM is too small for a meaningful inset, or if the
// difference operation throws (rare, but turf's polygon-clipping can
// trip on near-tangent geometry).
function bufferAlongsideRoad(geom, outerHalfWidthM) {
  let outer;
  try {
    outer = turf.buffer(geom, outerHalfWidthM, { units: "meters" });
  } catch (e) {
    console.warn("bufferAlongsideRoad: outer buffer failed", e);
    return null;
  }
  if (!outer?.geometry) return null;
  if (ROAD_INSET_METERS <= 0 || outerHalfWidthM <= ROAD_INSET_METERS + 1) {
    return outer;
  }
  let inner;
  try {
    inner = turf.buffer(geom, ROAD_INSET_METERS, { units: "meters" });
  } catch {
    return outer;
  }
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
  classKeys = null,
}) {
  const map = useMap();
  const groupRef = useRef(null);
  const selectedLayerRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const isRestoringRef = useRef(false);
  const [, force] = useState(0);
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
      try {
        if (layer.pm && !layer.pm.enabled?.()) {
          layer.pm.enable({
            allowSelfIntersection: false,
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
          onEachFeature: (feature, leafletLayer) => {
            const key = roadFeatureKey(feature);
            byKey.set(key, { feature, leafletLayer });
            leafletLayer.on("click", (ev) => {
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

  // Convert the currently-selected road segments into a corridor zone
  // tagged with `klass`. Used by the class chip onClick when the user
  // has roads selected. Returns true if it added a zone (so the chip
  // handler knows to short-circuit out of its other branches).
  const bakeRoadsIntoCorridor = (klass) => {
    const group = groupRef.current;
    const byKey = roadsByKeyRef.current;
    if (!group || !byKey || selectedRoadKeysRef.current.size === 0) return false;

    const coordsList = [];
    for (const key of selectedRoadKeysRef.current) {
      const entry = byKey.get(key);
      const geom = entry?.feature?.geometry;
      if (geom?.type === "LineString") {
        coordsList.push(geom.coordinates);
      } else if (geom?.type === "MultiLineString") {
        for (const line of geom.coordinates) coordsList.push(line);
      }
    }
    if (!coordsList.length) return false;

    let buffered;
    try {
      const mls = turf.multiLineString(coordsList);
      buffered = bufferAlongsideRoad(mls, bufferMetersRef.current);
    } catch (e) {
      console.warn("bakeRoadsIntoCorridor: buffer failed", e);
      return false;
    }
    if (!buffered?.geometry) return false;

    const props = {
      classification: klass,
      source: "road-tag",
      buffer_m: bufferMetersRef.current,
      road_keys: [...selectedRoadKeysRef.current],
    };
    const wrap = L.geoJSON(
      { type: "Feature", properties: props, geometry: buffered.geometry },
      { style: () => ({}) }
    );
    wrap.eachLayer((sub) => {
      sub.feature = sub.feature || { type: "Feature", properties: {} };
      sub.feature.properties = { ...sub.feature.properties, ...props };
      applyFeatureStyle(sub, klass);
      prepareLayer(sub);
      group.addLayer(sub);
    });

    setSelectedRoadKeys(new Set());
    pushHistory();
    refresh();
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
      allowSelfIntersection: false,
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
    map.on("pm:globalcutmodetoggled", (e) => {
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
        group.eachLayer((layer) => {
          if (layer !== selected) {
            layer.options = layer.options || {};
            layer.options.pmIgnore = true;
          }
        });
        try {
          map.pm.setGlobalOptions({
            layerGroup: L.featureGroup([selected]),
          });
        } catch {}
      } else {
        group.eachLayer((layer) => {
          if (layer.options && "pmIgnore" in layer.options) {
            delete layer.options.pmIgnore;
          }
        });
        try {
          map.pm.setGlobalOptions({ layerGroup: group });
        } catch {}
      }
    });

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
    const onMapClick = () => selectLayer(null);
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

      if (wantsUndo) {
        e.preventDefault();
        undo();
      } else if (wantsRedo) {
        e.preventDefault();
        redo();
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
      group.off("pm:edit", onEdit);
      document.removeEventListener("keydown", onKeyDown);
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
  const headerTitle =
    selectedRoadKeys.size > 0
      ? `${selectedRoadKeys.size} road segment${
          selectedRoadKeys.size === 1 ? "" : "s"
        } selected — click a class`
      : editorState.hasSelection
        ? "Reassign zone"
        : "Draw zone, or click a road";

  return (
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {availableClassKeys.map((k) => {
          const info = CLASSIFICATION_INFO[k];
          const isActive = activeClass === k;
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
                padding: "3px 7px",
                borderRadius: 4,
                border: `1px solid ${info.color}`,
                background: isActive ? info.color : "white",
                color: isActive ? "white" : info.color,
                cursor: "pointer",
                fontSize: 11,
                font: "inherit",
              }}
              title={
                editorState.hasSelection
                  ? `Reassign selected zone to ${info.label}`
                  : `${info.label} — ${info.category}`
              }
            >
              {info.label === "Unclassified" ? "—" : info.label}
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
        <button onClick={clearAll} style={{ ...smallBtn, color: "#b91c1c" }}>
          Clear
        </button>
      </div>
      <div style={{ marginTop: 6, color: "#666", fontSize: 11, lineHeight: 1.4 }}>
        Pick a class, then use the toolbar (top-left). The{" "}
        <b>polyline tool</b> traces a road and auto-buffers it; the{" "}
        <b>polygon / rectangle tools</b> draw freeform zones.{" "}
        <b>Click a zone to select it</b> — clicking a class chip while
        something is selected reassigns it. Optional{" "}
        <b>Secondary / Tertiary class</b> lets one zone illustrate overlap
        (for example C-3 + R-3 + R-4). Saves to localStorage automatically.
      </div>
        </div>
      )}
    </div>
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
