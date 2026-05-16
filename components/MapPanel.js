"use client";

import { useEffect, useState } from "react";

const LAYERS = [
  ["outline", "Outline"],
  ["barangays", "Barangays"],
  ["zones", "SMV zones"],
  ["smv", "SMV (₱/m²)"],
  ["frontageBands", "Frontage bands (0–30 / 30–60 m)"],
];

const PANEL_COLLAPSED_KEY = "map-panel-collapsed-v1";

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
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PANEL_COLLAPSED_KEY);
      if (stored != null) setCollapsed(stored === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  if (!drawMode) return null;

  const toggle = (key) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <aside className="map-panel" aria-label="Editor layer toggles">
      <section className="map-panel__section">
        <button
          type="button"
          className="map-panel__title"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="map-panel-layer-toggles"
          title={collapsed ? "Expand Layers" : "Collapse Layers"}
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
