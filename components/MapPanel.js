"use client";

const LAYERS = [
  ["outline", "Outline"],
  ["barangays", "Barangays"],
  ["zones", "SMV zones"],
  ["smv", "SMV (₱/m²)"],
];

// The map panel is now an editor-only utility — it only surfaces while the
// user is in drawMode (toggling layers while authoring zones). The SMV
// legend that used to live here was removed for a cleaner consultation
// view; the bottom bar's class chip + headline already communicate the
// active class and price.
export default function MapPanel({
  layers,
  setLayers,
  drawMode = false,
  outlineLabel = "Municipality outline",
}) {
  if (!drawMode) return null;

  const toggle = (key) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <aside className="map-panel" aria-label="Editor layer toggles">
      <section className="map-panel__section">
        <h2 className="map-panel__title">Layers</h2>
        <div className="layer-toggles">
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
      </section>
    </aside>
  );
}
