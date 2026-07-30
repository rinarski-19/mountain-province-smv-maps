"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
// Side-effect import: must run before any L.Map is constructed so Geoman's
// initHook registers on the prototype.
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import {
  CLASSIFICATION_INFO,
  classForFeature,
  commercialHatchColorForClass,
  isCommercialClass,
  isResidentialClass,
  smvFillStyle,
  styleForClass,
} from "@/lib/classifications";
import {
  landmarkIconMarkup,
  normalizeLandmarkKind,
} from "@/lib/landmark-icons";
import {
  isInsideLandmarkLabel,
  normalizeLandmarkLabelPlacement,
  normalizeLandmarkLabelSize,
} from "@/lib/landmark-labels";
import EditableZones from "./EditableZones";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const DEFAULT_CENTER = [16.94, 120.88];
const DEFAULT_ZOOM = 12;

function featureBboxObject(feature) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === "number") {
      west = Math.min(west, coords[0]);
      east = Math.max(east, coords[0]);
      south = Math.min(south, coords[1]);
      north = Math.max(north, coords[1]);
      return;
    }
    for (const child of coords) visit(child);
  };
  visit(feature?.geometry?.coordinates);
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

function exteriorRings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => polygon?.[0])
      .filter(Boolean);
  }
  return [];
}

function buildOutsideMaskFeature(feature) {
  const bbox = featureBboxObject(feature);
  const holes = exteriorRings(feature);
  if (!bbox || holes.length === 0) return null;
  const padLng = Math.max(0.25, (bbox.east - bbox.west) * 2);
  const padLat = Math.max(0.25, (bbox.north - bbox.south) * 2);
  const west = bbox.west - padLng;
  const east = bbox.east + padLng;
  const south = bbox.south - padLat;
  const north = bbox.north + padLat;
  return {
    type: "Feature",
    properties: { purpose: "print-outside-mask" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
        ...holes,
      ],
    },
  };
}

function isParcelZoneFeature(feature) {
  const props = feature?.properties ?? {};
  return (
    props.source === "dxf" ||
    props.parcel_id != null ||
    props.lot_number != null ||
    props.lot_no != null
  );
}

function zoneLabelCandidatePoint(feature) {
  const candidates = [];
  const add = (point) => {
    if (!point?.geometry || point.geometry.type !== "Point") return;
    const key = point.geometry.coordinates
      .map((value) => Number(value).toFixed(8))
      .join(",");
    if (!candidates.some((candidate) => candidate.key === key)) {
      candidates.push({ key, point });
    }
  };
  try {
    add(turf.pointOnFeature(feature));
  } catch {}
  try {
    add(turf.centerOfMass(feature));
  } catch {}
  try {
    const [west, south, east, north] = turf.bbox(feature);
    for (const yRatio of [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86]) {
      for (const xRatio of [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86]) {
        add(
          turf.point([
            west + (east - west) * xRatio,
            south + (north - south) * yRatio,
          ])
        );
      }
    }
  } catch {}

  let boundary = null;
  try {
    boundary = turf.polygonToLine(feature);
  } catch {}
  const ranked = candidates
    .map(({ point }, index) => {
      let inside = false;
      try {
        inside = turf.booleanPointInPolygon(point, feature, {
          ignoreBoundary: true,
        });
      } catch {}
      let clearance = 0;
      if (inside && boundary) {
        try {
          clearance = turf.pointToLineDistance(point, boundary, {
            units: "meters",
          });
        } catch {}
      }
      return { point, index, inside, clearance };
    })
    .sort((a, b) => {
      if (a.inside !== b.inside) return a.inside ? -1 : 1;
      if (b.clearance !== a.clearance) return b.clearance - a.clearance;
      return a.index - b.index;
    });
  return ranked.find((candidate) => candidate.inside)?.point ?? ranked[0]?.point ?? null;
}

function zoneClassLabelMarker(feature, latlng) {
  const label = feature?.properties?.label ?? "";
  const classKey = String(feature?.properties?.classKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "smv-zone-class-label-anchor",
      html: `<span class="smv-zone-class-label smv-zone-class-label--${escapeHtml(classKey)}">${escapeHtml(label)}</span>`,
      iconSize: [1, 1],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    keyboard: false,
  });
}

const BARANGAY_STROKE = {
  color: "#1f2937",
  weight: 1.8,
  opacity: 0.95,
  fillOpacity: 0,
};
const BARANGAY_STROKE_HOVER = {
  color: "#1d4ed8",
  weight: 3,
  opacity: 1,
  fillOpacity: 0,
};
const HYBRID_BARANGAY_HALO = {
  color: "#f8fafc",
  weight: 4.5,
  opacity: 0.9,
  fillOpacity: 0,
};
const HYBRID_BARANGAY_STROKE = {
  color: "#2563eb",
  weight: 2.2,
  opacity: 1,
  fillOpacity: 0,
};
const MUNICIPALITY_STROKE = {
  color: "#000000",
  weight: 4,
  opacity: 1,
  fillOpacity: 0,
};
const HYBRID_MUNICIPALITY_HALO = {
  color: "#f8fafc",
  weight: 7,
  opacity: 0.95,
  fillOpacity: 0,
};
const HYBRID_MUNICIPALITY_STROKE = {
  color: "#f59e0b",
  weight: 3.5,
  opacity: 1,
  fillOpacity: 0,
};
const OFFLINE_MAPBOX_TILE_REV = "2026-05-16-hidpi";
const OFFLINE_MAPBOX_TILE_ROOT = "/tiles-mapbox-hidpi";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const GOOGLE_NATIVE_MAX_ZOOM = 22;
const GOOGLE_DISPLAY_MAX_ZOOM = 24;
const BUILDING_FOOTPRINT_MIN_ZOOM = 16;

// Basemap providers. The "settings" menu in TopNav lets the user
// switch between the public-safe options. Online OSM is the default;
// Google Streets and Hybrid use the official Google Maps Platform Map Tiles API;
// Mapbox Satellite Streets remains the legal non-Google fallback.
const TILE_SOURCES = {
  online: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
  ...(MAPBOX_TOKEN
    ? {
        mapbox_hybrid: {
          url:
            "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=" +
            encodeURIComponent(MAPBOX_TOKEN),
          attribution:
            '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxNativeZoom: 20,
          maxZoom: 20,
        },
      }
    : {}),
  ...(GOOGLE_MAPS_API_KEY
      ? {
        google_street: {
          provider: "google",
          attribution: "&copy; Google",
          maxNativeZoom: GOOGLE_NATIVE_MAX_ZOOM,
          maxZoom: GOOGLE_DISPLAY_MAX_ZOOM,
        },
        google_hybrid: {
          provider: "google",
          attribution: "&copy; Google",
          maxNativeZoom: GOOGLE_NATIVE_MAX_ZOOM,
          maxZoom: GOOGLE_DISPLAY_MAX_ZOOM,
        },
      }
    : {}),
  offline: {
    url: "/tiles/{z}/{x}/{y}.png",
    attribution:
      '&copy; OSM data — locally cached. Run <code>npm run tiles:bauko</code> to populate.',
    maxNativeZoom: 16,
    maxZoom: 18,
  },
  offline_mapbox: {
    url: `${OFFLINE_MAPBOX_TILE_ROOT}/{z}/{x}/{y}.png?v=${OFFLINE_MAPBOX_TILE_REV}`,
    attribution:
      '&copy; Mapbox &copy; OpenStreetMap &mdash; locally cached hybrid tiles.',
    maxNativeZoom: 18,
    maxZoom: 20,
  },
  // Sentinel entry: the TileLayer is suppressed entirely when this
  // mode is selected. Vector OSM layers (osmWater / osmBuildings /
  // osmRoads / osmPlaces) render instead, styled to match the print
  // SVG so editing is WYSIWYG with the printed output.
  vector_basemap: {
    url: "",
    attribution:
      "&copy; OpenStreetMap contributors &mdash; rendered as vectors (no raster tiles).",
    maxZoom: 20,
  },
};

// Transparent labels-only tile overlay rendered above the SMV stack
// but below the curated POI pane (see <Pane> + <TileLayer> below).
// Carries OSM place names, road names, and prominent POIs on a
// transparent background — keeps the OSM look on top of SMV fills
// without re-rendering tiles or applying a blend mode (which mudied
// the colors when we tried it).
const LABELS_OVERLAY_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png";
const LABELS_OVERLAY_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const EMPTY_FC = { type: "FeatureCollection", features: [] };
const ACTIVE_SMV_OPACITY = 0.7;
const GOOGLE_CONTEXT_OPACITY = 1;
const GOOGLE_CONTEXT_PASSES = 3;
const CUSTOM_LANDMARK_LABEL_MIN_ZOOM = 15;
const SMV_CLASS_LABEL_MIN_ZOOM = 16;
const freshJson = (url) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) {
      const error = new Error(`HTTP ${r.status}`);
      error.status = r.status;
      throw error;
    }
    return r.json();
  });

