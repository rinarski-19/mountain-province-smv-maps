"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomBar from "@/components/BottomBar";
import Map from "@/components/Map";
import MapPanel from "@/components/MapPanel";
import RPTImpactCalculator from "@/components/RPTImpactCalculator";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { getMunicipalityConfig, MUNICIPALITY_OPTIONS } from "@/lib/municipalities";

const BARANGAY_VIEW_PRESETS_KEY_PREFIX = "smv-barangay-view-v1:";
// Per-stretch saved viewports. Keyed by `${classId}|${barangaySlug}|${stretchIdx}`
// where stretchIdx is the index within the flat stretches list for that
// (class, barangay) pair. Falls back to the barangay-level view when
// no stretch-specific view has been saved.
const STRETCH_VIEW_PRESETS_KEY_PREFIX = "smv-stretch-view-v1:";

export default function Home() {
  const mapApiRef = useRef(null);
  const [drawMode, setDrawMode] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [tileMode, setTileMode] = useState("online");
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
    // Off by default — it's a guide for editors, not a consultation
    // overlay. Editors flip it on from the Layers panel while drawing.
    frontageBands: false,
  });
  const [savedBarangayViews, setSavedBarangayViews] = useState({});
  const [savedStretchViews, setSavedStretchViews] = useState({});
  // Which stretch (sub-item) under the active barangay is currently
  // selected. Null when no stretch is picked — falls back to the
  // barangay-level view behaviour.
  const [activeStretchIdx, setActiveStretchIdx] = useState(null);
  const [focusRequestId, setFocusRequestId] = useState(0);

  const municipality = useMemo(
    () => getMunicipalityConfig(municipalitySlug),
    [municipalitySlug]
  );
  const schedule = municipality.schedule;
  const viewPresetsKey = `${BARANGAY_VIEW_PRESETS_KEY_PREFIX}${municipality.slug}`;
  const stretchViewPresetsKey = `${STRETCH_VIEW_PRESETS_KEY_PREFIX}${municipality.slug}`;
  const classifications = schedule.classifications;
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

  // Default to online tiles. If internet drops, fall back to offline.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOffline = () => setTileMode("offline");
    if (!window.navigator.onLine) onOffline();
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
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
    const fromUrl = new URLSearchParams(window.location.search).get("m");
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
  // It should also honour the new LGU's defaultTileMode (if defined)
  // — e.g. Sadanga defaults to Google Streets because PAO staff need
  // accurate rooftop imagery for the per-building override workflow.
  // Users can override per-session via the gear-icon tile picker.
  useEffect(() => {
    setClassIdx(null);
    setGroupIdx(0);
    setBarangayIdx(0);
    const defaultTile = municipality?.tiles?.defaultTileMode;
    if (defaultTile) {
      setTileMode(defaultTile);
    }
  }, [municipalitySlug, municipality?.tiles?.defaultTileMode]);

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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let fromFile = { barangays: {}, stretches: {} };
      try {
        const res = await fetch(`/data/${municipalitySlug}_saved_views.json`, {
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
      setSavedBarangayViews({ ...fromLocal.barangays, ...fromFile.barangays });
      setSavedStretchViews({ ...fromLocal.stretches, ...fromFile.stretches });
    })();
    return () => {
      cancelled = true;
    };
  }, [municipalitySlug, viewPresetsKey, stretchViewPresetsKey]);

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

  // Debounced push to /api/views/save so the static export picks
  // up the published views. We skip the first effect-run on mount
  // (there's nothing to publish before the user has done anything
  // in this session) and skip when both maps are empty.
  const viewsPublishTimerRef = useRef(null);
  const viewsPublishMountedRef = useRef(false);
  useEffect(() => {
    if (!viewsPublishMountedRef.current) {
      viewsPublishMountedRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    if (viewsPublishTimerRef.current) {
      clearTimeout(viewsPublishTimerRef.current);
    }
    viewsPublishTimerRef.current = setTimeout(() => {
      const password = localStorage.getItem("smv-save-password") || "";
      fetch(`/api/views/save?slug=${encodeURIComponent(municipalitySlug)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { Authorization: `Bearer ${password}` } : {}),
        },
        body: JSON.stringify({
          barangays: savedBarangayViews,
          stretches: savedStretchViews,
        }),
      }).catch(() => {
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
  }, [savedBarangayViews, savedStretchViews, municipalitySlug]);

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
        drawMode={drawMode}
        setDrawMode={setDrawMode}
        tileMode={tileMode}
        setTileMode={setTileMode}
        calculatorOpen={calculatorOpen}
        setCalculatorOpen={setCalculatorOpen}
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
      />
      <div className="page-body">
        <div className="map-wrapper">
          <Map
            key={`map-${municipality.slug}`}
            drawMode={drawMode}
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
            drawMode={drawMode}
            outlineLabel={municipality.ui?.outlineLabel ?? "Municipality outline"}
          />
        </div>
        <Sidebar
          activeClassId={active?.id ?? null}
          activeBarangaySlug={activeBarangaySlug}
          activeStretchIdx={activeStretchIdx}
          onSelectClass={selectClass}
          onSelectBarangay={selectClassBarangay}
          onSelectStretch={selectStretch}
          commercialRows={schedule.commercial}
          residentialRows={schedule.residential}
          getBarangayBySlug={schedule.getBarangayBySlug}
          getUniqueBarangaysForClass={schedule.getUniqueBarangaysForClass}
          savedStretchViews={savedStretchViews}
        />
      </div>
      <BottomBar
        active={active}
        activeGroup={activeGroup}
        activeBarangaySlug={activeBarangaySlug}
        classIdx={classIdx ?? 0}
        groupIdx={groupIdx}
        barangayIdx={barangayIdx}
        total={total}
        onPrev={stepBackward}
        onNext={stepForward}
        onClear={clear}
        barangays={schedule.barangays}
        getBarangayBySlug={schedule.getBarangayBySlug}
      />
      <RPTImpactCalculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        municipality={municipality}
        classifications={classifications}
        activeClass={active}
      />
    </main>
  );
}
