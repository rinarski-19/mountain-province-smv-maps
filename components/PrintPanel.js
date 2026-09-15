"use client";

// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The unlocked print workbench.
//
// Three things live here, because in practice they're one task — you
// pick a sheet, fix what's wrong on it, and print it:
//
//   1. Sheet     — whole municipality or one barangay, portrait or
//                  landscape, plus the render knobs the print routes
//                  already accept (SMV band width, building footprints,
//                  the LOCATIONS panel).
//   2. Values    — the ₱/m² unit value beside each SMV class in the
//                  legend. Overlays <slug>_valuations.json; the
//                  transcribed official schedule is never rewritten.
//   3. Field names — every fixed caption the sheet prints, from the
//                  title down to the prepared-by block.
//
// Edits are a LOCAL DRAFT first: they autosave to localStorage per LGU
// and affect nobody else, and "Preview draft" renders a sheet from them
// without publishing. "Publish" is the deliberate step that writes
// public/data/<slug>_print_settings.json for everyone — in dev straight
// to the file, in production as a GitHub commit that redeploys.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_CLASS_VALUE,
  MAX_LABEL_LENGTH,
  PRINT_LABEL_DEFAULTS,
  normalizePrintSettings,
  printLabelGroups,
} from "@/lib/print-labels";
import { basePrintSlug } from "@/lib/print-slugs";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAccess } from "./AccessContext";

const DRAFT_KEY_PREFIX = "smv-print-draft-v1:";
const TABS = [
  ["sheet", "Sheet"],
  ["values", "Values"],
  ["labels", "Field names"],
];

const EMPTY_DRAFT = { classValues: {}, labels: {} };

// Mirrors MAX_SMV_BUFFER_M in app/api/print/svg/_route-helpers.js. The
// server clamps too; this is so the panel can TELL the user, instead of
// dropping an out-of-range value on the floor and printing as if they
// had never typed it.
const MAX_BUFFER_M = 500;

function clampBuffer(raw) {
  const value = parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_BUFFER_M);
}

function bufferNotice(raw) {
  if (raw === "" || raw == null) return null;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return "Not a number — printing with no extra width.";
  if (value < 0) return "Negative — printing with no extra width.";
  if (value > MAX_BUFFER_M) return `Capped at ${MAX_BUFFER_M} m.`;
  return null;
}

function draftKey(slug) {
  return `${DRAFT_KEY_PREFIX}${slug}`;
}

