"use client";

import { useMemo } from "react";

// Available landmark kinds — keep in sync with the CSS color rules in
// app/globals.css (.custom-pin--<kind>) and with the GeoJSON file's
// _meta.kinds array. Adding a new kind requires touching both.
const KIND_OPTIONS = [
  { value: "business", label: "Business (orange)" },
  { value: "govt", label: "Government (blue)" },
  { value: "hospital", label: "Hospital (red)" },
  { value: "clinic", label: "Clinic (light red)" },
  { value: "school", label: "School (blue)" },
  { value: "worship", label: "Worship (violet)" },
  { value: "market", label: "Market (green)" },
  { value: "tourism", label: "Tourism (cyan)" },
  { value: "transport", label: "Transport (yellow)" },
];

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

// Floating modal for adding a custom landmark via the in-app "+ Landmark"
// tool. Header + scrollable body + sticky footer so the Save buttons are
// always reachable no matter how many stretch chips the user attaches.
//
// Props:
//   pending: { lat, lng, name, kind, stretchKeys }
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
        New landmark @ {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
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
          <input
            type="text"
            value={pending.name}
            autoFocus
            onChange={(e) =>
              setPending((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="e.g. Bontoc Municipal Capitol"
            className="landmark-form__input"
            required
          />
        </label>

        <label className="landmark-form__field">
          <span className="landmark-form__label">Kind</span>
          <select
            value={pending.kind}
            onChange={(e) =>
              setPending((p) => ({ ...p, kind: e.target.value }))
            }
            className="landmark-form__input"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

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
          Add landmark
        </button>
      </footer>
    </div>
  );
}
