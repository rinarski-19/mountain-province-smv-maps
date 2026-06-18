"use client";

import { useEffect, useRef, useState } from "react";

const LAYERS = [
  ["outline", "Outline"],
  ["barangays", "Barangays"],
  ["zones", "SMV zones"],
  ["smv", "SMV (₱/m²)"],
  ["frontageBands", "Frontage bands (0–30 / 30–60 m)"],
  ["landmarks", "Landmarks (OSM + custom pins)"],
];

const PANEL_COLLAPSED_KEY = "map-panel-collapsed-v1";
const PANEL_POSITION_KEY = "map-panel-position-v1";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// The map panel is now an editor-only utility — it only surfaces while the
// user is in drawMode (toggling layers while authoring zones). The SMV
// legend that used to live here was removed for a cleaner consultation
// view; the bottom bar's class chip + headline already communicate the
// active class and price.
//
// Collapsible — the title row acts as a button. State persists to
// localStorage so the user's last choice carries across sessions.
export default function MapPanel({
  layers,
  setLayers,
  drawMode = false,
  outlineLabel = "Municipality outline",
}) {
  // useState initialiser pulls the persisted collapsed flag. We can't
  // touch localStorage during SSR; the typeof check defers reading
  // until the component mounts on the client.
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const movedDuringDragRef = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PANEL_COLLAPSED_KEY);
      if (stored != null) setCollapsed(stored === "1");
      const storedPosition = window.localStorage.getItem(PANEL_POSITION_KEY);
      if (storedPosition) {
        const parsed = JSON.parse(storedPosition);
        if (
          Number.isFinite(parsed?.left) &&
          Number.isFinite(parsed?.top)
        ) {
          setPosition({ left: parsed.left, top: parsed.top });
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);
  useEffect(() => {
    if (!position) return;
    try {
      window.localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position));
    } catch {}
  }, [position]);

  useEffect(() => {
    if (!drawMode || !position) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const next = {
      left: clamp(position.left, 0, Math.max(0, parentRect.width - panelRect.width)),
      top: clamp(position.top, 0, Math.max(0, parentRect.height - panelRect.height)),
    };
    if (next.left !== position.left || next.top !== position.top) {
      setPosition(next);
    }
  }, [collapsed, drawMode, position]);

  if (!drawMode) return null;

  const toggle = (key) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  const startDrag = (event) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;

    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelRect.left - parentRect.left,
      startTop: panelRect.top - parentRect.top,
      parentWidth: parentRect.width,
      parentHeight: parentRect.height,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
    };
    movedDuringDragRef.current = false;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      movedDuringDragRef.current = true;
    }
    setPosition({
      left: clamp(
        drag.startLeft + dx,
        0,
        Math.max(0, drag.parentWidth - drag.panelWidth)
      ),
      top: clamp(
        drag.startTop + dy,
        0,
        Math.max(0, drag.parentHeight - drag.panelHeight)
      ),
    });
    event.preventDefault();
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  };

  const panelStyle = position
    ? { left: position.left, top: position.top, right: "auto" }
    : undefined;

  return (
    <aside
      ref={panelRef}
      className={`map-panel ${dragging ? "is-dragging" : ""}`}
      aria-label="Editor layer toggles"
      style={panelStyle}
    >
      <section className="map-panel__section">
        <button
          type="button"
          className="map-panel__title"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={(event) => {
            if (movedDuringDragRef.current) {
              movedDuringDragRef.current = false;
              event.preventDefault();
              return;
            }
            setCollapsed((c) => !c);
          }}
          aria-expanded={!collapsed}
          aria-controls="map-panel-layer-toggles"
          title={
            collapsed
              ? "Expand Layers, or drag to move"
              : "Collapse Layers, or drag to move"
          }
        >
          <span className="map-panel__caret" aria-hidden>
            {collapsed ? "▸" : "▾"}
          </span>
          Layers
        </button>
        {!collapsed && (
          <div className="layer-toggles" id="map-panel-layer-toggles">
            {LAYERS.map(([key, label]) => (
              <label key={key} className="layer-toggle">
                <input
                  type="checkbox"
                  checked={!!layers[key]}
                  onChange={() => toggle(key)}
                />
                <span>{key === "outline" ? outlineLabel : label}</span>
              </label>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