export default function LeafletMap({
  drawMode,
  printMode = false,
  tileMode,
  activeClass,
  activeBarangaySlug,
  savedBarangayViews,
  activeStretchView = null,
  activeStretchKey = null,
  stretchCatalog = [],
  focusRequestId = 0,
  layers,
  onDataChange,
  onMapReady,
  municipality,
}) {
  const editableZonesSaveRef = useRef(null);
  const [tilesAvailable, setTilesAvailable] = useState(true);
  const [mapZoom, setMapZoom] = useState(null);
  const [googleTileSession, setGoogleTileSession] = useState(null);
  const [googleOverlayTileSession, setGoogleOverlayTileSession] = useState(null);
  const [googleTileError, setGoogleTileError] = useState(null);
  const [data, setData] = useState({
    bauko: null,
    barangays: null,
    zones: null,
    parcels: null,
    valuations: null,
    monamonSurRoads: null,
    monamonNorteRoads: null,
    frontageBands: null,
    landmarks: null,
    customLandmarks: null,
    // Public-viewer OSM road overlay, rendered as solid white lines
    // on top of SMV zones when an imagery basemap is active. Keeps the road network
    // visible without leaving the SMV zone fills looking opaque over
    // roads. Loaded from the same osmRoads file the editor uses.
    osmRoads: null,
    // Print/vector reference layers. Built by the fetch-* scripts and
    // clipped to the municipal outline. Buildings prefer
    // <slug>_overture_buildings.geojson when present, then fall back to
    // <slug>_osm_buildings.geojson. When printMode is
    // on, the raster TileLayer is hidden and these render in its
    // place — pure SVG, sharp at any paper size. Files follow the
    // convention /data/<slug>_osm_<layer>.geojson and silently fall
    // back to EMPTY_FC when missing so the rest of the map still
    // renders for LGUs that haven't been processed yet.
    osmWater: null,
    osmPlaces: null,
    osmBuildings: null,
    osmBuildingsSlug: null,
  });
  const isVectorBasemapMode = tileMode === "vector_basemap";
  const shouldLoadBuildingFootprints =
    Boolean(layers?.buildings) &&
    (printMode ||
      isVectorBasemapMode ||
      (Number.isFinite(mapZoom) && mapZoom >= BUILDING_FOOTPRINT_MIN_ZOOM));

  useEffect(() => {
    const isGoogleMode =
      tileMode === "google_street" || tileMode === "google_hybrid";
    if (!isGoogleMode || !GOOGLE_MAPS_API_KEY) {
      setGoogleTileSession(null);
      setGoogleOverlayTileSession(null);
      setGoogleTileError(null);
      return;
    }
    let active = true;
    setGoogleTileSession(null);
    setGoogleOverlayTileSession(null);
    setGoogleTileError(null);
    (async () => {
      try {
        const createSession = async (body) => {
          const response = await fetch(
            `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(
              GOOGLE_MAPS_API_KEY
            )}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          );
          if (!response.ok) {
            throw new Error(`Google tile session failed: HTTP ${response.status}`);
          }
          return response.json();
        };
        const common = {
          language: "en-US",
          region: "PH",
          scale: "scaleFactor2x",
        };
        if (tileMode === "google_hybrid") {
          // Split Google Hybrid into base satellite + transparent
          // layerRoadmap overlay. This gives Google POIs their own pane
          // above SMV while keeping the satellite imagery underneath.
          const [baseSession, overlaySession] = await Promise.all([
            createSession({
              ...common,
              mapType: "satellite",
              overlay: false,
            }),
            createSession({
              ...common,
              mapType: "satellite",
              layerTypes: ["layerRoadmap"],
              overlay: true,
            }),
          ]);
          if (active) {
            setGoogleTileSession(baseSession.session);
            setGoogleOverlayTileSession(overlaySession.session);
          }
          return;
        }
        if (tileMode === "google_street") {
          // Google Streets has POIs/labels baked into the base roadmap
          // tile. We intentionally do not duplicate that tile above SMV:
          // it washes out the class colors and still cannot separate
          // POIs from the rest of the Google street map.
          const session = await createSession({
            ...common,
            mapType: "roadmap",
            overlay: false,
          });
          if (active) {
            setGoogleTileSession(session.session);
            setGoogleOverlayTileSession(null);
          }
          return;
        }
        const session = await createSession({
          ...common,
          mapType: "roadmap",
          overlay: false,
        });
        if (active) {
          setGoogleTileSession(session.session);
        }
      } catch (error) {
        console.error(error);
        if (active) {
          setGoogleTileSession(null);
          setGoogleOverlayTileSession(null);
          setGoogleTileError(
            "Google Maps could not start. Check the API key and Map Tiles API."
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [tileMode]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sources = await freshJson("/data/sources.json")
          .catch(() => ({
            has_custom_barangays: false,
            has_zones: false,
          }));
        const outlineFile = municipality?.dataFiles?.outline ?? "/data/bauko.geojson";
        const defaultBarangaysFile =
          municipality?.dataFiles?.barangays ?? "/data/bauko_barangays.geojson";
        const customBarangaysFile = municipality?.dataFiles?.barangaysCustom;
        const valuationsFile =
          municipality?.dataFiles?.valuations ?? "/data/bauko_valuations.json";
        const zonesFile = municipality?.dataFiles?.zones ?? "/data/bauko_zones.geojson";
        const parcelsFile = municipality?.dataFiles?.parcels;
        const frontageBandsFile = municipality?.dataFiles?.frontageBands;
        const slug = municipality?.slug ?? "bauko";
        const landmarksFile =
          municipality?.dataFiles?.landmarks ?? `/data/${slug}_landmarks.geojson`;
        const customLandmarksFile =
          municipality?.dataFiles?.customLandmarks ??
          `/data/${slug}_custom_landmarks.geojson`;
        const osmRoadsFile = municipality?.dataFiles?.osmRoads;
        const barangayFile =
          sources.has_custom_barangays && customBarangaysFile
            ? customBarangaysFile
            : defaultBarangaysFile;
        const [
          bauko,
          barangays,
          valuations,
          zones,
          parcels,
          monamonSurRoads,
          monamonNorteRoads,
          frontageBands,
          landmarks,
          customLandmarks,
          osmRoads,
          osmWater,
          osmPlaces,
        ] = await Promise.all([
          // Outline / barangays / valuations used to be required, so the
          // fetches were unguarded. With more LGUs being scaffolded
          // ahead of their PSA fetch, a missing file would return an
          // HTML 404 and crash the whole map on `r.json()`. Treat all
          // three as best-effort now: log a console warning and fall
          // back to empty FC / null so the rest of the map (chips,
          // tabs, editor toolbar) still renders. Run the data-fetch
          // scripts (boundaries:fetch:<slug>, etc.) to populate them.
          freshJson(outlineFile).catch((e) => {
            console.warn(`Missing outline file: ${outlineFile} (HTTP ${e.status ?? "?"}). Run \`npm run boundaries:fetch:${slug}\`.`);
            return EMPTY_FC;
          }),
          freshJson(barangayFile).catch((e) => {
            console.warn(`Missing barangays file: ${barangayFile} (HTTP ${e.status ?? "?"}). Run \`npm run boundaries:fetch:${slug}\`.`);
            return EMPTY_FC;
          }),
          freshJson(valuationsFile).catch((e) => {
            console.warn(`Missing valuations file: ${valuationsFile} (HTTP ${e.status ?? "?"}). This is optional but the rich popups won't have prices.`);
            return null;
          }),
          sources.has_zones && zonesFile
            ? freshJson(zonesFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // Parcel boundaries are an optional cadastral overlay. They sit
          // above SMV fills and do not participate in zone editing.
          parcelsFile
            ? freshJson(parcelsFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          municipality?.slug === "bauko"
            ? freshJson("/data/bauko_monamon_sur_roads_highlight.geojson").catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          municipality?.slug === "bauko"
            ? freshJson("/data/bauko_monamon_norte_roads_highlight.geojson").catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // Frontage bands are optional — silently fall back to an
          // empty FeatureCollection if the file doesn't exist for this
          // municipality yet. Run `npm run bands:<slug>` to generate.
          frontageBandsFile
            ? freshJson(frontageBandsFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // Same optionality for landmarks (`npm run landmarks:<slug>`).
          landmarksFile
            ? freshJson(landmarksFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // LGU-curated POIs (hand-edited GeoJSON, e.g. Kalangeg Bldg).
          customLandmarksFile
            ? freshJson(customLandmarksFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // OSM road network — rendered as a solid white overlay
          // when an imagery basemap is active so roads stay visible
          // through the SMV zone fills.
          osmRoadsFile
            ? freshJson(osmRoadsFile).catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          // Print/vector reference layers. Filename convention:
          //   /data/<slug>_osm_water.geojson      (npm run water:fetch:<slug>)
          //   /data/<slug>_osm_places.geojson     (npm run places:fetch:<slug>)
          // Each silently falls back to EMPTY_FC when missing so the
          // raster basemap still works for LGUs not yet processed.
          // Buildings are intentionally lazy-loaded in a separate effect
          // because they can be 10+ MB / 20k SVG polygons.
          freshJson(`/data/${slug}_osm_water.geojson`).catch(() => EMPTY_FC),
          freshJson(`/data/${slug}_osm_places.geojson`).catch(() => EMPTY_FC),
        ]);
        if (!active) return;
        setData({
          bauko,
          barangays,
          valuations,
          zones,
          parcels,
          monamonSurRoads,
          monamonNorteRoads,
          frontageBands,
          landmarks,
          customLandmarks,
          osmRoads,
          osmWater,
          osmPlaces,
          osmBuildings: EMPTY_FC,
          osmBuildingsSlug: null,
        });
      } catch (e) {
        console.error("Failed to load map data:", e);
      }
    })();
    return () => {
      active = false;
    };
  }, [municipality]);

  useEffect(() => {
    const slug = municipality?.slug ?? "bauko";
    if (!shouldLoadBuildingFootprints) return undefined;
    if (data.osmBuildingsSlug === slug) {
      return undefined;
    }

    let active = true;
    (async () => {
      try {
        const osmBuildings = await freshJson(
          `/data/${slug}_overture_buildings.geojson`
        ).catch(() =>
          freshJson(`/data/${slug}_osm_buildings.geojson`).catch(() => EMPTY_FC)
        );
        if (!active) return;
        setData((prev) => ({
          ...prev,
          osmBuildings,
          osmBuildingsSlug: slug,
        }));
      } catch {
        if (!active) return;
        setData((prev) => ({
          ...prev,
          osmBuildings: EMPTY_FC,
          osmBuildingsSlug: slug,
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, [
    data.osmBuildingsSlug,
    municipality?.slug,
    shouldLoadBuildingFootprints,
  ]);

  useEffect(() => {
    onDataChange?.(data);
  }, [data, onDataChange]);

  // Locally-added custom landmarks (from the in-app "+ Landmark" tool
  // in EditableZones). Stored in localStorage and merged with the
  // file-based custom landmarks at render. Listens for a custom event
  // that EditableZones fires on add/remove so the map updates live.
  const [localCustomLandmarks, setLocalCustomLandmarks] = useState([]);
  const [deletedCustomLandmarkKeys, setDeletedCustomLandmarkKeys] = useState([]);
  useEffect(() => {
    const slug = municipality?.slug;
    if (!slug) return undefined;
    const storageKey = `custom-landmarks-local-v1:${slug}`;
    const deletedStorageKey = `custom-landmarks-deleted-v1:${slug}`;
    const load = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
          setLocalCustomLandmarks([]);
          return;
        }
        // Backfill `properties.id` for entries that pre-date the id
        // refactor. Without an id, the click-popup's Delete button
        // had no way to identify which row in localStorage to remove,
        // so deletes silently no-op'd. Generating a stable id here
        // (and writing back) makes them deletable.
        let mutated = false;
        const fixed = parsed.map((f) => {
          if (f?.properties?.id) return f;
          mutated = true;
          return {
            ...f,
            properties: {
              ...(f?.properties || {}),
              id: `lm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            },
          };
        });
        if (mutated) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(fixed));
          } catch {}
        }
        setLocalCustomLandmarks(fixed);
        const deletedRaw = localStorage.getItem(deletedStorageKey);
        const deleted = deletedRaw ? JSON.parse(deletedRaw) : [];
        setDeletedCustomLandmarkKeys(
          Array.isArray(deleted) ? deleted.filter((id) => typeof id === "string") : []
        );
      } catch {
        setLocalCustomLandmarks([]);
        setDeletedCustomLandmarkKeys([]);
      }
    };
    load();
    const eventName = `${slug}:custom-landmarks-updated`;
    window.addEventListener(eventName, load);
    return () => window.removeEventListener(eventName, load);
  }, [municipality?.slug]);

  // "Move pin" mode lives in EditableZones (the toolbar lives there).
  // When the toggle flips, EditableZones broadcasts on a custom event;
  // we mirror it into local state so the GeoJSON layer can re-render
  // each in-app pin with `draggable: true`.
  const [isMovingLandmarks, setIsMovingLandmarks] = useState(false);
  useEffect(() => {
    const slug = municipality?.slug;
    if (!slug) return undefined;
    const eventName = `${slug}:moving-landmark-mode`;
    const onToggle = (e) => {
      setIsMovingLandmarks(Boolean(e?.detail?.enabled));
    };
    window.addEventListener(eventName, onToggle);
    return () => window.removeEventListener(eventName, onToggle);
  }, [municipality?.slug]);

  // Add/remove a body-level class so the entire map gets a "move"
  // cursor while move-mode is on — visual cue that hovering a pin
  // means "I can drag this."
  useEffect(() => {
    const cls = "moving-landmarks";
    if (isMovingLandmarks) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [isMovingLandmarks]);

  // Refresh the zones layer when EditableZones saves to disk via /api/zones/save.
  // Without this, the read-only SMV-zones layer (rendered outside edit mode)
  // keeps the stale state from initial mount and doesn't reflect a reassign.
  useEffect(() => {
    const reloadZones = async () => {
      try {
        const zonesFile = municipality?.dataFiles?.zones ?? "/data/bauko_zones.geojson";
        const fc = await fetch(zonesFile, {
          cache: "no-store",
        }).then((r) => r.json());
        setData((prev) => ({ ...prev, zones: fc }));
      } catch (e) {
        console.warn("Could not reload zones after save:", e);
      }
    };
    const eventName = municipality?.zones?.eventName ?? "bauko:zones-saved";
    window.addEventListener(eventName, reloadZones);
    return () =>
      window.removeEventListener(eventName, reloadZones);
  }, [municipality]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const feature = data.bauko?.features?.[0];
        if (!feature) return;
        const [w, s, e, n] = featureBbox(feature);
        const lon = (w + e) / 2;
        const lat = (s + n) / 2;
        const z = 10;
        const tileRoot =
          tileMode === "offline_mapbox" ? OFFLINE_MAPBOX_TILE_ROOT : "/tiles";
        const res = await fetch(
          `${tileRoot}/${z}/${lonToTile(lon, z)}/${latToTile(lat, z)}.png`,
          { method: "HEAD" }
        );
        if (active) setTilesAvailable(res.ok);
      } catch {
        if (active) setTilesAvailable(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [data.bauko, tileMode]);

  const tile = TILE_SOURCES[tileMode] ?? TILE_SOURCES.online;
  const isGoogleTileMode =
    tileMode === "google_street" || tileMode === "google_hybrid";
  // Only Hybrid's overlay tile is genuinely transparent (satellite +
  // layerRoadmap). Streets stays as a base tile because Google's own
  // POIs/labels are baked into the roadmap raster and cannot be
  // separately z-indexed by Leaflet.
  const hasTransparentGoogleOverlay = tileMode === "google_hybrid";
  const googleContextAboveSmv = hasTransparentGoogleOverlay;
  const tileUrl =
    isGoogleTileMode && googleTileSession && GOOGLE_MAPS_API_KEY
      ? `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(
          googleTileSession
        )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`
      : tile.url;
  const googleOverlayTileUrl =
    isGoogleTileMode && googleOverlayTileSession && GOOGLE_MAPS_API_KEY
      ? `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(
          googleOverlayTileSession
        )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`
      : null;
  const hasRasterTileUrl =
    !isGoogleTileMode || Boolean(googleTileSession && tileUrl);
  // Vector-basemap mode: no raster tiles at all, OSM data renders as
  // SVG (water / buildings / roads / place labels) styled to match
  // the print SVG. Used so the editor view is WYSIWYG with the
  // printed map — what you draw is what you print.
  const useVectorBasemap = printMode || isVectorBasemapMode;
  const showLabelsOverlay =
    !municipality?.ui?.hideMapLabels &&
    tileMode !== "offline" &&
    tileMode !== "offline_mapbox" &&
    tileMode !== "mapbox_hybrid" &&
    !isGoogleTileMode;
  const showBuildingFootprintsOverlay =
    shouldLoadBuildingFootprints &&
    data.osmBuildingsSlug === (municipality?.slug ?? "bauko") &&
    (data.osmBuildings?.features?.length ?? 0) > 0;
  const baukoFeature = data.bauko?.features?.[0] ?? null;
  const printMaskFeature = useMemo(
    () => (printMode && baukoFeature ? buildOutsideMaskFeature(baukoFeature) : null),
    [printMode, baukoFeature]
  );
  const center = municipality?.map?.center ?? DEFAULT_CENTER;
  const defaultZoom = municipality?.map?.defaultZoom ?? DEFAULT_ZOOM;
  const slugForNameResolver = municipality?.schedule?.slugForName;

  // Editor and normal print both render zones at their on-disk geometry —
  // no render-time buffer. The print route still has an explicit
  // ?smvBuffer=N debug/production knob for schematic widening, but the
  // default is WYSIWYG with the saved GeoJSON.
  const displayedZones = useMemo(() => data.zones ?? null, [data.zones]);
  /*
  // --- WYSIWYG editor buffer (commented out for now, see note above) ---
  const displayedZones = useMemo(() => {
    if (!data.zones) return data.zones;
    if (!useVectorBasemap) return data.zones;
    const features = (data.zones.features ?? []).map((feat) => {
      if (!feat?.geometry) return feat;
      try {
        const area = turf.area(feat);
        if (area <= 0) return feat;
        const line = turf.polygonToLine(feat);
        const perim = turf.length(line, { units: "meters" });
        if (perim <= 0) return feat;
        const compactness = (4 * Math.PI * area) / (perim * perim);
        if (compactness >= 0.15) return feat; // not a ribbon
        const buffered = turf.buffer(feat, 12, { units: "meters" });
        if (!buffered?.geometry) return feat;
        return { ...feat, geometry: buffered.geometry };
      } catch {
        return feat;
      }
    });
    return { type: "FeatureCollection", features };
  }, [data.zones, useVectorBasemap]);
  */

  // Memoize the active barangay feature collection so the highlight layer
  // doesn't get a fresh `data` reference on every parent render — that
  // would force Leaflet to remove + re-add the layer and cause flicker.
  const activeFeatureCollection = useMemo(() => {
    if (!activeBarangaySlug || !data.barangays) return null;
    return {
      type: "FeatureCollection",
      features: featuresForSlug(activeBarangaySlug, data.barangays),
    };
  }, [activeBarangaySlug, data.barangays]);
  // Resolve the most specific saved viewport that applies right now.
  // Order of precedence:
  //   1. Active stretch's saved view (the most granular — landmark-level)
  //   2. Active barangay's saved view (Bauko fallback)
  //   3. None — auto-fit to barangay polygon happens in BarangayFocus
  const activeSavedView = activeStretchView
    ? activeStretchView
    : activeBarangaySlug
      ? savedBarangayViews?.[activeBarangaySlug] ?? null
      : null;
  const activeBarangayLabel = useMemo(() => {
    if (!activeBarangaySlug) return "";
    const features = activeFeatureCollection?.features ?? [];
    if (features.length) return getBarangayName(features[0]);
    return humanizeSlug(activeBarangaySlug);
  }, [activeBarangaySlug, activeFeatureCollection]);

  const isClassActive = Boolean(activeClass);
  const zoneClassLabelFeatures = useMemo(() => {
    const activeKey = normaliseClassKey(isClassActive ? activeClass?.subClass : null);
    const zoom = Number.isFinite(mapZoom) ? mapZoom : defaultZoom;
    if (!activeKey && zoom < SMV_CLASS_LABEL_MIN_ZOOM) {
      return { type: "FeatureCollection", features: [] };
    }
    const features = (displayedZones?.features ?? [])
      .map((feature, index) => {
        if (!feature?.geometry || isParcelZoneFeature(feature)) return null;
        const classes = classKeysForFeature(feature);
        if (activeKey && !classes.includes(activeKey)) return null;
        const klass = activeKey || solidClassForFeature(feature, activeKey);
        // The long "Institutional" word reads like a place label and
        // dominates dense town centers. The violet fill + legend already
        // communicate this class in the live app.
        if (klass === "INSTITUTIONAL") return null;
        const label = CLASSIFICATION_INFO[klass]?.label ?? klass;
        if (!label) return null;
        const point = zoneLabelCandidatePoint(feature);
        if (!point?.geometry) return null;
        return {
          type: "Feature",
          id: feature.id ?? feature.properties?.id ?? `zone-label-${index}`,
          properties: {
            label,
            classKey: klass,
          },
          geometry: point.geometry,
        };
      })
      .filter(Boolean);
    return { type: "FeatureCollection", features };
  }, [activeClass?.subClass, defaultZoom, displayedZones, isClassActive, mapZoom]);
  const zoneClassLabelRenderKey = useMemo(
    () => {
      let hash = 0;
      for (const feature of zoneClassLabelFeatures.features) {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        const part = `${feature.id}:${feature.properties?.label}:${Number(lng).toFixed(
          6
        )},${Number(lat).toFixed(6)}`;
        for (let i = 0; i < part.length; i += 1) {
          hash = (hash * 31 + part.charCodeAt(i)) >>> 0;
        }
      }
      return `${zoneClassLabelFeatures.features.length}-${hash.toString(36)}`;
    },
    [zoneClassLabelFeatures]
  );
  const showMonamonSurRoads =
    municipality?.slug === "bauko" &&
    activeClass?.subClass === "C-3" &&
    activeBarangaySlug === "monamon-sur" &&
    (data.monamonSurRoads?.features?.length ?? 0) > 0;
  const showMonamonNorteRoads =
    municipality?.slug === "bauko" &&
    activeClass?.subClass === "C-3" &&
    activeBarangaySlug === "monamon-norte" &&
    (data.monamonNorteRoads?.features?.length ?? 0) > 0;
  const showPublicOsmRoadOverlay =
    !drawMode &&
    !useVectorBasemap &&
    (isImageryTileMode(tileMode) || isGoogleTileMode) &&
    data.osmRoads?.features?.length > 0;
  // React-Leaflet's GeoJSON layer is created from its initial `data` object.
  // Include the feature contents in the key so editing a pin (same count,
  // different name/kind/coordinates) rebuilds the layer and shows the save
  // immediately instead of leaving the old label on screen.
  const localLandmarkRenderKey = useMemo(
    () =>
      localCustomLandmarks.map((feature) => JSON.stringify(feature)).join("|") +
      `|deleted:${deletedCustomLandmarkKeys.join(",")}`,
    [localCustomLandmarks, deletedCustomLandmarkKeys]
  );
  const registerEditableZonesSaveHandler = useCallback((handler) => {
    editableZonesSaveRef.current = typeof handler === "function" ? handler : null;
  }, []);

  return (
    <div className="leaflet-shell">
      <MapContainer
        center={center}
        zoom={defaultZoom}
        maxZoom={tile.maxZoom ?? 20}
        scrollWheelZoom
        zoomControl={false}
        className="consultation-map"
      >
        <MapBridge
          onMapReady={onMapReady}
          editableZonesSaveRef={editableZonesSaveRef}
        />
        <MapZoomBridge onZoomChange={setMapZoom} />
        <ZoomTier />
        <CommercialHatchDefs
          enabled={!drawMode && layers.zones}
          municipalitySlug={municipality?.slug ?? null}
        />
        {/* The raster basemap is hidden in print mode AND in the
            "vector_basemap" editor mode — both replace tiles with the
            OSM-derived SVG layers so what you see on screen matches
            what you'll print. */}
        {!useVectorBasemap && hasRasterTileUrl && (
          <TileLayer
            key={`${tileMode}-${googleTileSession ?? "default"}`}
            url={tileUrl}
            attribution={tile.attribution}
            maxZoom={tile.maxZoom}
            maxNativeZoom={tile.maxNativeZoom}
          />
        )}
        {/* Vector basemap panes. Water + buildings sit below SMV so
            the value bands paint over them; road casing + road fill
            sit ABOVE SMV (425 / 428 > 420) so the road network reads
            on top of the choropleth — mirrors lib/print-svg-builder.js
            paint order. Place labels stay on top of everything. */}
        <Pane name="print-water-pane" style={{ zIndex: 205 }} />
        <Pane name="print-buildings-pane" style={{ zIndex: 210 }} />
        <Pane name="print-roads-casing-pane" style={{ zIndex: 425 }} />
        <Pane name="print-roads-fill-pane" style={{ zIndex: 428 }} />
        <Pane name="print-labels-pane" style={{ zIndex: 670, pointerEvents: "none" }} />

        <Pane name="smv-pane" style={{ zIndex: 400 }} />
        <Pane name="print-mask-pane" style={{ zIndex: 395, pointerEvents: "none" }} />
        <Pane name="muni-pane" style={{ zIndex: 460 }} />
        {/* Frontage bands sit just below the zones so any drawn polygon
            paints over them, but above the SMV fill so the guide stays
            visible against the basemap. */}
        <Pane name="frontage-bands-pane" style={{ zIndex: 410 }} />
        {/* Pane-level opacity in vector_basemap (WYSIWYG print) mode so
            adjacent SMV polygons compose once over the basemap instead
            of stacking per-path fillOpacity at every overlap. Other
            tile modes keep opacity 1 so the normal class colors stay
            vivid over raster basemaps. */}
        <Pane
          key={`zones-pane-${isVectorBasemapMode}`}
          name="zones-pane"
          style={{
            zIndex: 420,
            opacity: isVectorBasemapMode ? 0.7 : 1,
          }}
        />
        <Pane
          name="building-footprints-pane"
          style={{ zIndex: 421, pointerEvents: "none" }}
        />
        <Pane name="roads-pane" style={{ zIndex: 430 }} />
        {/* Cadastral parcel lines sit above SMV fills but below roads. */}
        <Pane
          name="parcels-pane"
          style={{
            zIndex: 422,
            pointerEvents: "none",
          }}
        />
        <Pane
          name="smv-boundary-halo-pane"
          style={{ zIndex: 423, pointerEvents: "none" }}
        />
        {/* White SMV outlines sit above parcel lines so class boundaries stay
            readable in dense cadastral areas, but below roads. */}
        <Pane name="smv-boundary-pane" style={{ zIndex: 424, pointerEvents: "none" }} />
        <Pane name="boundary-halo-pane" style={{ zIndex: 440 }} />
        <Pane name="brgy-pane" style={{ zIndex: 450 }} />
        <Pane name="muni-halo-pane" style={{ zIndex: 455 }} />
        {/* Layer order:
            690 SMV class labels
            660 custom/curated POIs
            650 Google POIs/labels
            430 roads
            420 SMV colors
            200 basemap tiles */}
        <Pane
          key={`label-tiles-pane-${googleContextAboveSmv}`}
          name="label-tiles-pane"
          style={{ zIndex: googleContextAboveSmv ? 650 : 390, pointerEvents: "none" }}
        />
        {/* Google label/POI overlay. Hybrid gets a genuinely transparent
            layerRoadmap tile here (satellite + overlay:true). Streets has
            no transparent equivalent, so it does not render this overlay. */}
        <Pane
          key={`google-labels-pane-${googleContextAboveSmv}-${hasTransparentGoogleOverlay}`}
          name="google-labels-pane"
          style={{
            zIndex: googleContextAboveSmv ? 650 : 390,
            pointerEvents: "none",
            mixBlendMode: "normal",
          }}
        />
        <Pane
          key={`basemap-pois-pane-${googleContextAboveSmv}`}
          name="basemap-pois-pane"
          style={{ zIndex: googleContextAboveSmv ? 650 : 390, pointerEvents: "none" }}
        />
        <Pane
          name="zone-class-labels-pane"
          style={{ zIndex: 690, pointerEvents: "none" }}
        />
        {/* Custom/curated POIs sit with Google POIs: above roads and SMV
            colors, below SMV class labels. */}
        <Pane name="pois-pane" style={{ zIndex: 660, pointerEvents: "none" }} />

        {hasTransparentGoogleOverlay &&
          googleOverlayTileUrl &&
          !useVectorBasemap &&
          Array.from({
            length: GOOGLE_CONTEXT_PASSES,
          }).map((_, passIndex) => (
            <TileLayer
              key={`google-overlay-${googleOverlayTileSession}-${passIndex}`}
              url={googleOverlayTileUrl}
              attribution={passIndex === 0 ? tile.attribution : ""}
              maxZoom={tile.maxZoom}
              maxNativeZoom={tile.maxNativeZoom}
              pane="google-labels-pane"
              opacity={GOOGLE_CONTEXT_OPACITY}
            />
          ))}

        {layers.zones &&
          !drawMode &&
          zoneClassLabelFeatures.features.length > 0 && (
            <GeoJSON
              key={`zone-class-labels-${activeClass?.id ?? "all"}-${zoneClassLabelRenderKey}`}
              data={zoneClassLabelFeatures}
              pane="zone-class-labels-pane"
              interactive={false}
              pointToLayer={zoneClassLabelMarker}
            />
          )}

        {/* CartoDB Voyager Only Labels — transparent tile layer that
            carries place names + road names on top of everything.
            Cleanest way to put labels above SMV fills without
            re-rendering tiles. POI icons stay baked into the basemap
            below the zones (we tried surfacing them as a separate
            layer and it duplicated labels and looked cluttered). */}
        {showLabelsOverlay && !useVectorBasemap && (
          <TileLayer
            key={`labels-${tileMode}`}
            url={LABELS_OVERLAY_URL}
            attribution={LABELS_OVERLAY_ATTRIBUTION}
            maxZoom={19}
            pane="label-tiles-pane"
            opacity={1}
          />
        )}

        {/* Vector basemap layers — rendered when print mode is on OR
            the user selected the "vector_basemap" tile mode for the
            editor. Paints under the SMV stack so zones still dominate;
            the basemap adds context (rivers, roads, building
            footprints, village labels) without relying on raster tiles
            that pixelate on paper. Z-order through the panes:
            water → buildings → road casing → road fill → SMV →
            boundaries → labels. */}
        {useVectorBasemap && data.osmWater?.features?.length > 0 && (
          <GeoJSON
            key={`vector-water-${municipality?.slug ?? "bauko"}`}
            data={data.osmWater}
            pane="print-water-pane"
            interactive={false}
            style={printWaterStyle}
          />
        )}
        {useVectorBasemap &&
          !showBuildingFootprintsOverlay &&
          data.osmBuildings?.features?.length > 0 && (
          <GeoJSON
            key={`vector-buildings-${municipality?.slug ?? "bauko"}`}
            data={data.osmBuildings}
            pane="print-buildings-pane"
            interactive={false}
            style={printBuildingStyle}
          />
        )}
        {useVectorBasemap && data.osmRoads?.features?.length > 0 && (
          <GeoJSON
            key={`vector-roads-casing-${municipality?.slug ?? "bauko"}`}
            data={data.osmRoads}
            pane="print-roads-casing-pane"
            interactive={false}
            style={(feature) => printRoadCasingStyle(feature)}
          />
        )}
        {useVectorBasemap && data.osmRoads?.features?.length > 0 && (
          <GeoJSON
            key={`vector-roads-fill-${municipality?.slug ?? "bauko"}`}
            data={data.osmRoads}
            pane="print-roads-fill-pane"
            interactive={false}
            style={(feature) => printRoadFillStyle(feature)}
          />
        )}
        {useVectorBasemap && data.osmPlaces?.features?.length > 0 && (
          <GeoJSON
            key={`vector-places-${municipality?.slug ?? "bauko"}`}
            data={data.osmPlaces}
            pane="print-labels-pane"
            interactive={false}
            pointToLayer={(feature, latlng) =>
              printPlaceLabelMarker(feature, latlng)
            }
          />
        )}

        {printMaskFeature && (
          <GeoJSON
            key={`print-mask-${municipality?.slug ?? "bauko"}`}
            data={printMaskFeature}
            pane="print-mask-pane"
            interactive={false}
            style={() => ({
              color: "#ffffff",
              weight: 0,
              opacity: 1,
              fillColor: "#ffffff",
              fillOpacity: 0.96,
              fillRule: "evenodd",
            })}
          />
        )}

        {/* Public road overlay for raster basemaps. Base-map roads are
            baked into the tile imagery, so draw OSM road vectors above
            SMV fills; POI/context labels render above these roads. */}
        {showPublicOsmRoadOverlay && (
          <GeoJSON
            key={`public-osm-roads-casing-${municipality?.slug ?? "bauko"}-${data.osmRoads.features.length}`}
            data={data.osmRoads}
            pane="roads-pane"
            interactive={false}
            style={(feature) => publicOsmRoadCasingStyle(feature, mapZoom)}
          />
        )}
        {showPublicOsmRoadOverlay && (
          <GeoJSON
            key={`public-osm-roads-fill-${municipality?.slug ?? "bauko"}-${data.osmRoads.features.length}`}
            data={data.osmRoads}
            pane="roads-pane"
            interactive={false}
            style={(feature) => publicOsmRoadFillStyle(feature, mapZoom)}
          />
        )}

        {/* Bontoc cadastral parcel overlay. Paint order is basemap → SMV →
            parcels → roads. */}
        {layers?.parcels && data.parcels?.features?.length > 0 && (
          <GeoJSON
            key={`parcels-${municipality?.slug ?? "bauko"}-${data.parcels.features.length}`}
            data={data.parcels}
            pane="parcels-pane"
            interactive={false}
            style={parcelOverlayStyle}
          />
        )}

        {layers.zones && !drawMode && displayedZones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-boundary-halos-${activeClass?.id ?? "all"}-${printMode ? "print" : "screen"}`}
            data={displayedZones}
            pane="smv-boundary-halo-pane"
            interactive={false}
            style={smvBoundaryHaloStyle}
          />
        )}

        {layers.zones && !drawMode && displayedZones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-boundaries-${activeClass?.id ?? "all"}-${printMode ? "print" : "screen"}`}
            data={displayedZones}
            pane="smv-boundary-pane"
            interactive={false}
            style={smvBoundaryStyle}
          />
        )}

        {/* Basemap POI labels fetched into public/data/<slug>_landmarks.geojson.
            This file can come from OSM (`npm run landmarks:<slug>`) or
            Google Places (`npm run landmarks:google -- <slug>`). Basemap
            tile labels are baked into PNG/JPEG imagery, so missing business
            names are rendered here as our own POI overlay above roads but
            below SMV class labels. User custom landmarks render later on
            the annotation pane. */}
        {(layers?.providerPois ?? layers?.landmarks) && !drawMode && (mapZoom == null || mapZoom >= 16) && data.landmarks?.features?.length > 0 && (
          <GeoJSON
            key={`osm-landmarks-${municipality?.slug ?? "bauko"}-${data.landmarks.features.length}`}
            data={data.landmarks}
            pane="basemap-pois-pane"
            pointToLayer={(feature, latlng) =>
              landmarkLabelMarker(feature, latlng, {
                className: "custom-landmark custom-landmark--osm",
                interactive: false,
                pane: "basemap-pois-pane",
              })
            }
          />
        )}

        {/* Custom landmarks layer — LGU-curated POIs that aren't well-
            mapped in OSM (e.g. Kalangeg Bldg in Bontoc). Edit by hand:
            public/data/<slug>_custom_landmarks.geojson. Each Feature
            becomes a Leaflet divIcon marker with a kind-coloured teardrop
            pin + a white pill carrying the name, on the top POI pane.
            Controlled separately from provider POIs so Google/OSM context
            and LGU-authored custom pins can be inspected independently.
            If a feature carries a `stretch_key` matching the currently
            active sidebar stretch (e.g. "c-1|poblacion|0"), the pin
            gets an extra "is-active-stretch" class so it visually
            pops while that schedule entry is the focus. */}
        {(() => {
          // The custom landmark toggle is separate from provider POIs.
          // If the flag is missing (older state shape), keep custom
          // landmarks visible so existing editor behaviour is preserved.
          if ((layers?.customLandmarks ?? true) === false && !isMovingLandmarks) {
            return null;
          }
          // Merge file-based custom landmarks with locally-added ones
          // from the in-app "+ Landmark" tool. Local entries are
          // tagged with `source: "in-app"` so they're distinguishable
          // in audits and the "Save to project" flow.
          const fileFeatures = data.customLandmarks?.features || [];
          const landmarkIdentity = (feature) => {
            const props = feature?.properties || {};
            const coords = feature?.geometry?.coordinates || [];
            return props.id
              ? `id:${props.id}`
              : `coord:${props.name || ""}:${coords[0] ?? ""}:${coords[1] ?? ""}`;
          };
          const localKeys = new Set(
            localCustomLandmarks.map((feature) => landmarkIdentity(feature))
          );
          const deletedKeys = new Set(deletedCustomLandmarkKeys);
          // Local edits/deletes take precedence over the last file snapshot.
          // This matters immediately after publishing: the server file may
          // still be the previous deployment while the editor already knows
          // which in-app pins were changed or removed.
          const visibleFileFeatures = fileFeatures.filter((feature) => {
            const props = feature?.properties || {};
            const key = landmarkIdentity(feature);
            // Local moves/deletes can override curated file pins too. Check
            // identity keys before the source guard so an old coordinate
            // cannot reappear beside the moved local override.
            if (localKeys.has(key) || deletedKeys.has(key)) return false;
            if (props.source !== "in-app") return true;
            return !localKeys.has(key) && !deletedKeys.has(key);
          });
          const merged = [...visibleFileFeatures, ...localCustomLandmarks];
          if (merged.length === 0) return null;
          const showWideCustomLandmarkLabels =
            mapZoom == null || mapZoom >= CUSTOM_LANDMARK_LABEL_MIN_ZOOM;
          return (
            <GeoJSON
              key={`custom-landmarks-${municipality?.slug ?? "bauko"}-${activeStretchKey ?? ""}-${localLandmarkRenderKey}-${isMovingLandmarks ? "drag" : "static"}-${showWideCustomLandmarkLabels ? "labels" : "pins"}`}
              data={{ type: "FeatureCollection", features: merged }}
            pane="pois-pane"
            pointToLayer={(feature, latlng) => {
              const props = feature?.properties || {};
              const kind = normalizeLandmarkKind(props.kind);
              const name = String(props.name || "");
              const labelPlacement = normalizeLandmarkLabelPlacement(
                props.label_placement || props.labelPlacement
              );
              const labelSize = normalizeLandmarkLabelSize(
                props.label_size || props.labelSize
              );
              const insideLabel = isInsideLandmarkLabel(labelPlacement);
              const isInApp = props.source === "in-app";
              const draggable = isMovingLandmarks;
              // Accept both `stretch_keys` (array) and legacy
              // `stretch_key` (string). Highlight when any linked key
              // matches the active sidebar stretch.
              const featKeys = Array.isArray(props.stretch_keys)
                ? props.stretch_keys
                : props.stretch_key
                  ? [props.stretch_key]
                  : [];
              const isActive =
                Boolean(activeStretchKey) &&
                featKeys.includes(activeStretchKey);
              const showLabel =
                showWideCustomLandmarkLabels || isActive || draggable;
              const safeName = name
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
              // Move mode applies to every custom landmark rendered by this
              // layer, including curated project-file pins. OSM-only labels
              // use a separate non-interactive layer below the SMV plate.
              const marker = L.marker(latlng, {
                icon: L.divIcon({
                  html:
                    `<span class="custom-pin custom-pin--${kind}"><span class="custom-pin-symbol">${landmarkIconMarkup(kind)}</span></span>` +
                    `<span class="custom-pin-name custom-pin-name--size-${labelSize}${insideLabel ? " custom-pin-name--inside" : ""}${showLabel ? "" : " custom-pin-name--hidden"}">${showLabel ? safeName : ""}</span>`,
                  className:
                    "custom-landmark" +
                    ` custom-landmark--label-${labelPlacement}` +
                    (insideLabel ? " custom-landmark--inside-label" : "") +
                    (isInApp ? " is-interactive" : "") +
                    (isActive ? " is-active-stretch" : "") +
                    (draggable ? " is-draggable" : ""),
                  iconSize: [0, 0],
                  iconAnchor: [9, 9],
                }),
                // In-app pins are interactive — including pins already
                // published into *_custom_landmarks.geojson. Curated
                // provider/file pins remain non-interactive.
                interactive: isInApp || draggable,
                keyboard: isInApp || draggable,
                draggable,
                autoPan: draggable,
                pane: "pois-pane",
              });
              if (draggable) {
                // Keep this explicit because the marker is created inside a
                // React-Leaflet GeoJSON layer and the zero-size divIcon can
                // otherwise leave Leaflet's drag handler disabled after a
                // layer rebuild.
                marker.dragging?.enable?.();
                // Persist the new lat/lng when the user finishes
                // dragging. We pass both the stable id and the OLD
                // coords so EditableZones can fall back to (name +
                // coord) matching for legacy entries without an id.
                marker.on("dragend", () => {
                  const ll = marker.getLatLng();
                  const oldCoords = feature?.geometry?.coordinates || [];
                  window.dispatchEvent(
                    new CustomEvent(
                      `${municipality?.slug ?? "bauko"}:landmark-move`,
                      {
                        detail: {
                          id: props.id,
                          source: props.source,
                          feature,
                          name: props.name,
                          oldLng: oldCoords[0],
                          oldLat: oldCoords[1],
                          newLng: ll.lng,
                          newLat: ll.lat,
                        },
                      }
                    )
                  );
                });
              }
              if (isInApp && !draggable) {
                const linksHtml =
                  featKeys.length > 0
                    ? `<div class="landmark-popup__links">${featKeys.length} linked stretch${featKeys.length === 1 ? "" : "es"}</div>`
                    : `<div class="landmark-popup__links landmark-popup__links--none">no linked stretches</div>`;
                marker.bindPopup(
                  `<div class="landmark-popup">` +
                    `<strong class="landmark-popup__name">${safeName}</strong>` +
                    `<div class="landmark-popup__kind">${kind}</div>` +
                    linksHtml +
                    `<div class="landmark-popup__actions">` +
                    `<button type="button" data-action="edit">Edit</button>` +
                    `<button type="button" data-action="delete">Delete</button>` +
                    `</div>` +
                    `</div>`,
                  { closeButton: true, autoClose: true }
                );
                marker.on("popupopen", (e) => {
                  const el = e.popup.getElement();
                  if (!el) return;
                  const editBtn = el.querySelector("[data-action=edit]");
                  const deleteBtn = el.querySelector("[data-action=delete]");
                  if (editBtn) {
                    editBtn.onclick = () => {
                      window.dispatchEvent(
                        new CustomEvent(
                          `${municipality?.slug ?? "bauko"}:landmark-edit`,
                          { detail: feature }
                        )
                      );
                      marker.closePopup();
                    };
                  }
                  if (deleteBtn) {
                    deleteBtn.onclick = () => {
                      // Pass enough info for the listener to find the
                      // entry even if `id` is somehow missing on an
                      // old entry that slipped past the migration —
                      // (lng,lat) + name is unique in practice for
                      // user-placed pins.
                      const coords = feature?.geometry?.coordinates;
                      window.dispatchEvent(
                        new CustomEvent(
                          `${municipality?.slug ?? "bauko"}:landmark-delete`,
                          {
                            detail: {
                              id: props.id,
                              source: props.source,
                              name: props.name,
                              lng: coords?.[0],
                              lat: coords?.[1],
                            },
                          }
                        )
                      );
                      marker.closePopup();
                    };
                  }
                });
              }
              return marker;
            }}
            />
          );
        })()}
        <MapFocus key={`municipality-focus-${municipality?.slug ?? "bauko"}`} feature={baukoFeature} />
        <BarangayFocus
          slug={activeBarangaySlug}
          barangays={data.barangays}
          slugForNameResolver={slugForNameResolver}
          savedView={activeSavedView}
          focusRequestId={focusRequestId}
        />
        <SavedViewportLabel
          name={activeBarangayLabel}
          savedView={activeSavedView}
          visible={!drawMode}
        />

        {layers.outline && baukoFeature && isHybridTileMode(tileMode) && (
          <GeoJSON
            key="municipality-outline-halo"
            data={baukoFeature}
            pane="muni-halo-pane"
            interactive={false}
            style={() => HYBRID_MUNICIPALITY_HALO}
          />
        )}

        {layers.outline && baukoFeature && (
          <GeoJSON
            key="bauko-outline"
            data={baukoFeature}
            pane="muni-pane"
            interactive={false}
            style={() =>
              isHybridTileMode(tileMode)
                ? HYBRID_MUNICIPALITY_STROKE
                : MUNICIPALITY_STROKE
            }
          />
        )}

        {layers.smv && data.barangays && (
          <GeoJSON
            key="smv-fill"
            data={data.barangays}
            pane="smv-pane"
            interactive={false}
            style={(feature) => smvFillStyle(classForFeature(feature))}
          />
        )}

        {layers.zones && !drawMode && displayedZones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-zones-${activeClass?.id ?? "all"}-${printMode ? "print" : "screen"}`}
            data={displayedZones}
            pane="zones-pane"
            // Passive display only. The former hover info card made the map
            // sluggish over dense SMV polygons.
            interactive={false}
            bubblingMouseEvents={false}
            style={(feature) =>
              zoneStyle(
                feature,
                isClassActive ? activeClass : null,
                tileMode,
                municipality?.slug ?? null
              )
            }
            onEachFeature={(feature, layer) => {
              const props = feature?.properties ?? {};
              const parcelClass = normaliseClassKey(props.classification);
              if (isParcelZoneFeature(feature) && parcelClass) {
                layer.bindTooltip(CLASSIFICATION_INFO[parcelClass]?.label ?? parcelClass, {
                  permanent: true,
                  direction: "center",
                  className: "smv-parcel-class-label",
                  opacity: 1,
                });
              }
            }}
          />
        )}
        {showBuildingFootprintsOverlay && (
          <GeoJSON
            key={`building-footprints-${municipality?.slug ?? "bauko"}-${data.osmBuildings.features.length}`}
            data={data.osmBuildings}
            pane="building-footprints-pane"
            interactive={false}
            style={buildingFootprintOverlayStyle}
            onEachFeature={(_, layer) => {
              // Visual reference only. Geoman snapping can still see
              // non-interactive vector layers unless they are explicitly
              // ignored, so keep drawn SMV polygons from sticking to the
              // Overture building footprint vertices.
              layer.options.pmIgnore = true;
              layer.options.snapIgnore = true;
            }}
          />
        )}
        {layers.zones && !drawMode && displayedZones?.features?.length > 0 && (
          <GeoJSON
            key={`commercial-hatch-zones-${activeClass?.id ?? "all"}-${printMode ? "print" : "screen"}`}
            data={displayedZones}
            pane="zones-pane"
            interactive={false}
            style={(feature) =>
              commercialHatchZoneStyle(
                feature,
                isClassActive ? activeClass : null,
                tileMode,
                municipality?.slug ?? null
              )
            }
          />
        )}
        {showMonamonSurRoads && (
          <GeoJSON
            key="monamon-sur-c3-roads"
            data={data.monamonSurRoads}
            pane="roads-pane"
            interactive={false}
            style={() => c3RoadStyle(activeClass?.color, mapZoom)}
          />
        )}

        {showMonamonNorteRoads && (
          <GeoJSON
            key="monamon-norte-c3-roads"
            data={data.monamonNorteRoads}
            pane="roads-pane"
            interactive={false}
            style={() => c3RoadStyle(activeClass?.color, mapZoom)}
          />
        )}

        {layers.barangays && data.barangays && isHybridTileMode(tileMode) && (
          <GeoJSON
            key={`barangay-outline-halos-${drawMode ? "edit" : "view"}`}
            data={data.barangays}
            pane="boundary-halo-pane"
            interactive={false}
            style={() => HYBRID_BARANGAY_HALO}
          />
        )}

        {layers.barangays && data.barangays && (
          <GeoJSON
            key={`barangay-outlines-${drawMode ? "edit" : "view"}`}
            data={data.barangays}
            pane="brgy-pane"
            interactive={!drawMode}
            bubblingMouseEvents={false}
            style={() =>
              isHybridTileMode(tileMode)
                ? HYBRID_BARANGAY_STROKE
                : BARANGAY_STROKE
            }
            onEachFeature={(feature, layer) => {
              if (drawMode) return;
              const name = getBarangayName(feature);
              // Hover-only label. Most basemaps (OSM, Mapbox, Esri)
              // already bake place names into the tile imagery, so a
              // permanent overlay duplicates them — we only show on
              // hover now to confirm boundaries without competing
              // with the baked-in labels.
              layer.bindTooltip(name, {
                sticky: true,
                direction: "center",
                className: "brgy-label",
                opacity: 1,
              });
              layer.on({
                mouseover: (e) => {
                  e.target.setStyle(BARANGAY_STROKE_HOVER);
                  if (e.target.bringToFront) e.target.bringToFront();
                },
                mouseout: (e) =>
                  e.target.setStyle(
                    isHybridTileMode(tileMode)
                      ? HYBRID_BARANGAY_STROKE
                      : BARANGAY_STROKE
                  ),
              });
            }}
          />
        )}

        {/*
          Single-barangay highlight disabled.
          It made the default map feel like some barangays were selected even
          when the user only wanted the full SMV map visible. Keep the helper
          below for now in case we re-enable this as an explicit "focus"
          toggle later.

          {!drawMode && activeFeatureCollection && (
            <GeoJSON
              key={`brgy-highlight-${activeClass?.id ?? "none"}-${activeBarangaySlug}`}
              data={activeFeatureCollection}
              pane="brgy-pane"
              interactive={false}
              style={() => barangayHighlightStyle(activeClass)}
            />
          )}
        */}

        {drawMode && (
          <EditableZones
            key={`editable-zones-${municipality?.slug ?? "bauko"}`}
            visible={drawMode}
            storageKey={municipality?.zones?.storageKey}
            bundledZonesUrl={municipality?.dataFiles?.zones}
            exportFilename={municipality?.zones?.exportFilename}
            saveEventName={municipality?.zones?.eventName}
            saveSlug={municipality?.zones?.saveSlug ?? municipality?.slug}
            savePathLabel={municipality?.zones?.savePathLabel}
            roadsUrl={municipality?.dataFiles?.osmRoads}
            printRoadsUrl={`/data/${municipality?.zones?.saveSlug ?? municipality?.slug ?? "bauko"}_print_roads.geojson`}
            osmBuildingsUrl={municipality?.dataFiles?.osmBuildings}
            frontageBandsUrl={municipality?.dataFiles?.frontageBands}
            showFrontageBands={!!layers?.frontageBands}
            barangaysUrl={municipality?.dataFiles?.barangays}
            customLandmarksUrl={
              municipality?.dataFiles?.customLandmarks ??
              `/data/${municipality?.slug ?? "bauko"}_custom_landmarks.geojson`
            }
            activeStretchKey={activeStretchKey}
            stretchCatalog={stretchCatalog}
            municipalitySlug={municipality?.slug}
            classKeys={municipality?.schedule?.classifications?.map((row) => row?.subClass)}
            onRegisterSaveHandler={registerEditableZonesSaveHandler}
          />
        )}
      </MapContainer>

      {(tileMode === "offline" || tileMode === "offline_mapbox") &&
        !tilesAvailable && (
        <OfflineTilesMissingOverlay
          offlineHintCommand={
            tileMode === "offline_mapbox"
              ? `MAPBOX_TOKEN=... npm run ${
                  municipality?.slug === "bauko"
                    ? "tiles:bauko:mapbox:hires"
                    : "tiles:mp:mapbox:hires"
                }`
              : municipality?.tiles?.offlineHintCommand
          }
        />
      )}

      {isGoogleTileMode && googleTileError && (
        <MapProviderErrorOverlay message={googleTileError} />
      )}
    </div>
  );
}

// Print-only vector basemap styles. The goal is a quiet, neutral
// basemap that lets the SMV color zones dominate — soft blue water,
// near-white buildings with a thin gray stroke, two-tone roads
// (white casing + gray fill) classed by OSM highway tag, and small
// halo-stroked place labels.
function printWaterStyle(feature) {
  const isLine = feature?.geometry?.type === "LineString" ||
    feature?.geometry?.type === "MultiLineString";
  if (isLine) {
    const sub = feature?.properties?.subtype;
    const weight = sub === "river" ? 1.6 : sub === "stream" ? 1.0 : 0.8;
    return {
      color: "#9ec5e8",
      weight,
      opacity: 1,
      fillOpacity: 0,
    };
  }
  return {
    color: "#7eb3dc",
    weight: 0.6,
    opacity: 1,
    fillColor: "#d8eaf6",
    fillOpacity: 1,
  };
}
function printBuildingStyle() {
  return {
    color: "#c8c5bf",
    weight: 0.3,
    opacity: 0.9,
    fillColor: "#ebe8e2",
    fillOpacity: 1,
  };
}
function buildingFootprintOverlayStyle() {
  return {
    color: "#111827",
    weight: 0.75,
    opacity: 0.38,
    fill: false,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}
function parcelOverlayStyle() {
  return {
    color: "#111827",
    weight: 1,
    opacity: 0.88,
    fill: false,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

function smvBoundaryStyle() {
  return {
    color: "#ffffff",
    // Keep the class separator visible without extending noticeably into
    // road corridors where the saved SMV polygon meets the road edge.
    weight: 0.9,
    opacity: 0.98,
    fill: false,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

function smvBoundaryHaloStyle() {
  return {
    color: "#334155",
    weight: 1.35,
    opacity: 0.72,
    fill: false,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}
// Road weight by OSM highway tag. Tuned for A3 print at whole-LGU
// scale — a 1px line at 72 dpi already covers ~50m on the ground at
// this zoom, so anything thicker reads as a kilometer-wide swath.
// Bumping the city-scale Mapnik values down by ~3x.
function highwayWeight(highway) {
  switch (highway) {
    case "trunk":
    case "primary":
      return 1.6;
    case "secondary":
      return 1.2;
    case "tertiary":
      return 0.9;
    case "unclassified":
    case "residential":
      return 0.6;
    case "track":
      return 0.4;
    default:
      return 0.6;
  }
}
// Map an OSM highway tag to a Philippine road tier, mirroring
// lib/print-svg-builder.js so the editor view matches the print
// output. National = trunk/primary, provincial = secondary, barangay
// = unclassified/residential, anything else (tertiary, track, links)
// drops into the neutral "other" tier.
function tierForHighway(highway) {
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
      return "other";
  }
}
const ROAD_TIER_FILL = {
  national: "#fcd34d",
  provincial: "#fb923c",
  barangay: "#ffffff",
  other: "#a8a39b",
};
const ROAD_TIER_CASING = {
  national: "#a16207",
  provincial: "#9a3412",
  barangay: "#bababa",
  other: "#ffffff",
};
function printRoadCasingStyle(feature) {
  const hw = feature?.properties?.highway;
  const w = highwayWeight(hw);
  const tier = tierForHighway(hw);
  // Bridges swap the tier color for black + a thicker casing,
  // matching the print SVG so editor-view stays WYSIWYG.
  const b = feature?.properties?.bridge;
  const isBridge = Boolean(b) && b !== "no";
  return {
    color: isBridge ? "#000000" : ROAD_TIER_CASING[tier],
    weight: isBridge ? w + 1.5 : w + 0.6,
    opacity: 1,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}
function printRoadFillStyle(feature) {
  const hw = feature?.properties?.highway;
  const w = highwayWeight(hw);
  const tier = tierForHighway(hw);
  return {
    color: ROAD_TIER_FILL[tier],
    weight: w,
    opacity: 1,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

function publicOsmRoadWidth(feature, zoom) {
  const z = Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM;
  const scale = z >= 18 ? 4.6 : z >= 17 ? 3.8 : z >= 16 ? 3.1 : z >= 15 ? 2.4 : 1.8;
  return Math.max(1.4, highwayWeight(feature?.properties?.highway) * scale);
}

function publicOsmRoadCasingStyle(feature, zoom) {
  const tier = tierForHighway(feature?.properties?.highway);
  const width = publicOsmRoadWidth(feature, zoom);
  return {
    color: ROAD_TIER_CASING[tier] ?? "#bababa",
    weight: width + 1.6,
    opacity: 0.95,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

function publicOsmRoadFillStyle(feature, zoom) {
  const tier = tierForHighway(feature?.properties?.highway);
  const width = publicOsmRoadWidth(feature, zoom);
  return {
    color: ROAD_TIER_FILL[tier] ?? "#ffffff",
    weight: width,
    opacity: 0.98,
    fillOpacity: 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

// Render place labels as halo-stroked divIcons so the text reads
// over any underlying color (rivers, buildings, road tint).
function printPlaceLabelMarker(feature, latlng) {
  const name = feature?.properties?.name ?? "";
  const place = feature?.properties?.place;
  const fontSize =
    place === "town" ? 14 : place === "village" ? 12 : 10;
  const html =
    `<span class="print-place-label" style="font-size:${fontSize}px; font-weight:500;">` +
    `${escapeHtml(name)}</span>`;
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "print-place-label-wrapper",
      html,
      iconSize: [1, 1],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    keyboard: false,
  });
}

function CommercialHatchDefs({ enabled = true, municipalitySlug = null }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return undefined;
    const classes = ["C-1", "C-2", "C-3", "C-4"];
    let observer = null;

    const ensureDefs = () => {
      const svg = map.getPanes()?.overlayPane?.querySelector("svg");
      if (!svg) return false;
      const ns = "http://www.w3.org/2000/svg";
      let defs = svg.querySelector("defs#smv-commercial-hatch-defs");
      if (!defs) {
        defs = document.createElementNS(ns, "defs");
        defs.setAttribute("id", "smv-commercial-hatch-defs");
        svg.insertBefore(defs, svg.firstChild);
      }

      for (const klass of classes) {
        const id = commercialHatchPatternId(klass);
        let pattern = findSvgElementById(defs, id);
        if (!pattern) {
          pattern = document.createElementNS(ns, "pattern");
          pattern.setAttribute("id", id);
          pattern.setAttribute("patternUnits", "userSpaceOnUse");
          pattern.setAttribute("width", "8");
          pattern.setAttribute("height", "8");
          pattern.setAttribute("patternTransform", "rotate(45)");
          defs.appendChild(pattern);
        }
        pattern.textContent = "";
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", "0");
        line.setAttribute("y1", "0");
        line.setAttribute("x2", "0");
        line.setAttribute("y2", "8");
        line.setAttribute("stroke", commercialHatchColorForClass(klass, municipalitySlug));
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-opacity", "0.45");
        pattern.appendChild(line);
      }
      return true;
    };

    if (!ensureDefs()) {
      observer = new MutationObserver(() => {
        if (ensureDefs()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(map.getPanes().overlayPane, { childList: true, subtree: true });
    }
    map.on("layeradd", ensureDefs);
    map.on("zoomend", ensureDefs);

    return () => {
      observer?.disconnect();
      map.off("layeradd", ensureDefs);
      map.off("zoomend", ensureDefs);
    };
  }, [enabled, map, municipalitySlug]);

  return null;
}

function commercialHatchPatternId(klass) {
  return `smv-commercial-hatch-${String(klass ?? "C").replace(/[^A-Z0-9-]/gi, "-")}`;
}

function findSvgElementById(parent, id) {
  for (const node of parent?.children ?? []) {
    if (node.id === id) return node;
  }
  return null;
}

function classKeysForFeature(feature) {
  const primary = normaliseClassKey(feature?.properties?.classification);
  const secondary = auxClassForFeature(feature, "secondary");
  const tertiary = auxClassForFeature(feature, "tertiary");
  return Array.from(new Set([primary, secondary, tertiary].filter(Boolean)));
}

function residentialClassForFeature(feature, activeKey = null) {
  const classes = classKeysForFeature(feature);
  if (activeKey && isResidentialClass(activeKey) && classes.includes(activeKey)) {
    return activeKey;
  }
  return classes.find(isResidentialClass) ?? null;
}

function commercialClassForFeature(feature, activeKey = null) {
  const classes = classKeysForFeature(feature);
  if (activeKey && isCommercialClass(activeKey) && classes.includes(activeKey)) {
    return activeKey;
  }
  return classes.find(isCommercialClass) ?? null;
}

function solidClassForFeature(feature, activeKey = null) {
  const primary = normaliseClassKey(feature?.properties?.classification);
  const residential = residentialClassForFeature(feature, activeKey);
  if (residential) return residential;
  const classes = classKeysForFeature(feature);
  if (activeKey && classes.includes(activeKey)) return activeKey;
  return primary;
}

function commercialHatchClassForFeature(feature, activeKey = null) {
  const residential = residentialClassForFeature(feature, activeKey);
  const commercial = commercialClassForFeature(feature, activeKey);
  return residential && commercial ? commercial : null;
}

function zoneStyle(feature, _activeClass, tileMode, municipalitySlug = null) {
  // Active-class SMV color highlighting/dimming is disabled. The map should
  // default to the full land-value color plate, even if some navigation/search
  // state still has an active class internally.
  // const activeKey = normaliseClassKey(activeClass?.subClass);
  const activeKey = null;
  // Dual-use features print/read cleaner when residential remains the
  // solid base and commercial is rendered as hatch on top.
  const displayClass = solidClassForFeature(feature, activeKey);
  // municipalitySlug enables LGU-local color overrides via
  // LGU_LOCAL_COLOR_OVERRIDES in lib/classifications.js — so Bauko's
  // C-3 (₱4,030, same value as R-3) paints rose pink in the editor,
  // matching the sidebar chip and the print SVG.
  const base = styleForClass(displayClass, municipalitySlug);
  // Highlight/dim/idle states are disabled: all SMV classes render with
  // the active-strength opacity so no barangay/class looks muted by default.
  let fillOpacity = ACTIVE_SMV_OPACITY;
  // In vector_basemap (WYSIWYG print) mode, paint solid: the pane-
  // level opacity composites the entire SMV layer at 0.7 over the
  // basemap, so per-path fillOpacity has to be 1 or overlapping
  // ribbons would still stack and paint a darker seam.
  if (tileMode === "vector_basemap") fillOpacity = 1;
  return {
    ...base,
    stroke: false,
    weight: 0,
    fillColor: base.fillColor,
    fillOpacity,
  };
}

function commercialHatchZoneStyle(
  feature,
  _activeClass,
  tileMode,
  municipalitySlug = null
) {
  // Active-class hatch highlighting is disabled so joined commercial/
  // residential polygons keep their normal appearance by default.
  // const activeKey = normaliseClassKey(activeClass?.subClass);
  const activeKey = null;
  const hatchClass = commercialHatchClassForFeature(feature, activeKey);
  if (!hatchClass) {
    return {
      stroke: false,
      weight: 0,
      opacity: 0,
      fill: false,
      fillOpacity: 0,
    };
  }

  return {
    stroke: false,
    weight: 0,
    opacity: ACTIVE_SMV_OPACITY,
    fill: true,
    fillColor: `url(#${commercialHatchPatternId(hatchClass)})`,
    fillOpacity: 1,
  };
}

function auxZoneStyle(feature, _activeClass, slot = "secondary", tileMode, municipalitySlug = null) {
  const auxClass = auxClassForFeature(feature, slot);
  if (!auxClass) {
    return {
      stroke: false,
      weight: 0,
      opacity: 0,
      fill: false,
      fillOpacity: 0,
    };
  }

  const s = styleForClass(auxClass, municipalitySlug);
  return {
    stroke: true,
    color: s.color,
    weight: 1.5,
    opacity: ACTIVE_SMV_OPACITY,
    dashArray: undefined,
    lineCap: "round",
    lineJoin: "round",
    fill: false,
    fillOpacity: 0,
  };
}

// Tags the map container with a zoom-tier class so CSS can scale the
// permanent barangay labels (and any other zoom-aware UI) without needing
// to imperatively touch each tooltip on every zoom event.
function ZoomTier() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const update = () => {
      const z = map.getZoom();
      container.classList.remove(
        "zoom-tier-low",
        "zoom-tier-mid",
        "zoom-tier-high"
      );
      if (z <= 12) container.classList.add("zoom-tier-low");
      else if (z <= 14) container.classList.add("zoom-tier-mid");
      else container.classList.add("zoom-tier-high");
    };
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
      container.classList.remove(
        "zoom-tier-low",
        "zoom-tier-mid",
        "zoom-tier-high"
      );
    };
  }, [map]);
  return null;
}

function MapBridge({ onMapReady, editableZonesSaveRef }) {
  const map = useMap();

  useEffect(() => {
    // Dev-only handle for inspecting the map state from the browser
    // console (e.g. window.__leafletMap.getZoom()).
    if (typeof window !== "undefined") {
      window.__leafletMap = map;
    }
    onMapReady?.({
      getView: () => {
        const center = map.getCenter();
        return {
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        };
      },
      flyToView: (view, opts = {}) => {
        if (
          !view ||
          typeof view.lat !== "number" ||
          typeof view.lng !== "number" ||
          typeof view.zoom !== "number"
        )
          return;
        map.flyTo([view.lat, view.lng], view.zoom, {
          duration: 0.6,
          ...opts,
        });
      },
      setViewInstant: (view) => {
        if (
          !view ||
          typeof view.lat !== "number" ||
          typeof view.lng !== "number" ||
          typeof view.zoom !== "number"
        )
          return;
        map.setView([view.lat, view.lng], view.zoom, { animate: false });
      },
      flyToBounds: ([w, s, e, n]) => {
        map.flyToBounds(
          [
            [s, w],
            [n, e],
          ],
          { padding: [60, 60], maxZoom: 16 }
        );
      },
      // Synchronous, no-animation variant. Used by the print flow
      // so we can fit-to-LGU and wait for tiles without racing
      // against flyToBounds' easing animation. Returns the resolved
      // bounds so callers can await tileload before printing.
      fitBoundsInstant: ([w, s, e, n], opts = {}) => {
        map.fitBounds(
          [
            [s, w],
            [n, e],
          ],
          { padding: [10, 10], animate: false, ...opts }
        );
      },
      // Re-measure the Leaflet container. Necessary when the
      // surrounding CSS layout changes (e.g., the .is-printing class
      // adds a legend column that shrinks the map's effective
      // width). Without this, the map renders at the old width and
      // we get blank strips on the right.
      invalidateSize: () => {
        try {
          map.invalidateSize?.();
        } catch {}
      },
      // Returns a promise that resolves when the map's pending tiles
      // have all loaded. Useful as a print-readiness gate.
      whenTilesLoaded: () =>
        new Promise((resolve) => {
          // tileload fires per-tile; we listen for the first "load"
          // event on the active TileLayer instance. A short timeout
          // is the safety net if there are no tiles to load (cached
          // map).
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            resolve();
          };
          let probedLayer = null;
          map.eachLayer((layer) => {
            if (probedLayer) return;
            if (layer instanceof L.TileLayer) {
              probedLayer = layer;
              layer.once("load", done);
            }
          });
          // Safety net: resolve after 1500ms regardless. Common case
          // when tiles were already cached.
          setTimeout(done, 1500);
        }),
      saveEditableZones: (options) => {
        const saveEditableZones = editableZonesSaveRef?.current;
        if (typeof saveEditableZones !== "function") {
          return Promise.resolve({ ok: true, skipped: true });
        }
        return saveEditableZones(options);
      },
    });
    return () => onMapReady?.(null);
  }, [editableZonesSaveRef, map, onMapReady]);

  return null;
}

function SavedViewportLabel({ name, savedView, visible }) {
  const labelIcon = useMemo(
    () =>
      L.divIcon({
        className: "saved-view-label-anchor",
        html: `<span class="saved-view-label">${escapeHtml(name)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    [name]
  );

  const valid =
    visible &&
    !!name &&
    Number.isFinite(savedView?.lat) &&
    Number.isFinite(savedView?.lng);
  if (!valid) return null;

  return (
    <Marker
      position={[savedView.lat, savedView.lng]}
      icon={labelIcon}
      interactive={false}
      keyboard={false}
      pane="brgy-pane"
    />
  );
}

function MapZoomBridge({ onZoomChange }) {
  const map = useMap();

  useEffect(() => {
    const emit = () => onZoomChange?.(map.getZoom());
    emit();
    map.on("zoomend", emit);
    return () => map.off("zoomend", emit);
  }, [map, onZoomChange]);

  return null;
}

function c3RoadStyle(color, zoom) {
  const z = Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM;
  const weight = z >= 16 ? 6 : z >= 15 ? 5 : z >= 14 ? 4 : z >= 13 ? 3 : 2;
  return {
    color: color ?? "#ef4444",
    weight,
    opacity: ACTIVE_SMV_OPACITY,
    lineCap: "round",
    lineJoin: "round",
  };
}

function normaliseClassKey(value) {
  const key = String(value ?? "")
    .trim()
    .toUpperCase();
  return key || null;
}

function auxClassForFeature(feature, slot = "secondary") {
  const props = feature?.properties ?? {};
  if (slot === "secondary") {
    return normaliseClassKey(
      props.secondary_classification ??
        props.secondaryClassification ??
        props.secondary ??
        props.classification_secondary ??
        props.classification_2 ??
        props.classification2
    );
  }
  return normaliseClassKey(
    props.tertiary_classification ??
      props.tertiaryClassification ??
      props.tertiary ??
      props.classification_tertiary ??
      props.classification_3 ??
      props.classification3
  );
}

function isImageryTileMode(tileMode) {
  return (
    tileMode === "satellite" ||
    tileMode === "mapbox_hybrid" ||
    tileMode === "google_hybrid" ||
    tileMode === "offline_mapbox"
  );
}

function isHybridTileMode(tileMode) {
  return tileMode === "mapbox_hybrid" || tileMode === "google_hybrid";
}

function humanizeSlug(slug) {
  return String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function landmarkLabelMarker(feature, latlng, options = {}) {
  const props = feature?.properties || {};
  const kind = normalizeLandmarkKind(props.kind);
  const name = escapeHtml(props.name || "");
  return L.marker(latlng, {
    icon: L.divIcon({
      html:
        `<span class="custom-pin custom-pin--${kind}"><span class="custom-pin-symbol">${landmarkIconMarkup(kind)}</span></span>` +
        `<span class="custom-pin-name">${name}</span>`,
      className: options.className || "custom-landmark",
      iconSize: [0, 0],
      iconAnchor: [9, 9],
    }),
    interactive: Boolean(options.interactive),
    keyboard: Boolean(options.interactive),
    pane: options.pane || "pois-pane",
  });
}

// Pan + zoom to the single active barangay. Uses a fixed target zoom
// (each step lands at the same scale, like a slideshow) and pans the
// centroid into the *map area* — which is the viewport minus the right-
// docked sidebar (380px), so we offset the centroid slightly left.
const FOCUS_ZOOM = 16; // tweak to taste (15 = wide context, 17 = tight)
const SIDEBAR_OFFSET_PX = 190; // ~half the sidebar so polygon sits centered in the visible map area

function BarangayFocus({
  slug,
  barangays,
  slugForNameResolver,
  savedView,
  focusRequestId = 0,
}) {
  const map = useMap();
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (!slug || !barangays) {
      lastKeyRef.current = "";
      return;
    }
    const viewKey = savedView
      ? `${savedView.lat}:${savedView.lng}:${savedView.zoom}`
      : "default";
    const focusKey = `${slug}|${viewKey}|${focusRequestId}`;
    if (lastKeyRef.current === focusKey) return;

    if (
      savedView &&
      typeof savedView.lat === "number" &&
      typeof savedView.lng === "number" &&
      typeof savedView.zoom === "number"
    ) {
      map.flyTo([savedView.lat, savedView.lng], savedView.zoom, {
        duration: 0.75,
      });
      lastKeyRef.current = focusKey;
      return;
    }

    const features = featuresForSlug(slug, barangays, slugForNameResolver);
    if (features.length === 0) return;
    const bbox = featureCollectionBbox(features);
    if (!bbox) return;

    // Centroid of the feature(s).
    const [w, s, e, n] = bbox;
    const lat = (s + n) / 2;
    const lng = (w + e) / 2;

    // Offset target so the centroid lands left-of-center, leaving the
    // right side clear for the sidebar. Convert pixel offset to lat/lng
    // at the target zoom.
    const targetPoint = map.project([lat, lng], FOCUS_ZOOM);
    targetPoint.x += SIDEBAR_OFFSET_PX;
    const adjusted = map.unproject(targetPoint, FOCUS_ZOOM);

    map.flyTo(adjusted, FOCUS_ZOOM, { duration: 0.75 });
    lastKeyRef.current = focusKey;
  }, [map, slug, barangays, slugForNameResolver, savedView, focusRequestId]);

  return null;
}

// Style for the spotlit barangay: ring only, no fill. The class color is
// already represented in the sidebar; the polygon stroke here is just
// spatial wayfinding.
function barangayHighlightStyle(activeClass) {
  const color = activeClass?.color ?? "#1d4ed8";
  return {
    color,
    weight: 4,
    opacity: ACTIVE_SMV_OPACITY,
    fill: false,
    fillOpacity: 0,
  };
}

function featuresForSlug(slug, barangaysFC, slugForNameResolver) {
  if (!slug || !barangaysFC?.features) return [];
  const resolveSlug =
    typeof slugForNameResolver === "function"
      ? slugForNameResolver
      : (name) =>
          String(name ?? "")
            .replace(/\s*\([^)]*\)\s*$/, "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-");
  return barangaysFC.features.filter(
    (f) => resolveSlug(getBarangayName(f)) === slug
  );
}

function MapFocus({ feature }) {
  const map = useMap();
  const hasFit = useRef(false);

  useEffect(() => {
    if (!feature?.geometry || hasFit.current) return;
    const [w, s, e, n] = featureBbox(feature);
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [34, 34], maxZoom: 13 }
    );
    hasFit.current = true;
  }, [feature, map]);

  return null;
}

function OfflineTilesMissingOverlay({ offlineHintCommand = "npm run tiles:bauko" }) {
  return (
    <div className="offline-missing">
      <div className="offline-missing__card">
        <h2>Offline tiles are not downloaded yet</h2>
        <p>
          Run <code>{offlineHintCommand}</code> while online, then reload this
          page. You can also switch to Online in the top-right nav.
        </p>
      </div>
    </div>
  );
}

function MapProviderErrorOverlay({ message }) {
  return (
    <div className="offline-missing">
      <div className="offline-missing__card">
        <h2>Map provider could not load</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

function getBarangayName(feature) {
  const props = feature?.properties ?? {};
  const raw =
    props.name ??
    props.NAME_3 ??
    props.Barangay ??
    props.BARANGAY ??
    props.Brgy_Name ??
    props.BRGY_NAME ??
    props.ADM4_EN ??
    props.ADM3_EN ??
    props.NAME;
  return raw ? String(raw).trim() : "Unnamed barangay";
}

function featureBbox(feature) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (coords) => {
    if (typeof coords?.[0] === "number" && typeof coords?.[1] === "number") {
      const [lon, lat] = coords;
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
      return;
    }
    for (const child of coords ?? []) visit(child);
  };
  visit(feature?.geometry?.coordinates);
  return [west, south, east, north];
}

function featureCollectionBbox(features) {
  if (!features.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of features) {
    const [w, s, e, n] = featureBbox(feature);
    west = Math.min(west, w);
    south = Math.min(south, s);
    east = Math.max(east, e);
    north = Math.max(north, n);
  }
  return [west, south, east, north];
}

function lonToTile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  );
}
