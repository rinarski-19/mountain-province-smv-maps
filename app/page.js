"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomBar from "@/components/BottomBar";
import Map from "@/components/Map";
import MapPanel from "@/components/MapPanel";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { getMunicipalityConfig, MUNICIPALITY_OPTIONS } from "@/lib/municipalities";

const BARANGAY_VIEW_PRESETS_KEY_PREFIX = "smv-barangay-view-v1:";

export default function Home() {
  const mapApiRef = useRef(null);
  const [drawMode, setDrawMode] = useState(false);
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
  const [focusRequestId, setFocusRequestId] = useState(0);

  const municipality = useMemo(
    () => getMunicipalityConfig(municipalitySlug),
    [municipalitySlug]
  );
  const schedule = municipality.schedule;
  const viewPresetsKey = `${BARANGAY_VIEW_PRESETS_KEY_PREFIX}${municipality.slug}`;
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
  useEffect(() => {
    setClassIdx(null);
    setGroupIdx(0);
    setBarangayIdx(0);
  }, [municipalitySlug]);

  // Per-municipality saved map views keyed by barangay slug.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(viewPresetsKey);
      const parsed = raw ? JSON.parse(raw) : {};
      setSavedBarangayViews(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setSavedBarangayViews({});
    }
  }, [viewPresetsKey]);

  useEffect(() => {
    try {
      localStorage.setItem(viewPresetsKey, JSON.stringify(savedBarangayViews));
    } catch {}
  }, [savedBarangayViews, viewPresetsKey]);

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

  return (
    <main className="consultation-page">
      <TopNav
        drawMode={drawMode}
        setDrawMode={setDrawMode}
        tileMode={tileMode}
        setTileMode={setTileMode}
        municipalitySlug={municipalitySlug}
        setMunicipalitySlug={setMunicipalitySlug}
        municipalities={MUNICIPALITY_OPTIONS}
        provinceName={municipality.province}
        canSaveView={Boolean(activeBarangaySlug)}
        hasSavedView={Boolean(activeBarangaySlug && savedBarangayViews[activeBarangaySlug])}
        onSaveView={saveCurrentBarangayView}
        onResetView={clearCurrentBarangayView}
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
          onSelectClass={selectClass}
          onSelectBarangay={selectClassBarangay}
          commercialRows={schedule.commercial}
          residentialRows={schedule.residential}
          getBarangayBySlug={schedule.getBarangayBySlug}
          getUniqueBarangaysForClass={schedule.getUniqueBarangaysForClass}
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
    </main>
  );
}
