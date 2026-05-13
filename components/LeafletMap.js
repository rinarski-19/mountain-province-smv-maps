"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// Side-effect import: must run before any L.Map is constructed so Geoman's
// initHook registers on the prototype.
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import {
  classForFeature,
  smvFillStyle,
  styleForClass,
} from "@/lib/classifications";
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

const BARANGAY_STROKE = {
  color: "#475569",
  weight: 1,
  opacity: 0.85,
  fillOpacity: 0,
};
const BARANGAY_STROKE_HOVER = {
  color: "#1d4ed8",
  weight: 3,
  opacity: 1,
  fillOpacity: 0,
};
const MUNICIPALITY_STROKE = {
  color: "#111827",
  weight: 2.5,
  opacity: 1,
  fillOpacity: 0,
};

const TILE_SOURCES = {
  online: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  offline: {
    url: "/tiles/{z}/{x}/{y}.png",
    attribution:
      '&copy; OSM data — locally cached. Run <code>npm run tiles:bauko</code> to populate.',
    maxNativeZoom: 16,
    maxZoom: 18,
  },
};

const EMPTY_FC = { type: "FeatureCollection", features: [] };
const C1_HATCH_ID = "bauko-c1-smv-hatch";
const ACTIVE_SMV_OPACITY = 0.7;