function readDraft(slug) {
  try {
    const raw = window.localStorage.getItem(draftKey(slug));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw);
    return {
      classValues: parsed?.classValues ?? {},
      labels: parsed?.labels ?? {},
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function isEmptyDraft(draft) {
  return (
    Object.keys(draft.classValues ?? {}).length === 0 &&
    Object.keys(draft.labels ?? {}).length === 0
  );
}

// Order classes the way the printed legend does: commercial ladder,
// residential ladder, then anything else (INSTITUTIONAL and friends).
function sortClassKeys(keys) {
  const rank = (k) => (k.startsWith("C-") ? 0 : k.startsWith("R-") ? 1 : 2);
  const num = (k) => {
    const m = k.match(/-(\d+)$/);
    return m ? Number(m[1]) : 0;
  };
  return [...keys].sort(
    (a, b) => rank(a) - rank(b) || num(a) - num(b) || a.localeCompare(b)
  );
}

function extractClassValues(valuations) {
  const out = {};
  for (const category of valuations?.land_classifications ?? []) {
    for (const item of category?.items ?? []) {
      const klass = item?.sub_classification;
      const value = item?.unit_value_2027_per_sqm;
      if (klass && value != null && out[klass] == null) out[klass] = value;
    }
  }
  return out;
}

export default function PrintPanel({
  open,
  onClose,
  municipalitySlug,
  municipalityName,
  barangays = [],
  // Called before a print tab is opened so the editor's unsaved zone
  // geometry lands on disk first — the print routes read files, not
  // browser state.
  onBeforePrint,
}) {
  const { canEdit } = useAccess();
  const slug = basePrintSlug(municipalitySlug);

  const [tab, setTab] = useState("sheet");
  const [barangaySlug, setBarangaySlug] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [smvBuffer, setSmvBuffer] = useState("");
  const [showBuildings, setShowBuildings] = useState(true);
  const [showLocations, setShowLocations] = useState(false);

  // Baseline = what the printed sheet would say with no draft applied:
  // the valuations file plus whatever is already published.
  const [baseValues, setBaseValues] = useState({});
  const [published, setPublished] = useState(EMPTY_DRAFT);
  // Version token of the published state this panel loaded. Echoed back
  // on publish so a concurrent edit is refused rather than clobbered.
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(null);
  // Server-filtered barangay list; a few scheduled barangays have no
  // boundary feature and cannot be printed at all.
  const [printableBarangays, setPrintableBarangays] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  // Which slug `draft` currently holds. The autosave effect below must
  // not write until this matches `slug`, otherwise it fires while the
  // async load is still in flight and either erases a stored draft
  // (initial draft is empty → removeItem) or stamps the previous LGU's
  // draft onto the new one.
  const [hydratedSlug, setHydratedSlug] = useState(null);
  const [publishState, setPublishState] = useState("idle"); // idle|saving|saved|error
  const [message, setMessage] = useState("");
  const previewFormRef = useRef(null);
  const panelRef = useRef(null);
  useFocusTrap(panelRef, open);
  // The drawer sits directly beneath the top nav so its own header is
  // never covered and the municipality switcher stays usable — picking
  // an LGU and printing it is one task. The nav's height changes with
  // the breakpoint (and it wraps to two rows on a phone), so measure it
  // rather than duplicating the number in CSS and letting it drift.
  const [navOffset, setNavOffset] = useState(0);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const nav = document.querySelector("nav.top-nav");
      setNavOffset(nav ? Math.round(nav.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  // Load baseline + published overrides + any local draft for this LGU.
  useEffect(() => {
    if (!open || !slug) return;
    let cancelled = false;
    // Invalidate first: until the load below resolves, `draft` still
    // belongs to whatever was open before. Clearing it too means the
    // form never shows the previous LGU's numbers against this LGU's
    // placeholders; the stored draft comes back from localStorage below.
    setHydratedSlug(null);
    setDraft(EMPTY_DRAFT);
    setLoading(true);
    setMessage("");
    (async () => {
      const [valuations, settings] = await Promise.all([
        fetch(`/data/${slug}_valuations.json`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/print-settings/${slug}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      setBaseValues(extractClassValues(valuations));
      setPublished({
        classValues: settings?.classValues ?? {},
        labels: settings?.labels ?? {},
      });
      setBaseUpdatedAt(settings?.updatedAt ?? null);
      setPrintableBarangays(
        Array.isArray(settings?.printableBarangays)
          ? settings.printableBarangays
          : null
      );
      setDraft(readDraft(slug));
      setHydratedSlug(slug);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  // Barangay selection is per-LGU; drop it when the LGU changes.
  useEffect(() => {
    setBarangaySlug("");
  }, [slug]);

  // Autosave the draft. Writing `{}` would leave a dead key behind, so
  // an emptied draft removes its entry instead.
  useEffect(() => {
    if (!open || !slug || hydratedSlug !== slug) return;
    try {
      if (isEmptyDraft(draft)) window.localStorage.removeItem(draftKey(slug));
      else window.localStorage.setItem(draftKey(slug), JSON.stringify(draft));
    } catch {}
  }, [draft, open, slug, hydratedSlug]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose?.();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const coverageBarangays = printableBarangays ?? barangays;
  const unprintableCount =
    printableBarangays == null
      ? 0
      : Math.max(0, barangays.length - printableBarangays.length);

  const classKeys = useMemo(
    () =>
      sortClassKeys(
        new Set([
          ...Object.keys(baseValues),
          ...Object.keys(published.classValues ?? {}),
          ...Object.keys(draft.classValues ?? {}),
        ])
      ),
    [baseValues, published, draft]
  );

  const labelGroups = useMemo(() => printLabelGroups(), []);

  // What the sheet prints right now for a given field, ignoring the
  // draft — used as the input placeholder so an empty box visibly means
  // "unchanged" rather than "blank".
  const publishedValueFor = useCallback(
    (klass) => published.classValues?.[klass] ?? baseValues[klass] ?? null,
    [published, baseValues]
  );
  const publishedLabelFor = useCallback(
    (key) => published.labels?.[key] ?? PRINT_LABEL_DEFAULTS[key],
    [published]
  );

  const setClassValue = (klass, value) =>
    setDraft((prev) => {
      const next = { ...prev.classValues };
      if (value === "") delete next[klass];
      else next[klass] = value;
      return { ...prev, classValues: next };
    });

  const setLabel = (key, value) =>
    setDraft((prev) => {
      const next = { ...prev.labels };
      if (value === "") delete next[key];
      else next[key] = value;
      return { ...prev, labels: next };
    });

  const valueDraftCount = Object.keys(draft.classValues ?? {}).length;
  const labelDraftCount = Object.keys(draft.labels ?? {}).length;
  const draftCount = valueDraftCount + labelDraftCount;
  const hasDraft = draftCount > 0;
  // Per-tab, so the dot tells you WHERE the unpublished edit is.
  const draftCountForTab = { values: valueDraftCount, labels: labelDraftCount };

  const printQuery = () => {
    const params = new URLSearchParams();
    const buffer = clampBuffer(smvBuffer);
    if (buffer > 0) params.set("smvBuffer", String(buffer));
    if (!showBuildings) params.set("buildings", "0");
    if (showLocations) params.set("locations", "1");
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const printUrl = () =>
    `/api/print/svg/${orientation}/${encodeURIComponent(slug)}` +
    (barangaySlug ? `/${encodeURIComponent(barangaySlug)}` : "") +
    printQuery();

  // Open a print tab synchronously (popup blockers reject a window.open
  // that happens after an await), then point it at the sheet once any
  // pending zone edits are on disk.
  const openPublishedSheet = async () => {
    setMessage("");
    const tab = window.open("", "_blank");
    if (!tab) {
      setMessage("Could not open a new tab — allow popups for this site.");
      return;
    }
    try {
      tab.document.write(
        '<!doctype html><title>Preparing print…</title><body style="font-family:system-ui,sans-serif;padding:24px;color:#111827">Preparing the print sheet…</body>'
      );
      tab.document.close();
    } catch {}
    try {
      const result = await onBeforePrint?.();
      if (result?.cancelled) {
        tab.close();
        return;
      }
      tab.location.href = printUrl();
      setMessage("");
    } catch (e) {
      tab.close();
      setMessage(`Could not prepare the sheet: ${e?.message ?? e}`);
    }
  };

  // A POSTed form with target="_blank" is the only way to land a POST
  // response in a new tab, and POST is what keeps a long draft out of
  // the URL.
  const previewDraft = async () => {
    setMessage("");
    try {
      await onBeforePrint?.();
    } catch {}
    previewFormRef.current?.submit();
  };

  const publish = async () => {
    setPublishState("saving");
    setMessage("");
    const merged = {
      classValues: { ...published.classValues, ...draft.classValues },
      labels: { ...published.labels, ...draft.labels },
    };
    const payload = normalizePrintSettings(merged);
    try {
      const res = await fetch(`/api/print-settings/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...merged, baseUpdatedAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Someone else published while this panel was open. Keep the
        // draft so nothing the user typed is lost, and show them the
        // state they now have to rebase on.
        setPublished({
          classValues: data.current?.classValues ?? {},
          labels: data.current?.labels ?? {},
        });
        setBaseUpdatedAt(data.current?.updatedAt ?? null);
        setPublishState("error");
        setMessage(
          `${data.error} Your edits are still here — press Publish again to apply them on top.`
        );
        window.setTimeout(() => setPublishState("idle"), 2400);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPublished(payload);
      setBaseUpdatedAt(data.updatedAt ?? null);
      setDraft(EMPTY_DRAFT);
      setPublishState("saved");
      const where =
        data.backend === "github"
          ? `Published — committed to ${data.path}. The site rebuilds in about a minute.`
          : `Published to ${data.path}.`;
      // The server drops anything that fails validation. Saying only
      // "Published" for an edit that was thrown away is a lie.
      const dropped = Array.isArray(data.rejected) ? data.rejected : [];
      setMessage(
        dropped.length
          ? `${where} ${dropped.length} edit${
              dropped.length === 1 ? " was" : "s were"
            } not applied: ${dropped.join("; ")}.`
          : where
      );
      window.setTimeout(() => setPublishState("idle"), 2000);
    } catch (e) {
      setPublishState("error");
      setMessage(`Publish failed: ${e?.message ?? e}`);
      window.setTimeout(() => setPublishState("idle"), 2400);
    }
  };

  const discardDraft = () => {
    setDraft(EMPTY_DRAFT);
    setMessage("Draft discarded — the panel now shows what's published.");
  };

  // Publishing an empty override set is how you get the stock wording
  // and the valuations-file numbers back on paper.
  const resetPublished = async () => {
    if (
      !window.confirm(
        "Clear every published value and field-name override for " +
          `${municipalityName || slug}? The sheet goes back to the valuations ` +
          "file and the stock wording." +
          (hasDraft
            ? `\n\nYour ${draftCount} unpublished edit${
                draftCount === 1 ? "" : "s"
              } will be discarded too.`
            : "")
      )
    ) {
      return;
    }
    setDraft(EMPTY_DRAFT);
    setPublishState("saving");
    try {
      const res = await fetch(`/api/print-settings/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...EMPTY_DRAFT, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPublished(EMPTY_DRAFT);
      setBaseUpdatedAt(data.updatedAt ?? null);
      setPublishState("idle");
      setMessage("All overrides cleared.");
    } catch (e) {
      setPublishState("error");
      setMessage(`Could not clear overrides: ${e?.message ?? e}`);
      window.setTimeout(() => setPublishState("idle"), 2400);
    }
  };

  if (!open) return null;

  const scopeLabel = barangaySlug
    ? coverageBarangays.find((b) => b.slug === barangaySlug)?.name ??
      barangaySlug
    : municipalityName || slug;
  // Hidden DXF/print preview LGUs print from the canonical data, not the
  // variant's own zones file — say so rather than handing over a sheet
  // that silently omits what is on screen.
  const isPreviewVariant = slug !== String(municipalitySlug ?? "").toLowerCase();

  return (
    <div
      className="print-panel-backdrop"
      style={{ top: navOffset }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside
        ref={panelRef}
        className="print-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-panel-title"
      >
        <header className="print-panel__head">
          <div>
            <h2 className="print-panel__title" id="print-panel-title">
              Print sheet
            </h2>
            <p className="print-panel__subtitle">
              {scopeLabel} · A3 {orientation}
            </p>
          </div>
          <button
            type="button"
            className="print-panel__close"
            onClick={() => onClose?.()}
            aria-label="Close print panel"
          >
            ×
          </button>
        </header>

        <div className="print-panel__tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`print-panel-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="print-panel-tabpanel"
              className={`print-panel__tab ${tab === id ? "is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
              {draftCountForTab[id] > 0 && (
                <span className="print-panel__tab-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>

        <div
          className="print-panel__body"
          id="print-panel-tabpanel"
          role="tabpanel"
          aria-labelledby={`print-panel-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "sheet" && (
            <>
              {isPreviewVariant && (
                <p className="print-panel__warning">
                  This is a preview variant. The sheet prints{" "}
                  <strong>{slug}</strong>&rsquo;s canonical zones, not the
                  preview geometry you see on the map.
                </p>
              )}
              <fieldset className="print-panel__group">
                <legend>Coverage</legend>
                <label className="print-panel__field">
                  <span>Area</span>
                  <select
                    value={barangaySlug}
                    onChange={(event) => setBarangaySlug(event.target.value)}
                  >
                    <option value="">
                      Whole municipality — {municipalityName || slug}
                    </option>
                    {coverageBarangays.map((barangay) => (
                      <option key={barangay.slug} value={barangay.slug}>
                        {barangay.name}
                      </option>
                    ))}
                  </select>
                  {unprintableCount > 0 && (
                    <small>
                      {unprintableCount} scheduled barangay
                      {unprintableCount === 1 ? "" : "s"} cannot be printed
                      separately — no boundary in{" "}
                      <code>{slug}_barangays.geojson</code>.
                    </small>
                  )}
                </label>
                <label className="print-panel__field">
                  <span>Orientation</span>
                  <select
                    value={orientation}
                    onChange={(event) => setOrientation(event.target.value)}
                  >
                    <option value="portrait">Portrait (297 × 420 mm)</option>
                    <option value="landscape">Landscape (420 × 297 mm)</option>
                  </select>
                </label>
              </fieldset>

              <fieldset className="print-panel__group">
                <legend>Rendering</legend>
                <label className="print-panel__field">
                  <span>Extra SMV band width</span>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    placeholder="0"
                    max={MAX_BUFFER_M}
                    value={smvBuffer}
                    onChange={(event) => setSmvBuffer(event.target.value)}
                  />
                  <small>
                    Metres per side (0&ndash;{MAX_BUFFER_M}), at render time
                    only. The saved geometry stays at the ordinance-true 30 m
                    depth of frontage.
                  </small>
                  {bufferNotice(smvBuffer) && (
                    <small className="print-panel__inline-warning">
                      {bufferNotice(smvBuffer)}
                    </small>
                  )}
                </label>
                <label className="print-panel__check">
                  <input
                    type="checkbox"
                    checked={showBuildings}
                    onChange={(event) => setShowBuildings(event.target.checked)}
                  />
                  <span>Building footprints</span>
                </label>
                <label className="print-panel__check">
                  <input
                    type="checkbox"
                    checked={showLocations}
                    onChange={(event) => setShowLocations(event.target.checked)}
                  />
                  <span>LOCATIONS panel (per-class location text)</span>
                </label>
              </fieldset>
            </>
          )}

          {tab === "values" && (
            <fieldset className="print-panel__group">
              <legend>Unit land values (₱ / m²)</legend>
              {loading && <p className="print-panel__note">Loading…</p>}
              {!loading && classKeys.length === 0 && (
                <p className="print-panel__note">
                  No classes found in <code>{slug}_valuations.json</code>.
                </p>
              )}
              {classKeys.map((klass) => {
                const base = publishedValueFor(klass);
                const overridden = published.classValues?.[klass] != null;
                return (
                  <label className="print-panel__row" key={klass}>
                    <span className="print-panel__row-label">
                      {klass}
                      {overridden && (
                        <em className="print-panel__badge">edited</em>
                      )}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      max={MAX_CLASS_VALUE}
                      inputMode="numeric"
                      placeholder={base == null ? "—" : String(base)}
                      value={draft.classValues?.[klass] ?? ""}
                      onChange={(event) =>
                        setClassValue(klass, event.target.value)
                      }
                    />
                  </label>
                );
              })}
              <p className="print-panel__note">
                Leave a box empty to keep the current value. These override the
                legend only — the official schedule in{" "}
                <code>{slug}_valuations.json</code> is left untouched.
              </p>
            </fieldset>
          )}

          {tab === "labels" &&
            labelGroups.map((group) => (
              <fieldset className="print-panel__group" key={group.name}>
                <legend>{group.name}</legend>
                {group.fields.map((field) => {
                  const overridden = published.labels?.[field.key] != null;
                  return (
                    <label
                      className="print-panel__row print-panel__row--text"
                      key={field.key}
                    >
                      <span className="print-panel__row-label">
                        {field.label}
                        {overridden && (
                          <em className="print-panel__badge">edited</em>
                        )}
                      </span>
                      <input
                        type="text"
                        maxLength={MAX_LABEL_LENGTH}
                        title={`Currently prints: ${publishedLabelFor(field.key)}`}
                        placeholder={publishedLabelFor(field.key)}
                        value={draft.labels?.[field.key] ?? ""}
                        onChange={(event) =>
                          setLabel(field.key, event.target.value)
                        }
                      />
                    </label>
                  );
                })}
              </fieldset>
            ))}
        </div>

        {message && (
          <p className="print-panel__message" role="status">
            {message}
          </p>
        )}

        <footer className="print-panel__foot">
          <div className="print-panel__foot-row">
            <button
              type="button"
              className="print-panel__button print-panel__button--primary"
              onClick={openPublishedSheet}
            >
              Open print sheet
            </button>
            <button
              type="button"
              className="print-panel__button"
              onClick={previewDraft}
              disabled={!hasDraft}
              title={
                hasDraft
                  ? "Render this sheet with your unpublished edits"
                  : "No unpublished edits"
              }
            >
              Preview draft
            </button>
          </div>
          <div className="print-panel__foot-row">
            <button
              type="button"
              className="print-panel__button"
              onClick={discardDraft}
              disabled={!hasDraft}
            >
              Discard draft
            </button>
            <button
              type="button"
              className="print-panel__button print-panel__button--publish"
              onClick={publish}
              disabled={!canEdit || !hasDraft || publishState === "saving"}
            >
              {publishState === "saving"
                ? "Publishing…"
                : hasDraft
                  ? `Publish ${draftCount} change${draftCount === 1 ? "" : "s"}`
                  : "Publish"}
            </button>
          </div>
          <button
            type="button"
            className="print-panel__link"
            onClick={resetPublished}
            disabled={!canEdit || publishState === "saving"}
          >
            Clear all published overrides
          </button>
          <p className="print-panel__hint">
            Edits stay in this browser until you publish. Publishing updates the
            sheet for everyone.
          </p>
        </footer>

        {/* Draft preview posts here — a form, because a POST response can
            only reach a new tab via a real form submission. */}
        <form
          ref={previewFormRef}
          action="/api/print/svg/preview"
          method="post"
          target="_blank"
          hidden
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="barangay" value={barangaySlug} />
          <input type="hidden" name="orientation" value={orientation} />
          <input type="hidden" name="smvBuffer" value={smvBuffer} />
          <input type="hidden" name="buildings" value={showBuildings ? "1" : "0"} />
          <input type="hidden" name="locations" value={showLocations ? "1" : "0"} />
          <input
            type="hidden"
            name="overrides"
            value={JSON.stringify({
              classValues: { ...published.classValues, ...draft.classValues },
              labels: { ...published.labels, ...draft.labels },
            })}
          />
        </form>
      </aside>
    </div>
  );
}
