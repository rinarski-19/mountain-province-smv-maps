"use client";

import { useMemo } from "react";
import {
  LANDMARK_KIND_OPTIONS,
  landmarkIconPath,
  normalizeLandmarkKind,
} from "@/lib/landmark-icons";
import {
  LANDMARK_LABEL_PLACEMENTS,
  normalizeLandmarkLabelPlacement,
} from "@/lib/landmark-labels";

function LandmarkIcon({ kind, size = 22 }) {
  return (
    <svg
      className="landmark-picker__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={landmarkIconPath(kind)} />
    </svg>
  );
}

// Group flat stretchCatalog by classLabel so the dropdown renders one
// <optgroup> per class — way more scannable when a municipality has
// 90+ stretches (e.g. Bontoc).
function groupStretches(catalog) {
  const by = {};
  for (const opt of catalog || []) {
    if (!by[opt.classLabel]) by[opt.classLabel] = [];
    by[opt.classLabel].push(opt);
  }
  return Object.keys(by)
    .sort()
    .map((cls) => ({ classLabel: cls, options: by[cls] }));
}

const DEFAULT_LANDMARK_KIND = "school";
const DEFAULT_LANDMARK_LABEL_PLACEMENT = "callout-top";

// Floating modal for adding a custom landmark via the in-app "+ Landmark"
// tool. Header + scrollable body + sticky footer so the Save buttons are
// always reachable no matter how many stretch chips the user attaches.
//
// Props:
//   pending: { lat, lng, name, kind, labelPlacement, labelSize, stretchKeys }
//   setPending: state setter
//   stretchCatalog: flat list of { value, classLabel, barangayName, stretchText }
//   onCommit: (data) => void
//   onCancel: () => void
export default function LandmarkAddForm({
  pending,
  setPending,
  stretchCatalog = [],
  onCommit,
  onCancel,
}) {
  const groupedStretches = useMemo(
    () => groupStretches(stretchCatalog),
    [stretchCatalog]
  );

  if (!pending) return null;

  const canSubmit = !!pending.name?.trim();

  const addStretchKey = (key) => {
    if (!key) return;
    setPending((p) =>
      p.stretchKeys.includes(key)
        ? p
        : { ...p, stretchKeys: [...p.stretchKeys, key] }
    );
  };

  const removeStretchKey = (key) => {
    setPending((p) => ({
      ...p,
      stretchKeys: p.stretchKeys.filter((k) => k !== key),
    }));
  };

  const stretchLabelFor = (key) => {
    const o = stretchCatalog.find((x) => x.value === key);
    return o
      ? `${o.classLabel} (${o.barangayName}) — ${o.stretchText}`
      : key;
  };

  return (
    <div
      className="landmark-form"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="landmark-form__head">
        {pending.id || pending.originalName ? "Edit landmark" : "New landmark"} @ {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
      </header>

      <form
        className="landmark-form__body"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onCommit(pending);
        }}
      >
        <label className="landmark-form__field">
          <span className="landmark-form__label">Name</span>
          <textarea
            value={pending.name}
            autoFocus
            onChange={(e) =>
              setPending((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="e.g. Bontoc Municipal Capitol"
            className="landmark-form__input"
            rows={2}
            required
          />
        </label>

        <label className="landmark-form__field">
          <span className="landmark-form__label">Label placement</span>
          <select
            value={normalizeLandmarkLabelPlacement(
              pending.labelPlacement || DEFAULT_LANDMARK_LABEL_PLACEMENT
            )}
            onChange={(e) =>
              setPending((p) => ({ ...p, labelPlacement: e.target.value }))
            }
            className="landmark-form__input"
          >
            {LANDMARK_LABEL_PLACEMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="landmark-form__hint">
            Placement is saved with the landmark and used by the printed SVG.
          </span>
        </label>

        <label className="landmark-form__field">
          <span className="landmark-form__label">Label text size</span>
          <select
            value={pending.labelSize || "large"}
            onChange={(e) =>
              setPending((p) => ({ ...p, labelSize: e.target.value }))
            }
            className="landmark-form__input"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
          <span className="landmark-form__hint">
            Applies to the landmark name on the map and on the printed SVG.
          </span>
        </label>

        <div className="landmark-form__field">
          <span className="landmark-form__label">Kind</span>
          <div
            className="landmark-picker"
            role="radiogroup"
            aria-label="Landmark kind"
          >
            {LANDMARK_KIND_OPTIONS.map((o) => {
              const selected =
                normalizeLandmarkKind(pending.kind || DEFAULT_LANDMARK_KIND) ===
                o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  className={`landmark-picker__option${selected ? " is-selected" : ""}`}
                  style={{ "--landmark-picker-color": o.color }}
                  onClick={() => setPending((p) => ({ ...p, kind: o.value }))}
                  aria-pressed={selected}
                  aria-checked={selected}
                  title={o.label}
                >
                  <span className="landmark-picker__pin">
                    <LandmarkIcon kind={o.value} />
                  </span>
                  <span className="landmark-picker__text">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="landmark-form__field">
          <span className="landmark-form__label">
            Linked SMV stretches (optional, multi-select)
          </span>

          {pending.stretchKeys.length > 0 && (
            <div className="landmark-form__chips">
              {pending.stretchKeys.map((key) => (
                <span
                  key={key}
                  className="landmark-form__chip"
                  title={stretchLabelFor(key)}
                >
                  <span className="landmark-form__chip-label">
                    {stretchLabelFor(key)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStretchKey(key)}
                    className="landmark-form__chip-remove"
                    title="Remove this link"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <select
            value=""
            onChange={(e) => addStretchKey(e.target.value)}
            className="landmark-form__input"
          >
            <option value="">
              {pending.stretchKeys.length === 0
                ? "+ Link to a SMV stretch…"
                : "+ Link to another stretch…"}
            </option>
            {groupedStretches.map(({ classLabel, options }) => (
              <optgroup key={classLabel} label={classLabel}>
                {options.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    disabled={pending.stretchKeys.includes(o.value)}
                  >
                    {o.barangayName} — {o.stretchText}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <span className="landmark-form__hint">
            {pending.stretchKeys.length === 0
              ? "Pick one or more stretches the landmark belongs to. The pin lights up yellow when any linked stretch is selected in the sidebar."
              : `Linked to ${pending.stretchKeys.length} stretch${pending.stretchKeys.length === 1 ? "" : "es"}. Click × on a chip to remove.`}
          </span>
        </div>
      </form>

      <footer className="landmark-form__foot">
        <button
          type="button"
          onClick={onCancel}
          className="landmark-form__btn landmark-form__btn--ghost"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => canSubmit && onCommit(pending)}
          disabled={!canSubmit}
          className="landmark-form__btn landmark-form__btn--primary"
        >
          {pending.id || pending.originalName ? "Save changes" : "Add landmark"}
        </button>
      </footer>
    </div>
  );
}
