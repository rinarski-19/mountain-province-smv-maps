"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map from "@/components/Map";
import MapPanel from "@/components/MapPanel";
import PrintLegend from "@/components/PrintLegend";
import PrintPanel from "@/components/PrintPanel";
import UnlockDialog from "@/components/UnlockDialog";
import { useAccess } from "@/components/AccessContext";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { getMunicipalityConfig, MUNICIPALITY_OPTIONS } from "@/lib/municipalities";
import { basePrintSlug } from "@/lib/print-slugs";
import { mergeClassifications } from "@/lib/added-classes";
import { setClassColorOverrides } from "@/lib/classifications";
import { setPrintThemeOverrides } from "@/lib/print-theme";
import { IS_CLIENT_FACING } from "@/lib/runtime-mode";

const BARANGAY_VIEW_PRESETS_KEY_PREFIX = "smv-barangay-view-v1:";
// Per-stretch saved viewports. Keyed by `${classId}|${barangaySlug}|${stretchIdx}`
// where stretchIdx is the index within the flat stretches list for that
// (class, barangay) pair. Falls back to the barangay-level view when
// no stretch-specific view has been saved.
const STRETCH_VIEW_PRESETS_KEY_PREFIX = "smv-stretch-view-v1:";

function featureCollectionBbox(featureCollection) {
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
  for (const feature of featureCollection?.features || []) {
    visit(feature?.geometry?.coordinates);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

const HAS_MAPBOX_TOKEN = Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
const HAS_GOOGLE_MAPS_API_KEY = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
const GOOGLE_TILE_MODES = ["google_street", "google_hybrid"];
const SELECTABLE_TILE_MODES = new Set(
  IS_CLIENT_FACING
    ? GOOGLE_TILE_MODES
    : [
        "online",
        "vector_basemap",
        ...(HAS_GOOGLE_MAPS_API_KEY ? GOOGLE_TILE_MODES : []),
        ...(HAS_MAPBOX_TOKEN ? ["mapbox_hybrid"] : []),
      ]
);

const CLIENT_FACING_DEFAULT_TILE_MODE = "google_street";
const WORKSPACE_DEFAULT_TILE_MODE = "online";

function getProjectDefaultTileMode() {
  return IS_CLIENT_FACING ? CLIENT_FACING_DEFAULT_TILE_MODE : WORKSPACE_DEFAULT_TILE_MODE;
}

function normalizeTileMode(mode) {
  return SELECTABLE_TILE_MODES.has(mode) ? mode : getProjectDefaultTileMode();
}

function getDefaultTileModeForMunicipality(municipality) {
  return normalizeTileMode(
    municipality?.tiles?.defaultTileMode ?? getProjectDefaultTileMode()
  );
}

export default function Home() {
  const mapApiRef = useRef(null);
  const [drawMode, setDrawMode] = useState(false);
  const [autoPrintRequested, setAutoPrintRequested] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [printPreparing, setPrintPreparing] = useState(false);
  const [printPanelOpen, setPrintPanelOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  // canEdit is the password lock, not the build mode: an unlocked user
  // gets the drawing tools and the print workbench even on the public
  // read-only deployment. See components/AccessContext.js.
  const { canEdit } = useAccess();
  // Client-facing read-only maps open on Google Streets when configured.
  // The editing/workspace version stays on Online OSM unless an LGU profile
  // overrides the default (for example the Bauko print/vector profile).
  const [tileMode, setTileMode] = useState(() => getProjectDefaultTileMode());
  // Always start from "bauko" so the first server render and the first
  // client render match (no hydration mismatch). The URL slug is read
  // from window.location.search in a post-mount effect below — that
  // upgrade happens after hydration is committed, so React just runs
  // it as a normal state update.
  const [municipalitySlug, setMunicipalitySlug] = useState("bauko");
  const [classIdx, setClassIdx] = useState(null); // null = idle
  const [groupIdx, setGroupIdx] = useState(0);
  const [barangayIdx, setBarangayIdx] = useState(0);
  const [mapData, setMapData] = useState({
    bauko: null,
    barangays: null,
    zones: null,
    valuations: null,
  });
  const [layers, setLayers] = useState({
    outline: true,
    barangays: true,
    zones: true,
    smv: false,
    parcels: true,
    // Client-facing maps should show the building context automatically.
    // Workspace/editor maps keep it off until explicitly needed because
    // footprints can be tens of thousands of SVG polygons.
    buildings: IS_CLIENT_FACING,
    // Off by default — it's a guide for editors, not a consultation
    // overlay. Editors flip it on from the Layers panel while drawing.
    frontageBands: false,
    // Provider POIs generated from Google Places / OSM into
    // public/data/<slug>_landmarks.geojson.
    providerPois: true,
    // LGU/editor-authored pins from public/data/<slug>_custom_landmarks.geojson
    // and local in-app landmark edits. Off by default because these are the
    // larger callout-style landmarks; enable from the map panel when needed.
    customLandmarks: false,
  });
  const [savedBarangayViews, setSavedBarangayViews] = useState({});
  const [savedStretchViews, setSavedStretchViews] = useState({});
  // Which stretch (sub-item) under the active barangay is currently
  // selected. Null when no stretch is picked — falls back to the
  // barangay-level view behaviour.
  const [activeStretchIdx, setActiveStretchIdx] = useState(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  // The editable SMV palette is province-wide and lives in one file.
  // Fetch it once, push it into the shared resolver every surface reads
  // (lib/classifications.js), then bump the version so the map repaints.
  const [paletteVersion, setPaletteVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/palette", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data) return;
        const hasColors = Object.keys(data.colors ?? {}).length > 0;
        const hasTheme = Object.keys(data.theme ?? {}).length > 0;
        if (!hasColors && !hasTheme) return;
        setClassColorOverrides(data.colors ?? {});
        setPrintThemeOverrides(data.theme ?? {});
        setPaletteVersion((n) => n + 1);
      } catch {
        // Offline or static export — the stock palette is a fine default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Applied by the print panel the moment a palette is published, so the
  // map agrees with the sheet without a reload.
  // Re-fetch the class list after the panel publishes, so a newly added
  // class becomes drawable without a reload.
  const handleClassesChange = useCallback((next) => {
    setClassEdits({
      classes: next?.classes ?? [],
      removed: next?.removed ?? [],
    });
  }, []);

  const handlePaletteChange = useCallback((next) => {
    // Accepts { colors, theme }; the theme half used to be dropped here,
    // so road and basemap edits never reached the screen.
    setClassColorOverrides(next?.colors ?? {});
    setPrintThemeOverrides(next?.theme ?? {});
    setPaletteVersion((n) => n + 1);
  }, []);

  const municipality = useMemo(
    () => getMunicipalityConfig(municipalitySlug),
    [municipalitySlug]
  );
  const schedule = municipality.schedule;
  const viewSlug = municipality.ui?.viewSlug ?? municipality.slug;
  const viewPresetsKey = `${BARANGAY_VIEW_PRESETS_KEY_PREFIX}${viewSlug}`;
  const stretchViewPresetsKey = `${STRETCH_VIEW_PRESETS_KEY_PREFIX}${viewSlug}`;
  // Classes this LGU added, and official ones it has withdrawn. Merged
  // here so the sidebar, the drawing toolbar and the print legend all see
  // the same list — see lib/added-classes.js.
  const [classEdits, setClassEdits] = useState({ classes: [], removed: [] });
  useEffect(() => {
    let cancelled = false;
    setClassEdits({ classes: [], removed: [] });
    (async () => {
      try {
        const res = await fetch(`/api/classes/${basePrintSlug(municipalitySlug)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.ok) return;
        setClassEdits({ classes: data.classes ?? [], removed: data.removed ?? [] });
      } catch {
        // Offline or static export — the transcribed schedule stands alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [municipalitySlug]);

  // The sidebar's two ladders are `schedule.commercial` /
  // `schedule.residential` upstream, which are filtered from the raw
  // transcription — so added classes never appeared there and withdrawn
  // ones never left. Derive them from the merged list instead, which is
  // what the toolbar and the printed legend already use.
  const classifications = useMemo(
    () =>
      mergeClassifications(
        schedule.classifications,
        classEdits.classes,
        classEdits.removed
      ),
    [schedule.classifications, classEdits]
  );
  const sidebarCommercial = useMemo(
    () => classifications.filter((c) => c.category === "commercial"),
    [classifications]
  );
  const sidebarResidential = useMemo(
    () => classifications.filter((c) => c.category === "residential"),
    [classifications]
  );
  const total = classifications.length;
  const active = classIdx != null ? classifications[classIdx] : null;
  const activeGroup = active
    ? active.locationGroups[Math.min(groupIdx, active.locationGroups.length - 1)]
    : null;
  const activeBarangaySlug = activeGroup
    ? activeGroup.barangays[Math.min(barangayIdx, activeGroup.barangays.length - 1)] ?? null
    : null;

  // Step forward: barangay → group → class. Wraps to first class after the last.
  const stepForward = useCallback(() => {
    if (classIdx == null) {
      setClassIdx(0);
      setGroupIdx(0);
      setBarangayIdx(0);
      setFocusRequestId((n) => n + 1);
      return;
    }
    const cls = classifications[classIdx];
    const group = cls.locationGroups[groupIdx];
    if (barangayIdx < group.barangays.length - 1) {
      setBarangayIdx(barangayIdx + 1);
    } else if (groupIdx < cls.locationGroups.length - 1) {
      setGroupIdx(groupIdx + 1);
      setBarangayIdx(0);
    } else {
      const next = (classIdx + 1) % total;
      setClassIdx(next);
      setGroupIdx(0);
      setBarangayIdx(0);
    }
    setFocusRequestId((n) => n + 1);
  }, [classIdx, groupIdx, barangayIdx, total, classifications]);

  // Step backward: barangay → previous group's last barangay → previous class's last group/last barangay.
  const stepBackward = useCallback(() => {
    if (classIdx == null) {
      const last = total - 1;
      const cls = classifications[last];
      setClassIdx(last);
      setGroupIdx(cls.locationGroups.length - 1);
      setBarangayIdx(
        cls.locationGroups[cls.locationGroups.length - 1].barangays.length - 1
      );
      setFocusRequestId((n) => n + 1);
      return;
    }
    const cls = classifications[classIdx];
    if (barangayIdx > 0) {
      setBarangayIdx(barangayIdx - 1);
    } else if (groupIdx > 0) {
      const prev = cls.locationGroups[groupIdx - 1];
      setGroupIdx(groupIdx - 1);
      setBarangayIdx(prev.barangays.length - 1);
    } else {
      const prevIdx = (classIdx - 1 + total) % total;
      const prev = classifications[prevIdx];
      const lastGroup = prev.locationGroups[prev.locationGroups.length - 1];
      setClassIdx(prevIdx);
      setGroupIdx(prev.locationGroups.length - 1);
      setBarangayIdx(lastGroup.barangays.length - 1);
    }
    setFocusRequestId((n) => n + 1);
  }, [classIdx, groupIdx, barangayIdx, total, classifications]);

  const clear = useCallback(() => {
    setClassIdx(null);
    setGroupIdx(0);
    setBarangayIdx(0);
  }, []);

  // Click a class in the sidebar → focus its first group + first barangay.
  // Clicking the already-active class toggles it closed (clears selection)
  // so parent rows feel responsive as an accordion control.
  const selectClass = useCallback(
    (id) => {
      if (id == null) {
        clear();
        return;
      }
      if (active?.id === id) {
        clear();
        return;
      }
      const i = classifications.findIndex((c) => c.id === id);
      if (i < 0) return;
      setClassIdx(i);
      setGroupIdx(0);
      setBarangayIdx(0);
      setFocusRequestId((n) => n + 1);
    },
    [active?.id, clear, classifications]
  );

  // Click a specific barangay under a class → jump to the first group inside
  // that class which contains the slug.
  const selectClassBarangay = useCallback((classId, slug) => {
    const i = classifications.findIndex((c) => c.id === classId);
    if (i < 0) return;
    const cls = classifications[i];
    for (let g = 0; g < cls.locationGroups.length; g++) {
      const b = cls.locationGroups[g].barangays.indexOf(slug);
      if (b >= 0) {
        setClassIdx(i);
        setGroupIdx(g);
        setBarangayIdx(b);
        setFocusRequestId((n) => n + 1);
        return;
      }
    }
  }, [classifications]);

  // Keep older sessions/configs from landing on tile modes that are no
  // longer exposed in the shared selector.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTileMode((mode) => normalizeTileMode(mode));
  }, []);

  useEffect(() => {
    document.body.classList.toggle("draw-mode-on", drawMode);
    document.body.classList.toggle("draw-mode-off", !drawMode);
    return () => {
      document.body.classList.remove("draw-mode-on", "draw-mode-off");
    };
  }, [drawMode]);

  // After hydration, upgrade the municipality from the URL `?m=<slug>`
  // if it points at an enabled municipality. Done in an effect (not in
  // useState's initializer) so the SSR-rendered HTML matches the first
  // client render — no hydration mismatch even when /?m=tadian is the
  // entry URL. Runs once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("m");
    if (params.get("print") === "1") {
      setAutoPrintRequested(true);
    }
    if (!fromUrl) return;
    const match = MUNICIPALITY_OPTIONS.find(
      (option) => option.slug === fromUrl && option.enabled
    );
    if (match && match.slug !== municipalitySlug) {
      setMunicipalitySlug(match.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching municipalities should reset the slideshow walkthrough so
  // a stale (classIdx, groupIdx, barangayIdx) from a longer schedule
  // doesn't index past the end of the new municipality's classes.
  // It should also reset the basemap to the LGU's default (or the scoped
  // project default if the LGU doesn't override).
  // Users can override per-session via the gear-icon tile picker.
  useEffect(() => {
    setClassIdx(null);
    setGroupIdx(0);
    setBarangayIdx(0);
    const defaultTile = getDefaultTileModeForMunicipality(municipality);
    setTileMode(defaultTile);
    setLayers((current) => ({
      ...current,
      frontageBands: Boolean(municipality?.ui?.defaultFrontageBands),
      providerPois: true,
      customLandmarks: false,
    }));
  }, [
    municipalitySlug,
    municipality?.tiles?.defaultTileMode,
    municipality?.ui?.defaultFrontageBands,
  ]);

  // Per-municipality saved map views, two sources, in order of
  // priority:
  //   1. public/data/<slug>_saved_views.json  (shipped with the
  //      static export, so the offline build at the venue laptop
  //      gets exactly what the author published)
  //   2. localStorage                          (per-browser working
  //      drafts; covers the live editor session between publishes)
  // The merge prefers the file when an entry exists in both, since
  // the file is the canonical record. When the user saves a new
  // view, we write to localStorage immediately AND push to the file
  // via /api/views/save (debounced).
  // What we last sent to (or loaded from) the server, per LGU. Seeded by
  // the loader below so that merely LOADING views — or unlocking, which
  // re-runs the publish effect — never counts as a change to publish.
  // Only a genuine local edit produces a payload that differs from this.
  const lastPublishedViewsRef = useRef({});
  // Which LGU the saved-view STATE currently belongs to. The publish
  // effect below depends on viewSlug, so when the user switches LGU it
  // runs with the previous LGU's views against the new slug — which
  // published Bauko's views as Sadanga's, and from a fresh browser
  // profile published an empty map over good data, truncating three
  // published files during testing. Publishing waits for the loader to
  // say the state matches the slug.
  const loadedViewSlugRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    loadedViewSlugRef.current = null;
    (async () => {
      let fromFile = { barangays: {}, stretches: {} };
      try {
        const res = await fetch(`/data/${viewSlug}_saved_views.json`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          if (json && typeof json === "object") {
            fromFile = {
              barangays: json.barangays ?? {},
              stretches: json.stretches ?? {},
            };
          }
        }
      } catch {
        // File missing or unreadable, that's fine, fall through to
        // localStorage-only. The offline static export will show
        // whatever was published at build time.
      }
      let fromLocal = { barangays: {}, stretches: {} };
      try {
        const rawB = localStorage.getItem(viewPresetsKey);
        const rawS = localStorage.getItem(stretchViewPresetsKey);
        fromLocal = {
          barangays: rawB ? JSON.parse(rawB) || {} : {},
          stretches: rawS ? JSON.parse(rawS) || {} : {},
        };
      } catch {}
      if (cancelled) return;
      // File wins on overlap, localStorage fills in everything the
      // file doesn't have yet.
      const barangays = { ...fromLocal.barangays, ...fromFile.barangays };
      const stretches = { ...fromLocal.stretches, ...fromFile.stretches };
      lastPublishedViewsRef.current[viewSlug] = JSON.stringify({
        barangays,
        stretches,
      });
      loadedViewSlugRef.current = viewSlug;
      setSavedBarangayViews(barangays);
      setSavedStretchViews(stretches);
    })();
    return () => {
      cancelled = true;
    };
  }, [viewSlug, viewPresetsKey, stretchViewPresetsKey]);

  // localStorage is the immediate-feedback layer, mirrors every
  // state change.
  useEffect(() => {
    try {
      localStorage.setItem(viewPresetsKey, JSON.stringify(savedBarangayViews));
    } catch {}
  }, [savedBarangayViews, viewPresetsKey]);
  useEffect(() => {
    try {
      localStorage.setItem(
        stretchViewPresetsKey,
        JSON.stringify(savedStretchViews)
      );
    } catch {}
  }, [savedStretchViews, stretchViewPresetsKey]);

  // Debounced push to /api/views/save so the static export picks up the
  // published views. Skips the first effect-run on mount (nothing to
  // publish before the user has done anything this session) and skips
  // any run whose payload matches what was last sent — so unlocking,
  // re-rendering, or switching away and back never triggers a write.
  const viewsPublishTimerRef = useRef(null);
  const viewsPublishMountedRef = useRef(false);
  useEffect(() => {
    if (!viewsPublishMountedRef.current) {
      viewsPublishMountedRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    // A locked visitor has no business publishing views — without this
    // every public page load fired a POST that could only ever 401.
    if (!canEdit) return;
    // State still belongs to the previous LGU (or never loaded).
    if (loadedViewSlugRef.current !== viewSlug) return;
    if (viewsPublishTimerRef.current) {
      clearTimeout(viewsPublishTimerRef.current);
    }
    const payload = JSON.stringify({
      barangays: savedBarangayViews,
      stretches: savedStretchViews,
    });
    if (lastPublishedViewsRef.current[viewSlug] === payload) return;

    viewsPublishTimerRef.current = setTimeout(() => {
      lastPublishedViewsRef.current[viewSlug] = payload;
      // No Authorization header: the unlock cookie carries the
      // credential now. (This used to read a "smv-save-password"
      // localStorage key that nothing ever wrote, so the push silently
      // 401'd on any deployment with a password set.)
      fetch(`/api/views/save?slug=${encodeURIComponent(viewSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => {
        // Let the next change retry rather than treating a failed push
        // as published.
        delete lastPublishedViewsRef.current[viewSlug];
        // Best-effort. If the endpoint is unavailable (e.g. static
        // export, no network), the localStorage copy still works
        // for the current browser. Next online edit will retry.
      });
    }, 1500);
    return () => {
      if (viewsPublishTimerRef.current) {
        clearTimeout(viewsPublishTimerRef.current);
      }
    };
  }, [canEdit, savedBarangayViews, savedStretchViews, viewSlug]);

  // Reset the active stretch whenever the user moves to a different
  // class or barangay — stretch indices are scoped to a (class,
  // barangay) pair and otherwise carry over incorrectly.
  useEffect(() => {
    setActiveStretchIdx(null);
  }, [classIdx, groupIdx, barangayIdx, municipalitySlug]);

  // Mirror the active municipality into the URL so /?m=barlig is a
  // direct link. Bauko is the default — drop the param entirely for it
  // to keep the canonical link clean. replaceState avoids polluting
  // browser history every time the dropdown changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (municipalitySlug === "bauko") {
      url.searchParams.delete("m");
    } else {
      url.searchParams.set("m", municipalitySlug);
    }
    const next = url.pathname + (url.search ? url.search : "") + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", next);
    }
  }, [municipalitySlug]);

  // Keyboard navigation: ←/→ steps, Esc clears, Home/End jump to first/last
  // class. Space and ↓/↑ also step for slideshow ergonomics. Suppressed when
  // typing in a form control or while drawMode is on.
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      )
        return;
      if (drawMode) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          e.preventDefault();
          stepForward();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          stepBackward();
          break;
        case "Escape":
          clear();
          break;
        case "Home":
          e.preventDefault();
          setClassIdx(0);
          setGroupIdx(0);
          setBarangayIdx(0);
          break;
        case "End": {
          e.preventDefault();
          const last = total - 1;
          const cls = classifications[last];
          setClassIdx(last);
          setGroupIdx(cls.locationGroups.length - 1);
          setBarangayIdx(
            cls.locationGroups[cls.locationGroups.length - 1].barangays
              .length - 1
          );
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepForward, stepBackward, clear, drawMode, total, classifications]);

  // Search handlers. The SearchBar (mounted in TopNav) calls these
  // when the user picks a result from the autocomplete dropdown.
  // Each result type triggers a different navigation:
  //   - Barangay  -> snap the sidebar / class indices so the sidebar
  //                  opens at the right class + group + barangay and
  //                  the existing BarangayFocus mechanism flies the
  //                  map to the polygon.
  //   - Road      -> fly the map to the road segment's bounding box.
  //   - Landmark  -> fly the map to the landmark point at street-
  //                  level zoom.
  const handleSearchSelectBarangay = useCallback(
    ({ classIdx: ci, groupIdx: gi, barangayIdx: bi }) => {
      if (typeof ci !== "number") return;
      setClassIdx(ci);
      setGroupIdx(typeof gi === "number" ? gi : 0);
      setBarangayIdx(typeof bi === "number" ? bi : 0);
      setActiveStretchIdx(null);
      setFocusRequestId((n) => n + 1);
    },
    []
  );
  const handleSearchFlyToBounds = useCallback((bbox) => {
    if (!Array.isArray(bbox) || bbox.length !== 4) return;
    mapApiRef.current?.flyToBounds?.(bbox);
  }, []);
  const handleSearchFlyToPoint = useCallback(({ lat, lng }) => {
    if (typeof lat !== "number" || typeof lng !== "number") return;
    mapApiRef.current?.flyToView?.({ lat, lng, zoom: 17 });
  }, []);

  // Flush any unsaved zone geometry to disk before a print tab opens.
  // The /api/print/svg/* routes re-read public/data/<slug>_*.geojson at
  // request time, so whatever is still only in the browser would be
  // missing from the paper. Returns { cancelled } when the user backs
  // out of the save password prompt.
  const prepareForPrint = useCallback(async () => {
    if (printPreparing) return { ok: true };
    setPrintPreparing(true);
    try {
      const saveEditableZones = mapApiRef.current?.saveEditableZones;
      if (canEdit && typeof saveEditableZones === "function") {
        const result = await saveEditableZones({ alertOnError: false });
        if (result?.cancelled) return { cancelled: true };
        if (!result?.ok) {
          throw new Error(result?.error || "Could not save current zone edits.");
        }
      }
      return { ok: true };
    } finally {
      setPrintPreparing(false);
    }
  }, [canEdit, printPreparing]);

  // The printer button opens the print workbench (coverage, orientation,
  // values, field names) rather than firing a single fixed sheet.
  const handlePrint = useCallback(() => {
    setPrintPanelOpen(true);
  }, []);

  useEffect(() => {
    if (
      !autoPrintRequested ||
      !canEdit ||
      municipalitySlug !== "bauko" ||
      !mapApiRef.current
    ) {
      return;
    }
    setAutoPrintRequested(false);
    const timeout = window.setTimeout(() => {
      handlePrint();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [autoPrintRequested, canEdit, municipalitySlug, handlePrint]);

  const handleMapReady = useCallback((api) => {
    mapApiRef.current = api;
  }, []);

  const saveCurrentBarangayView = useCallback(() => {
    if (!activeBarangaySlug || !mapApiRef.current?.getView) return;
    const view = mapApiRef.current.getView();
    if (!view) return;
    setSavedBarangayViews((prev) => ({ ...prev, [activeBarangaySlug]: view }));
  }, [activeBarangaySlug]);

  const clearCurrentBarangayView = useCallback(() => {
    if (!activeBarangaySlug) return;
    setSavedBarangayViews((prev) => {
      if (!(activeBarangaySlug in prev)) return prev;
      const next = { ...prev };
      delete next[activeBarangaySlug];
      return next;
    });
  }, [activeBarangaySlug]);

  // Compose the key used in savedStretchViews for whatever stretch is
  // currently active. Returns null when nothing's selected, which
  // shifts the TopNav save/reset buttons back to the barangay flow.
  const activeStretchKey =
    active && activeBarangaySlug && activeStretchIdx != null
      ? `${active.id}|${activeBarangaySlug}|${activeStretchIdx}`
      : null;

  // Flat catalog of every named stretch in this municipality's
  // schedule. Used by the in-app "+ Landmark" form so the user can
  // pick a stretch from a dropdown instead of typing the cryptic
  // composite key. Each entry includes the same classId|barangay|idx
  // value the rest of the app uses.
  const stretchCatalog = useMemo(() => {
    const out = [];
    for (const cls of classifications || []) {
      for (const group of cls.locationGroups || []) {
        for (const slug of group.barangays || []) {
          const stretches = group.stretches?.[slug];
          if (!Array.isArray(stretches)) continue;
          const b = schedule.getBarangayBySlug?.(slug);
          const brgyName = b?.name || slug;
          for (let i = 0; i < stretches.length; i++) {
            out.push({
              value: `${cls.id}|${slug}|${i}`,
              classId: cls.id,
              classLabel: cls.subClass,
              barangayName: brgyName,
              stretchText: stretches[i],
            });
          }
        }
      }
    }
    return out;
  }, [classifications, schedule]);
  const activeStretchView = activeStretchKey
    ? savedStretchViews[activeStretchKey]
    : null;

  const saveCurrentStretchView = useCallback(() => {
    if (!activeStretchKey || !mapApiRef.current?.getView) return;
    const view = mapApiRef.current.getView();
    if (!view) return;
    setSavedStretchViews((prev) => ({ ...prev, [activeStretchKey]: view }));
  }, [activeStretchKey]);

  const clearCurrentStretchView = useCallback(() => {
    if (!activeStretchKey) return;
    setSavedStretchViews((prev) => {
      if (!(activeStretchKey in prev)) return prev;
      const next = { ...prev };
      delete next[activeStretchKey];
      return next;
    });
  }, [activeStretchKey]);

  // The TopNav Save/Reset buttons act on the active stretch when one
  // is selected, otherwise on the active barangay. One UI, both
  // levels — users don't have to think about which is in scope.
  const saveCurrentView = useCallback(() => {
    if (activeStretchKey) saveCurrentStretchView();
    else saveCurrentBarangayView();
  }, [activeStretchKey, saveCurrentStretchView, saveCurrentBarangayView]);

  const clearCurrentView = useCallback(() => {
    if (activeStretchKey) clearCurrentStretchView();
    else clearCurrentBarangayView();
  }, [activeStretchKey, clearCurrentStretchView, clearCurrentBarangayView]);

  // Click handler routed to Sidebar — selects a stretch under the
  // current (class, barangay) and triggers a fly-to.
  const selectStretch = useCallback(
    (classId, barangaySlug, stretchIdx) => {
      // Ensure the matching class is active too — if the user clicked
      // a stretch under a non-active class, jump there first.
      const targetClassIdx = classifications.findIndex(
        (c) => c.id === classId
      );
      if (targetClassIdx < 0) return;
      // Find the location group + barangay position to keep classIdx /
      // groupIdx / barangayIdx coherent (the slideshow nav reads them).
      const cls = classifications[targetClassIdx];
      let foundGroup = 0;
      let foundBarangay = 0;
      outer: for (let gi = 0; gi < cls.locationGroups.length; gi++) {
        const g = cls.locationGroups[gi];
        for (let bi = 0; bi < g.barangays.length; bi++) {
          if (g.barangays[bi] === barangaySlug) {
            foundGroup = gi;
            foundBarangay = bi;
            break outer;
          }
        }
      }
      setClassIdx(targetClassIdx);
      setGroupIdx(foundGroup);
      setBarangayIdx(foundBarangay);
      setActiveStretchIdx(stretchIdx);
      setFocusRequestId((n) => n + 1);
    },
    [classifications]
  );

  return (
    <main className="consultation-page">
      <TopNav
        drawMode={canEdit ? drawMode : false}
        setDrawMode={canEdit ? setDrawMode : () => {}}
        tileMode={tileMode}
        setTileMode={setTileMode}
        municipalitySlug={municipalitySlug}
        setMunicipalitySlug={setMunicipalitySlug}
        municipalities={MUNICIPALITY_OPTIONS}
        provinceName={municipality.province}
        canSaveView={Boolean(activeStretchKey || activeBarangaySlug)}
        hasSavedView={Boolean(
          activeStretchKey
            ? savedStretchViews[activeStretchKey]
            : activeBarangaySlug && savedBarangayViews[activeBarangaySlug]
        )}
        onSaveView={saveCurrentView}
        onResetView={clearCurrentView}
        searchClassifications={classifications}
        searchBarangaysCatalog={schedule.barangays ?? []}
        searchOsmRoadsFC={mapData?.osmRoads ?? null}
        searchLandmarksFC={mapData?.landmarks ?? null}
        searchCustomLandmarksFC={mapData?.customLandmarks ?? null}
        onSearchSelectBarangay={handleSearchSelectBarangay}
        onSearchFlyToBounds={handleSearchFlyToBounds}
        onSearchFlyToPoint={handleSearchFlyToPoint}
        onPrint={handlePrint}
        isPrintPreparing={printPreparing}
        onRequestUnlock={() => setUnlockOpen(true)}
      />
      <UnlockDialog open={unlockOpen} onClose={() => setUnlockOpen(false)} />
      {canEdit && (
        <PrintPanel
          open={printPanelOpen}
          onClose={() => setPrintPanelOpen(false)}
          municipalitySlug={municipalitySlug}
          municipalityName={municipality.name}
          barangays={schedule.barangays ?? []}
          onBeforePrint={prepareForPrint}
          onPaletteChange={handlePaletteChange}
          onClassesChange={handleClassesChange}
        />
      )}
      <div className="page-body">
        <div className="map-wrapper">
          <Map
            key={`map-${municipality.slug}`}
            drawMode={canEdit ? drawMode : false}
            canEdit={canEdit}
            paletteVersion={paletteVersion}
            classifications={classifications}
            printMode={printMode}
            tileMode={tileMode}
            activeClass={active}
            activeBarangaySlug={activeBarangaySlug}
            savedBarangayViews={savedBarangayViews}
            activeStretchView={activeStretchView}
            activeStretchKey={activeStretchKey}
            stretchCatalog={stretchCatalog}
            focusRequestId={focusRequestId}
            layers={layers}
            onDataChange={setMapData}
            onMapReady={handleMapReady}
            municipality={municipality}
          />
          <MapPanel
            layers={layers}
            setLayers={setLayers}
            drawMode={canEdit ? drawMode : false}
            outlineLabel={municipality.ui?.outlineLabel ?? "Municipality outline"}
          />
          {/* Print-only legend. display:none on screen via inline
              style; the @media print rules flip it to visible and
              place it in the right column of the page. */}
          <PrintLegend
            municipalityName={municipality.name}
            provinceName={municipality.province}
            classifications={classifications}
            effectiveLabel="SMV 2027 - effective Jan 1, 2027"
            showCount={mapData?.zones?.features?.length ?? null}
          />
        </div>
        <Sidebar
          activeClassId={active?.id ?? null}
          activeBarangaySlug={activeBarangaySlug}
          activeStretchIdx={activeStretchIdx}
          onSelectClass={selectClass}
          onSelectBarangay={selectClassBarangay}
          onSelectStretch={selectStretch}
          commercialRows={sidebarCommercial}
          residentialRows={sidebarResidential}
          getBarangayBySlug={schedule.getBarangayBySlug}
          getUniqueBarangaysForClass={schedule.getUniqueBarangaysForClass}
          savedStretchViews={savedStretchViews}
        />
      </div>
    </main>
  );
}
