"use client";

import { CLASSIFICATION_INFO } from "../lib/classifications";

// Floating info card that follows the cursor as the user hovers over
// SMV zone polygons — same UX as mapx.ph. The hovered feature + the
// mouse position are owned by LeafletMap; this component is a pure
// renderer.
//
// Props:
//   feature: GeoJSON Feature currently under the cursor (or null)
//   x, y: client coordinates of the cursor (pixels)
//   barangayResolver: optional (slug) => { name } — passed by the
//     parent so we can render the proper barangay label.
//
// Returns null when no feature is hovered, which keeps the DOM clean
// (no stale empty box hanging around).

// Pull a barangay slug out of one of the keys baked into the zone
// when it was generated. `band_keys` look like `<wayId>__<slug>__<band>`,
// `road_keys` like `<wayId>|<slug>|<...>`. Falls back to the raw
// `barangay` / `barangay_slug` property if either is set explicitly.
function barangaySlugFromFeature(feature) {
  const p = feature?.properties || {};
  if (p.barangay_slug) return String(p.barangay_slug);
  if (p.barangaySlug) return String(p.barangaySlug);
  const bandKey = Array.isArray(p.band_keys) ? p.band_keys[0] : null;
  if (typeof bandKey === "string") {
    const parts = bandKey.split("__");
    if (parts.length >= 2) return parts[1];
  }
  const roadKey = Array.isArray(p.road_keys) ? p.road_keys[0] : null;
  if (typeof roadKey === "string") {
    const parts = roadKey.split("|");
    if (parts.length >= 2) return parts[1];
  }
  return null;
}

// Convert a slug like "kayan-east" → "Kayan East". Used as a graceful
// fallback when the parent didn't pass a barangay resolver (e.g. on
// pre-DXF zones that don't carry a name).
function prettifySlug(slug) {
  if (!slug) return null;
  return String(slug)
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function classChip(klass) {
  const info = CLASSIFICATION_INFO[klass];
  const color = info?.color ?? "#9ca3af";
  const label = info?.label ?? klass ?? "?";
  return { color, label, info };
}

export default function ZoneHoverInfo({
  feature,
  x,
  y,
  barangayResolver,
}) {
  if (!feature || x == null || y == null) return null;

  const p = feature.properties || {};
  const primary = classChip(p.classification);
  const secondary = p.secondary_classification
    ? classChip(p.secondary_classification)
    : null;
  const tertiary = p.tertiary_classification
    ? classChip(p.tertiary_classification)
    : null;

  const slug = barangaySlugFromFeature(feature);
  const resolved = slug && barangayResolver ? barangayResolver(slug) : null;
  const barangay = resolved?.name ?? prettifySlug(slug);

  const source = p.source;
  const value2027 = primary.info?.value;

  // Offset the card a bit so it doesn't sit right under the cursor
  // (which makes the hover layer un-targetable in some browsers).
  // Flip to the left side if the cursor is near the right edge so
  // the card never clips off-screen.
  const PAD = 16;
  const CARD_W = 240;
  const flipLeft =
    typeof window !== "undefined" && x + CARD_W + PAD > window.innerWidth;
  const left = flipLeft ? x - CARD_W - PAD : x + PAD;
  const top = y + PAD;

  return (
    <div
      className="zone-hover-card"
      style={{
        position: "fixed",
        left,
        top,
        width: CARD_W,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <div className="zone-hover-card__header">
        <span
          className="zone-hover-card__swatch"
          style={{ background: primary.color }}
        />
        <span className="zone-hover-card__title">
          {primary.label}
          {primary.info?.category ? (
            <span className="zone-hover-card__category">
              {" "}
              · {primary.info.category}
            </span>
          ) : null}
        </span>
      </div>

      {(secondary || tertiary) && (
        <div className="zone-hover-card__row">
          <span className="zone-hover-card__label">Also:</span>
          <span className="zone-hover-card__chips">
            {secondary && (
              <span
                className="zone-hover-card__chip"
                title={`Secondary class: ${secondary.label}`}
              >
                <span
                  className="zone-hover-card__chip-dot"
                  style={{ background: secondary.color }}
                />
                {secondary.label}
                <span className="zone-hover-card__chip-badge">2°</span>
              </span>
            )}
            {tertiary && (
              <span
                className="zone-hover-card__chip"
                title={`Tertiary class: ${tertiary.label}`}
              >
                <span
                  className="zone-hover-card__chip-dot"
                  style={{ background: tertiary.color }}
                />
                {tertiary.label}
                <span className="zone-hover-card__chip-badge">3°</span>
              </span>
            )}
          </span>
        </div>
      )}

      {barangay && (
        <div className="zone-hover-card__row">
          <span className="zone-hover-card__label">Barangay</span>
          <span className="zone-hover-card__value">{barangay}</span>
        </div>
      )}

      {value2027 != null && (
        <div className="zone-hover-card__row">
          <span className="zone-hover-card__label">2027 value</span>
          <span className="zone-hover-card__value">
            ₱{value2027.toLocaleString()} / m²
          </span>
        </div>
      )}

      {source && (
        <div className="zone-hover-card__row zone-hover-card__row--meta">
          <span className="zone-hover-card__label">Source</span>
          <span className="zone-hover-card__value">{source}</span>
        </div>
      )}
    </div>
  );
}