export default function LeafletMap({
  drawMode,
  tileMode,
  activeClass,
  activeBarangaySlug,
  savedBarangayViews,
  focusRequestId = 0,
  layers,
  onDataChange,
  onMapReady,
  municipality,
}) {
  const [tilesAvailable, setTilesAvailable] = useState(true);
  const [mapZoom, setMapZoom] = useState(null);
  const [data, setData] = useState({
    bauko: null,
    barangays: null,
    zones: null,
    valuations: null,
    monamonSurRoads: null,
    monamonNorteRoads: null,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sources = await fetch("/data/sources.json")
          .then((r) => r.json())
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
        const barangayFile =
          sources.has_custom_barangays && customBarangaysFile
            ? customBarangaysFile
            : defaultBarangaysFile;
        const [
          bauko,
          barangays,
          valuations,
          zones,
          monamonSurRoads,
          monamonNorteRoads,
        ] = await Promise.all([
          fetch(outlineFile).then((r) => r.json()),
          fetch(barangayFile).then((r) => r.json()),
          fetch(valuationsFile).then((r) => r.json()),
          sources.has_zones && zonesFile
            ? fetch(zonesFile).then((r) => r.json())
            : Promise.resolve(EMPTY_FC),
          municipality?.slug === "bauko"
            ? fetch("/data/bauko_monamon_sur_roads_highlight.geojson")
                .then((r) => (r.ok ? r.json() : EMPTY_FC))
                .catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
          municipality?.slug === "bauko"
            ? fetch("/data/bauko_monamon_norte_roads_highlight.geojson")
                .then((r) => (r.ok ? r.json() : EMPTY_FC))
                .catch(() => EMPTY_FC)
            : Promise.resolve(EMPTY_FC),
        ]);
        if (!active) return;
        setData({
          bauko,
          barangays,
          valuations,
          zones,
          monamonSurRoads,
          monamonNorteRoads,
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
    onDataChange?.(data);
  }, [data, onDataChange]);

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
        const res = await fetch(
          `/tiles/${z}/${lonToTile(lon, z)}/${latToTile(lat, z)}.png`,
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
  }, [data.bauko]);

  const tile = TILE_SOURCES[tileMode] ?? TILE_SOURCES.offline;
  const baukoFeature = data.bauko?.features?.[0] ?? null;
  const center = municipality?.map?.center ?? DEFAULT_CENTER;
  const defaultZoom = municipality?.map?.defaultZoom ?? DEFAULT_ZOOM;
  const slugForNameResolver = municipality?.schedule?.slugForName;

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
  const activeSavedView = activeBarangaySlug
    ? savedBarangayViews?.[activeBarangaySlug] ?? null
    : null;
  const activeBarangayLabel = useMemo(() => {
    if (!activeBarangaySlug) return "";
    const features = activeFeatureCollection?.features ?? [];
    if (features.length) return getBarangayName(features[0]);
    return humanizeSlug(activeBarangaySlug);
  }, [activeBarangaySlug, activeFeatureCollection]);

  const isClassActive = Boolean(activeClass);
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

  return (
    <div className="leaflet-shell">
      <svg className="svg-pattern-defs" aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id={C1_HATCH_ID}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="#c63b24" opacity="0.18" />
            <path
              d="M 0 0 L 0 6"
              stroke="#c63b24"
              strokeWidth="2"
              opacity="0.9"
            />
          </pattern>
        </defs>
      </svg>
      <MapContainer
        center={center}
        zoom={defaultZoom}
        scrollWheelZoom
        zoomControl={false}
        className="consultation-map"
      >
        <MapBridge onMapReady={onMapReady} />
        <MapZoomBridge onZoomChange={setMapZoom} />
        <ZoomTier />
        <TileLayer
          key={tileMode}
          url={tile.url}
          attribution={tile.attribution}
          maxZoom={tile.maxZoom}
          maxNativeZoom={tile.maxNativeZoom}
        />

        <Pane name="smv-pane" style={{ zIndex: 425 }} />
        <Pane name="muni-pane" style={{ zIndex: 430 }} />
        <Pane name="zones-pane" style={{ zIndex: 440 }} />
        <Pane name="roads-pane" style={{ zIndex: 445 }} />
        <Pane name="brgy-pane" style={{ zIndex: 450 }} />
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

        {layers.outline && baukoFeature && (
          <GeoJSON
            key="bauko-outline"
            data={baukoFeature}
            pane="muni-pane"
            interactive={false}
            style={() => MUNICIPALITY_STROKE}
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

        {layers.zones && !drawMode && data.zones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-zones-${activeClass?.id ?? "all"}`}
            data={data.zones}
            pane="zones-pane"
            interactive={false}
            style={(feature) => zoneStyle(feature, isClassActive ? activeClass : null)}
          />
        )}
        {layers.zones && !drawMode && data.zones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-zones-secondary-${activeClass?.id ?? "all"}`}
            data={data.zones}
            pane="zones-pane"
            interactive={false}
            style={(feature) =>
              auxZoneStyle(feature, isClassActive ? activeClass : null, "secondary")
            }
          />
        )}
        {layers.zones && !drawMode && data.zones?.features?.length > 0 && (
          <GeoJSON
            key={`smv-zones-tertiary-${activeClass?.id ?? "all"}`}
            data={data.zones}
            pane="zones-pane"
            interactive={false}
            style={(feature) =>
              auxZoneStyle(feature, isClassActive ? activeClass : null, "tertiary")
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

        {layers.barangays && data.barangays && (
          <GeoJSON
            key={`barangay-outlines-${drawMode ? "edit" : "view"}`}
            data={data.barangays}
            pane="brgy-pane"
            interactive={!drawMode}
            bubblingMouseEvents={false}
            style={() => BARANGAY_STROKE}
            onEachFeature={(feature, layer) => {
              if (drawMode) return;
              const name = getBarangayName(feature);
              // Permanent label — stays visible at every zoom level. The
              // CSS pairs with .zoom-tier-* on the map container so it
              // scales legibly without needing per-feature recalculations.
              layer.bindTooltip(name, {
                permanent: true,
                direction: "center",
                className: "brgy-label",
                opacity: 1,
              });
              layer.on({
                mouseover: (e) => {
                  e.target.setStyle(BARANGAY_STROKE_HOVER);
                  if (e.target.bringToFront) e.target.bringToFront();
                },
                mouseout: (e) => e.target.setStyle(BARANGAY_STROKE),
              });
            }}
          />
        )}

        {/* Single-barangay highlight: ring only, in the active class color.
            Re-keyed per (class, slug) so Leaflet rebuilds cleanly. */}
        {!drawMode && activeFeatureCollection && (
          <GeoJSON
            key={`brgy-highlight-${activeClass?.id ?? "none"}-${activeBarangaySlug}`}
            data={activeFeatureCollection}
            pane="brgy-pane"
            interactive={false}
            style={() => barangayHighlightStyle(activeClass)}
          />
        )}

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
          />
        )}
      </MapContainer>

      {tileMode === "offline" && !tilesAvailable && (
        <OfflineTilesMissingOverlay
          offlineHintCommand={municipality?.tiles?.offlineHintCommand}
        />
      )}
    </div>
  );
}

function zoneStyle(feature, activeClass) {
  const primary = normaliseClassKey(feature?.properties?.classification);
  const secondary = auxClassForFeature(feature, "secondary");
  const tertiary = auxClassForFeature(feature, "tertiary");
  const activeKey = normaliseClassKey(activeClass?.subClass);
  const isMatching = Boolean(
    activeKey &&
      (activeKey === primary ||
        activeKey === secondary ||
        activeKey === tertiary)
  );
  // For dual-class features, if the currently active class matches either
  // primary or secondary, paint this polygon in the active class color so the
  // user can "read" overlap classes during walkthrough.
  const displayClass = isMatching && activeKey ? activeKey : primary;
  const base = styleForClass(displayClass);
  const isC1 = displayClass === "C-1";
  // Three states:
  //  - No class active → resting opacity (1 for C-1's hatch, 0.5 otherwise).
  //  - Class active and this polygon matches → 100% opaque so it pops.
  //  - Class active and this polygon does NOT match → muted way down.
  let fillOpacity;
  if (!activeKey) fillOpacity = isC1 ? 1 : 0.5;
  else if (isMatching) fillOpacity = ACTIVE_SMV_OPACITY;
  else fillOpacity = isC1 ? 0.18 : 0.12;
  return {
    ...base,
    stroke: false,
    weight: 0,
    fillColor: isC1 ? `url(#${C1_HATCH_ID})` : base.fillColor,
    fillOpacity,
  };
}

function auxZoneStyle(feature, activeClass, slot = "secondary") {
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

  const activeKey = normaliseClassKey(activeClass?.subClass);
  const isActiveAux = Boolean(activeKey && activeKey === auxClass);
  const isOtherWhenActive = Boolean(activeKey && !isActiveAux);
  const s = styleForClass(auxClass);
  const isTertiary = slot === "tertiary";

  return {
    stroke: true,
    color: s.color,
    weight: isActiveAux ? (isTertiary ? 2.6 : 3) : isOtherWhenActive ? 1 : 1.5,
    opacity: isActiveAux
      ? ACTIVE_SMV_OPACITY
      : isOtherWhenActive
        ? 0.18
        : isTertiary
          ? 0.35
          : 0.42,
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

function MapBridge({ onMapReady }) {
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
      flyToBounds: ([w, s, e, n]) => {
        map.flyToBounds(
          [
            [s, w],
            [n, e],
          ],
          { padding: [60, 60], maxZoom: 16 }
        );
      },
    });
    return () => onMapReady?.(null);
  }, [map, onMapReady]);

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
// already represented in the bottom bar / sidebar; the polygon stroke
// here is just spatial wayfinding.
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
