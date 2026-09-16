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
  maxLengthFor,
  PRINT_LABEL_DEFAULTS,
  normalizePrintSettings,
  printLabelGroups,
} from "@/lib/print-labels";
import { basePrintSlug } from "@/lib/print-slugs";
import { MAX_PRINT_ZOOM, MIN_PRINT_ZOOM } from "@/lib/print-zoom";
import {
  CLASSIFICATION_INFO,
  DEFAULT_CLASS_COLORS,
  sanitizeClassColors,
} from "@/lib/classifications";
import { MAX_ADDED_CLASSES } from "@/lib/added-classes";
import {
  PRINT_THEME_DEFAULTS,
  printThemeGroups,
  sanitizePrintTheme,
} from "@/lib/print-theme";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAccess } from "./AccessContext";

const DRAFT_KEY_PREFIX = "smv-print-draft-v1:";
const TABS = [
  ["sheet", "Sheet"],
  ["values", "Values"],
  ["labels", "Field names"],
  ["colors", "Colors"],
  ["classes", "Classes"],
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

// The zoom box is free text while being typed; everything downstream —
// the slider, the URL, the preview — uses the clamped value so they can
// never disagree with what actually prints.
function clampZoomPct(raw) {
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.round(Math.min(MAX_PRINT_ZOOM * 100, Math.max(MIN_PRINT_ZOOM * 100, n)));
}

function zoomNotice(raw) {
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return "Not a number — printing at 100%.";
  if (n > MAX_PRINT_ZOOM * 100) return `Capped at ${MAX_PRINT_ZOOM * 100}%.`;
  if (n < MIN_PRINT_ZOOM * 100) return `Raised to the ${MIN_PRINT_ZOOM * 100}% minimum.`;
  if (n > 100) return "Above 100% the edges of the area fall off the sheet.";
  return null;
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
  // Called with the new palette the moment one is published, so the map
  // on screen repaints without waiting for a reload.
  onPaletteChange,
  // Called after the class list is published, so the map's drawing
  // toolbar picks up a new class without a reload.
  onClassesChange,
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
  // Percent, as typed. 100 = fit the subject to the page, which is what
  // every sheet did before this control existed.
  const [zoomPct, setZoomPct] = useState(100);

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
  // The palette is province-wide, not per-LGU, so it lives in its own
  // state and its own file. `paletteDraft` holds unpublished edits.
  const [palette, setPalette] = useState({});
  const [paletteDraft, setPaletteDraft] = useState({});
  const [theme, setTheme] = useState({});
  const [themeDraft, setThemeDraft] = useState({});
  const [paletteUpdatedAt, setPaletteUpdatedAt] = useState(null);
  const [paletteState, setPaletteState] = useState("idle");
  // Whether /api/palette actually answered. An empty `colors` map is
  // ambiguous — it means both "the editor reset every class to stock" and
  // "the fetch failed and we know nothing" — and the preview route can't
  // tell them apart. So the hidden colours field is only submitted once
  // we genuinely know the palette; otherwise the preview falls back to
  // whatever is published on disk, which is the truthful answer.
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  // Per-LGU class edits: classes this municipality added, and official
  // ones it has withdrawn. Published as one list.
  const [addedClasses, setAddedClasses] = useState([]);
  const [removedClasses, setRemovedClasses] = useState([]);
  const [officialClasses, setOfficialClasses] = useState([]);
  const [classesUpdatedAt, setClassesUpdatedAt] = useState(null);
  const [classesState, setClassesState] = useState("idle");
  const [newClass, setNewClass] = useState({ subClass: "", value: "", label: "" });
  // How many drawn zones use each class. A class with zones cannot simply
  // be removed — its polygons would keep a classification that no longer
  // exists anywhere in the UI. `pendingRemoval` drives the little inline
  // form that makes the editor say where those zones should go.
  const [zoneCounts, setZoneCounts] = useState({});
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [reassignTo, setReassignTo] = useState("");
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
      const [valuations, settings, paletteRes, classesRes] = await Promise.all([
        fetch(`/data/${slug}_valuations.json`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/print-settings/${slug}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/palette", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/classes/${slug}`, { cache: "no-store" })
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
      setPalette(paletteRes?.colors ?? {});
      setTheme(paletteRes?.theme ?? {});
      setPaletteUpdatedAt(paletteRes?.updatedAt ?? null);
      setPaletteLoaded(Boolean(paletteRes?.ok));
      setAddedClasses(classesRes?.classes ?? []);
      setRemovedClasses(classesRes?.removed ?? []);
      setOfficialClasses(classesRes?.existingSubClasses ?? []);
      setClassesUpdatedAt(classesRes?.updatedAt ?? null);
      setZoneCounts(classesRes?.zoneCounts ?? {});
      setPendingRemoval(null);
      setReassignTo("");
      setNewClass({ subClass: "", value: "", label: "" });
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
    setZoomPct(100);
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

  // The colour a class prints right now: draft wins, then the published
  // palette, then the stock value from lib/classifications.js.
  const effectiveColor = useCallback(
    (klass) =>
      paletteDraft[klass] ?? palette[klass] ?? DEFAULT_CLASS_COLORS[klass],
    [paletteDraft, palette]
  );
  const themeGroups = useMemo(() => printThemeGroups(), []);
  const effectiveTheme = useCallback(
    (key) => themeDraft[key] ?? theme[key] ?? PRINT_THEME_DEFAULTS[key],
    [themeDraft, theme]
  );
  const paletteDraftCount =
    Object.keys(paletteDraft).length + Object.keys(themeDraft).length;

  // Preview the draft on the live map.
  //
  // Picking a colour used to change nothing until Publish — and Publish
  // commits to the repo and redeploys, so seeing a colour meant making it
  // permanent for everyone first. The draft now paints immediately;
  // Publish is still what shares it. Nothing is written until then, and a
  // reload drops the draft and returns to the published palette.
  useEffect(() => {
    if (!paletteLoaded) return;
    onPaletteChange?.({
      colors: { ...palette, ...paletteDraft },
      theme: { ...theme, ...themeDraft },
    });
  }, [paletteDraft, themeDraft, palette, theme, paletteLoaded, onPaletteChange]);

  // Only the classes this LGU actually uses, so the list is short and
  // relevant instead of all 29 province-wide classes.
  const colorKeys = useMemo(() => {
    const present = classKeys.filter((k) => DEFAULT_CLASS_COLORS[k]);
    if (!present.length) return [];
    // classKeys already contains INSTITUTIONAL once someone publishes a
    // value for it, so dedupe rather than appending blindly — otherwise
    // the list renders two identical rows with a duplicate React key.
    // INSTITUTIONAL and UNCLASSIFIED both paint on the sheet but are not
    // part of the commercial/residential ladders, so they never arrive via
    // classKeys. Append them explicitly, deduped.
    return [...new Set([...present, "INSTITUTIONAL", "UNCLASSIFIED"])];
  }, [classKeys]);

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
  // The palette draft is separate state (it is province-wide, not per-LGU),
  // so anything asking "is there something unpublished to preview?" has to
  // consider it too — otherwise Preview draft sits disabled saying "no
  // unpublished edits" while the Colors tab shows a draft.
  const hasAnyDraft = hasDraft || paletteDraftCount > 0;
  // Per-tab, so the dot tells you WHERE the unpublished edit is.
  const draftCountForTab = {
    values: valueDraftCount,
    labels: labelDraftCount,
    colors: Object.keys(paletteDraft).length + Object.keys(themeDraft).length,
  };

  const printQuery = () => {
    const params = new URLSearchParams();
    const buffer = clampBuffer(smvBuffer);
    if (buffer > 0) params.set("smvBuffer", String(buffer));
    if (!showBuildings) params.set("buildings", "0");
    const zoom = clampZoomPct(zoomPct) / 100;
    if (Math.abs(zoom - 1) > 0.001) params.set("zoom", String(zoom));
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

  // The whole list is published at once: adding, deleting an added class,
  // and withdrawing an official one are all just "here is the new list".
  const publishClasses = async (nextAdded, nextRemoved, allowStranded = false) => {
    setClassesState("saving");
    setMessage("");
    try {
      const res = await fetch(`/api/classes/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classes: nextAdded,
          removed: nextRemoved,
          baseUpdatedAt: classesUpdatedAt,
          // Set only after this panel has already reassigned the zones.
          allowStranded,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setAddedClasses(data.current?.classes ?? []);
        setRemovedClasses(data.current?.removed ?? []);
        setClassesUpdatedAt(data.current?.updatedAt ?? null);
        setClassesState("idle");
        setMessage(`${data.error} Nothing was changed.`);
        return false;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAddedClasses(data.classes ?? []);
      if (Array.isArray(data.rejected) && data.rejected.length) {
        setMessage(
          `Saved, but ${data.rejected.length} class${
            data.rejected.length === 1 ? " was" : "es were"
          } not added: ${data.rejected.join(", ")}.`
        );
      }
      setRemovedClasses(data.removed ?? []);
      setClassesUpdatedAt(data.updatedAt ?? null);
      setClassesState("idle");
      onClassesChange?.({ classes: data.classes ?? [], removed: data.removed ?? [] });
      setMessage(
        data.backend === "github"
          ? `Classes updated — committed to ${data.path}. The site rebuilds in about a minute.`
          : `Classes updated in ${data.path}.`
      );
      return true;
    } catch (e) {
      setClassesState("idle");
      setMessage(`Could not update classes: ${e?.message ?? e}`);
      return false;
    }
  };

  // Every class this LGU can currently draw in — the reassignment targets.
  const liveClassCodes = useMemo(() => {
    const codes = [
      ...officialClasses.filter((c) => !removedClasses.includes(c)),
      ...addedClasses.map((c) => c.subClass),
    ];
    return Array.from(new Set(codes));
  }, [officialClasses, removedClasses, addedClasses]);

  // Begin a removal. With zones attached we stop and ask; without, it is
  // safe to go straight through.
  const beginRemoval = (code, kind) => {
    const count = zoneCounts[code] ?? 0;
    if (count > 0) {
      setPendingRemoval({ code, kind, count });
      setReassignTo("");
      setMessage("");
      return;
    }
    if (
      window.confirm(
        `${kind === "added" ? "Delete" : "Withdraw"} ${code} from ${
          municipalityName || slug
        }? No zones are drawn in it.`
      )
    ) {
      applyRemoval(code, kind);
    }
  };

  const applyRemoval = (code, kind, allowStranded = false) =>
    kind === "added"
      ? publishClasses(
          addedClasses.filter((c) => c.subClass !== code),
          removedClasses,
          allowStranded
        )
      : publishClasses(addedClasses, [...removedClasses, code], allowStranded);

  // Move the zones first, then remove the class. If the move fails the
  // class stays, so there is never a moment where zones point at a class
  // that is already gone.
  const confirmRemoval = async () => {
    if (!pendingRemoval || !reassignTo) return;
    const { code, kind, count } = pendingRemoval;
    setClassesState("saving");
    setMessage("");
    try {
      const res = await fetch(`/api/classes/${slug}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: code, to: reassignTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // The zones just moved, so the server's stranding guard would now
      // see zero — but say so explicitly rather than relying on timing.
      const ok = await applyRemoval(code, kind, true);
      if (ok) {
        setZoneCounts((prev) => {
          const next = { ...prev };
          next[reassignTo] = (next[reassignTo] ?? 0) + (next[code] ?? 0);
          delete next[code];
          return next;
        });
        setPendingRemoval(null);
        setReassignTo("");
        setMessage(
          `${count} zone${count === 1 ? "" : "s"} moved from ${code} to ${reassignTo}, and ${code} removed.`
        );
      }
    } catch (e) {
      setClassesState("idle");
      setMessage(
        `Could not complete: ${e?.message ?? e}. ${code} was NOT removed — ` +
          `check whether its zones were already moved before retrying.`
      );
    }
  };

  const addClass = async () => {
    const code = newClass.subClass.trim().toUpperCase();
    if (!code) return;
    const entry = {
      subClass: code,
      marketValue2027: newClass.value,
      locationGroups: newClass.label.trim()
        ? [{ label: newClass.label.trim(), barangays: [] }]
        : [],
    };
    const ok = await publishClasses([...addedClasses, entry], removedClasses);
    if (ok) setNewClass({ subClass: "", value: "", label: "" });
  };

  const publishPalette = async () => {
    setPaletteState("saving");
    setMessage("");
    const merged = sanitizeClassColors({ ...palette, ...paletteDraft });
    const mergedTheme = sanitizePrintTheme({ ...theme, ...themeDraft });
    try {
      const res = await fetch("/api/palette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colors: merged,
          theme: mergedTheme,
          baseUpdatedAt: paletteUpdatedAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPalette(data.current?.colors ?? {});
        setTheme(data.current?.theme ?? {});
        setPaletteUpdatedAt(data.current?.updatedAt ?? null);
        setPaletteState("idle");
        setMessage(
          `${data.error} Your colours are still here — press Publish colours again to apply them on top.`
        );
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPalette(data.colors ?? {});
      setTheme(data.theme ?? {});
      setPaletteUpdatedAt(data.updatedAt ?? null);
      setPaletteDraft({});
      setThemeDraft({});
      setPaletteState("idle");
      // Repaint the live map immediately so screen and paper agree.
      onPaletteChange?.({ colors: data.colors ?? {}, theme: data.theme ?? {} });
      setMessage(
        data.backend === "github"
          ? `Colours published — committed to ${data.path}. The site rebuilds in about a minute.`
          : `Colours published to ${data.path}. They apply to every municipality.`
      );
    } catch (e) {
      setPaletteState("idle");
      setMessage(`Could not publish colours: ${e?.message ?? e}`);
    }
  };

  const resetPalette = async () => {
    if (
      !window.confirm(
        "Reset every colour — SMV classes, roads, boundaries and basemap — " +
          "back to the stock palette, for all ten municipalities?" +
          (paletteDraftCount > 0
            ? `\n\nYour ${paletteDraftCount} unpublished colour change${
                paletteDraftCount === 1 ? "" : "s"
              } will be discarded too.`
            : "")
      )
    ) {
      return;
    }
    setPaletteDraft({});
    setThemeDraft({});
    setPaletteState("saving");
    try {
      const res = await fetch("/api/palette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors: {}, theme: {}, baseUpdatedAt: paletteUpdatedAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPalette(data.current?.colors ?? {});
        setTheme(data.current?.theme ?? {});
        setPaletteUpdatedAt(data.current?.updatedAt ?? null);
        setPaletteState("idle");
        setMessage(`${data.error} Nothing was reset.`);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPalette({});
      setTheme({});
      setPaletteUpdatedAt(data.updatedAt ?? null);
      setPaletteState("idle");
      onPaletteChange?.({ colors: {}, theme: {} });
      setMessage("Colours reset to the stock palette.");
    } catch (e) {
      setPaletteState("idle");
      setMessage(`Could not reset colours: ${e?.message ?? e}`);
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
                        {/* PSA maps some sitios only as part of a parent
                            barangay; say so here rather than letting the
                            user find out after printing. */}
                        {barangay.mappedVia
                          ? ` — mapped on ${barangay.mappedVia}`
                          : ""}
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
                <label className="print-panel__field">
                  <span>Zoom</span>
                  <span className="print-panel__zoom">
                    <input
                      type="range"
                      min={MIN_PRINT_ZOOM * 100}
                      max={MAX_PRINT_ZOOM * 100}
                      step="5"
                      value={clampZoomPct(zoomPct)}
                      onChange={(event) => setZoomPct(Number(event.target.value))}
                    />
                    <input
                      type="number"
                      className="print-panel__zoom-num"
                      aria-label="Zoom percent"
                      min={MIN_PRINT_ZOOM * 100}
                      max={MAX_PRINT_ZOOM * 100}
                      step="5"
                      value={zoomPct}
                      onChange={(event) => setZoomPct(event.target.value)}
                      // min/max are not enforced while typing, so an
                      // out-of-range value used to sit in the box, desync
                      // from the slider, and print as something else.
                      onBlur={(event) => setZoomPct(clampZoomPct(event.target.value))}
                    />
                    <span className="print-panel__zoom-unit">%</span>
                    <button
                      type="button"
                      className="print-panel__reset-one"
                      disabled={clampZoomPct(zoomPct) === 100}
                      onClick={() => setZoomPct(100)}
                    >
                      Fit
                    </button>
                  </span>
                  <small>
                    100% fits the whole area to the page. Zoom is centred —
                    there is no panning.
                  </small>
                  {zoomNotice(zoomPct) && (
                    <small className="print-panel__inline-warning">
                      {zoomNotice(zoomPct)}
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

          {tab === "classes" && (
            <>
              <fieldset className="print-panel__group">
                <legend>Add a class to {municipalityName || slug}</legend>
                <p className="print-panel__note">
                  For a tier this municipality uses but that was not in the
                  transcribed schedule. The code must be one the province-wide
                  catalogue already defines, and one this LGU does not already
                  have.
                </p>
                <label className="print-panel__field">
                  <span>Class code</span>
                  <select
                    value={newClass.subClass}
                    onChange={(event) =>
                      setNewClass((p) => ({ ...p, subClass: event.target.value }))
                    }
                  >
                    <option value="">Choose a code…</option>
                    {Object.keys(CLASSIFICATION_INFO)
                      .filter(
                        (k) =>
                          k !== "UNCLASSIFIED" &&
                          !officialClasses.includes(k) &&
                          !addedClasses.some((c) => c.subClass === k)
                      )
                      .map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="print-panel__field">
                  <span>Unit land value (₱ / m²)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={newClass.value}
                    onChange={(event) =>
                      setNewClass((p) => ({ ...p, value: event.target.value }))
                    }
                  />
                </label>
                <label className="print-panel__field">
                  <span>Location description (optional)</span>
                  <input
                    type="text"
                    placeholder="Commercial lots along…"
                    value={newClass.label}
                    onChange={(event) =>
                      setNewClass((p) => ({ ...p, label: event.target.value }))
                    }
                  />
                  <small>
                    Printed in the LOCATIONS panel when that option is on.
                  </small>
                </label>
                <button
                  type="button"
                  className="print-panel__button print-panel__button--publish"
                  onClick={addClass}
                  disabled={
                    !canEdit ||
                    !newClass.subClass ||
                    newClass.value === "" ||
                    classesState === "saving" ||
                    addedClasses.length >= MAX_ADDED_CLASSES
                  }
                >
                  {classesState === "saving" ? "Saving…" : "Add class"}
                </button>
              </fieldset>

              {pendingRemoval && (
                <fieldset className="print-panel__group print-panel__group--warn">
                  <legend>Reassign before removing</legend>
                  <p className="print-panel__note">
                    <strong>{pendingRemoval.count}</strong> zone
                    {pendingRemoval.count === 1 ? " is" : "s are"} drawn in{" "}
                    <strong>{pendingRemoval.code}</strong>. Removing the class
                    without moving them would leave those polygons classified as
                    something that no longer exists — still printed, but no
                    longer editable. Choose where they go.
                  </p>
                  <label className="print-panel__field">
                    <span>Move the zones to</span>
                    <select
                      value={reassignTo}
                      onChange={(event) => setReassignTo(event.target.value)}
                    >
                      <option value="">Choose a class…</option>
                      {liveClassCodes
                        .filter((c) => c !== pendingRemoval.code)
                        .map((c) => (
                          <option key={c} value={c}>
                            {c}
                            {zoneCounts[c] ? ` — ${zoneCounts[c]} zones today` : ""}
                          </option>
                        ))}
                      <option value="UNCLASSIFIED">
                        UNCLASSIFIED — park them until reviewed
                      </option>
                    </select>
                  </label>
                  <div className="print-panel__foot-row">
                    <button
                      type="button"
                      className="print-panel__button"
                      onClick={() => {
                        setPendingRemoval(null);
                        setReassignTo("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="print-panel__button print-panel__button--publish"
                      onClick={confirmRemoval}
                      disabled={!canEdit || !reassignTo || classesState === "saving"}
                    >
                      {classesState === "saving"
                        ? "Moving…"
                        : `Move ${pendingRemoval.count} and remove`}
                    </button>
                  </div>
                </fieldset>
              )}

              <fieldset className="print-panel__group">
                <legend>Added classes ({addedClasses.length})</legend>
                {addedClasses.length === 0 && (
                  <p className="print-panel__note">
                    None yet. Anything added here is drawable on the map and
                    appears in the printed legend.
                  </p>
                )}
                {addedClasses.map((row) => (
                  <div className="print-panel__row" key={row.subClass}>
                    <span className="print-panel__row-label">
                      <span
                        className="print-panel__class-swatch"
                        style={{ background: DEFAULT_CLASS_COLORS[row.subClass] }}
                        aria-hidden="true"
                      />
                      {row.subClass}
                      <em className="print-panel__badge">added</em>
                    </span>
                    <span className="print-panel__color-controls">
                      <code className="print-panel__hex">
                        ₱{Number(row.marketValue2027 ?? 0).toLocaleString("en-US")}
                      </code>
                      <span className="print-panel__zone-count">
                        {zoneCounts[row.subClass] ?? 0} zones
                      </span>
                      <button
                        type="button"
                        className="print-panel__reset-one"
                        disabled={!canEdit || classesState === "saving"}
                        onClick={() => beginRemoval(row.subClass, "added")}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </fieldset>

              <fieldset className="print-panel__group">
                <legend>Official schedule</legend>
                <p className="print-panel__note">
                  Transcribed from this LGU&rsquo;s GR Form No. 1. Withdrawing one
                  hides it from the map and the sheet; the transcription in the
                  code is never rewritten, so it can be restored.
                </p>
                {officialClasses.map((code) => {
                  const isRemoved = removedClasses.includes(code);
                  return (
                    <div className="print-panel__row" key={code}>
                      <span className="print-panel__row-label">
                        <span
                          className="print-panel__class-swatch"
                          style={{ background: DEFAULT_CLASS_COLORS[code] }}
                          aria-hidden="true"
                        />
                        <span className={isRemoved ? "print-panel__struck" : undefined}>
                          {code}
                        </span>
                        {isRemoved && <em className="print-panel__badge">withdrawn</em>}
                      </span>
                      <span className="print-panel__color-controls">
                        <span className="print-panel__zone-count">
                          {zoneCounts[code] ?? 0} zones
                        </span>
                        <button
                          type="button"
                          className="print-panel__reset-one"
                          disabled={!canEdit || classesState === "saving"}
                          onClick={() =>
                            isRemoved
                              ? publishClasses(
                                  addedClasses,
                                  removedClasses.filter((c) => c !== code)
                                )
                              : beginRemoval(code, "official")
                          }
                        >
                          {isRemoved ? "Restore" : "Withdraw"}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </fieldset>
            </>
          )}

          {tab === "colors" && (
            <fieldset className="print-panel__group">
              <legend>SMV class colours</legend>
              <p className="print-panel__warning">
                Colours are shared by all ten municipalities, so C-1 means
                the same colour on every sheet. Publishing here changes the
                map and the printed legend everywhere.
              </p>
              {paletteDraftCount > 0 && (
                <p className="print-panel__warning">
                  The map is previewing your {paletteDraftCount} unpublished
                  colour{paletteDraftCount === 1 ? "" : "s"}. Nothing is saved
                  until you publish; a reload returns to the published palette.
                </p>
              )}
              {loading && <p className="print-panel__note">Loading…</p>}
              {!loading && !paletteLoaded && (
                <p className="print-panel__inline-warning">
                  Could not load the published palette, so these swatches show
                  the stock colours and may not match what prints. Close and
                  reopen the panel to retry.
                </p>
              )}
              {colorKeys.map((klass) => {
                const current = effectiveColor(klass);
                // <input type="color"> emits lowercase; the stock palette
                // is written uppercase. Compare case-insensitively or
                // hand-picking the exact stock colour reads as "edited".
                const isStock =
                  String(current).toLowerCase() ===
                  String(DEFAULT_CLASS_COLORS[klass]).toLowerCase();
                return (
                  <div className="print-panel__row print-panel__row--color" key={klass}>
                    <span className="print-panel__row-label">
                      {klass}
                      {!isStock && <em className="print-panel__badge">edited</em>}
                    </span>
                    <span className="print-panel__color-controls">
                      <input
                        type="color"
                        aria-label={`${klass} colour`}
                        value={current}
                        onChange={(event) =>
                          setPaletteDraft((prev) => ({
                            ...prev,
                            [klass]: event.target.value.toLowerCase(),
                          }))
                        }
                      />
                      <code className="print-panel__hex">{current}</code>
                      <button
                        type="button"
                        className="print-panel__reset-one"
                        title={`Reset ${klass} to ${DEFAULT_CLASS_COLORS[klass]}`}
                        disabled={isStock}
                        onClick={() =>
                          setPaletteDraft((prev) => {
                            // Dropping the entry is the reset — leaving a
                            // stock value in the draft would inflate the
                            // "Publish N colours" count with a no-op.
                            const next = { ...prev };
                            delete next[klass];
                            if (palette[klass]) next[klass] = DEFAULT_CLASS_COLORS[klass];
                            return next;
                          })
                        }
                      >
                        Reset
                      </button>
                    </span>
                  </div>
                );
              })}
            </fieldset>
          )}

          {tab === "colors" &&
            themeGroups.map((group) => (
              <fieldset className="print-panel__group" key={group.name}>
                <legend>{group.name}</legend>
                {group.fields.map((field) => {
                  const current = effectiveTheme(field.key);
                  const isStock =
                    String(current).toLowerCase() ===
                    String(PRINT_THEME_DEFAULTS[field.key]).toLowerCase();
                  return (
                    <div className="print-panel__row print-panel__row--color" key={field.key}>
                      <span className="print-panel__row-label">
                        {field.label}
                        {!isStock && <em className="print-panel__badge">edited</em>}
                      </span>
                      <span className="print-panel__color-controls">
                        <input
                          type="color"
                          aria-label={`${field.label} colour`}
                          value={current}
                          onChange={(event) =>
                            setThemeDraft((prev) => ({
                              ...prev,
                              [field.key]: event.target.value.toLowerCase(),
                            }))
                          }
                        />
                        <code className="print-panel__hex">{current}</code>
                        <button
                          type="button"
                          className="print-panel__reset-one"
                          title={`Reset to ${PRINT_THEME_DEFAULTS[field.key]}`}
                          disabled={isStock}
                          onClick={() =>
                            setThemeDraft((prev) => {
                              const next = { ...prev };
                              delete next[field.key];
                              if (theme[field.key]) {
                                next[field.key] = PRINT_THEME_DEFAULTS[field.key];
                              }
                              return next;
                            })
                          }
                        >
                          Reset
                        </button>
                      </span>
                    </div>
                  );
                })}
              </fieldset>
            ))}

          {tab === "colors" && (
            <fieldset className="print-panel__group">
              <legend>Publish</legend>
              <div className="print-panel__foot-row">
                <button
                  type="button"
                  className="print-panel__button"
                  onClick={() => {
                    setPaletteDraft({});
                    setThemeDraft({});
                  }}
                  disabled={paletteDraftCount === 0}
                >
                  Discard colour changes
                </button>
                <button
                  type="button"
                  className="print-panel__button print-panel__button--publish"
                  onClick={publishPalette}
                  disabled={
                    !canEdit ||
                    !paletteLoaded ||
                    paletteDraftCount === 0 ||
                    paletteState === "saving"
                  }
                >
                  {paletteState === "saving"
                    ? "Publishing…"
                    : `Publish ${paletteDraftCount || ""} colour${
                        paletteDraftCount === 1 ? "" : "s"
                      }`.replace("  ", " ")}
                </button>
              </div>
              <button
                type="button"
                className="print-panel__link"
                onClick={resetPalette}
                disabled={!canEdit || paletteState === "saving"}
              >
                Reset all colours to the stock palette
              </button>
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
                        maxLength={maxLengthFor(field.key)}
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
          {/* Values and field names publish from here; the Colors tab has
              its own Publish because the palette is a separate, province-
              wide file. Showing both at once overlapped the colour rows
              and offered two buttons that did different things. */}
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
              disabled={!hasAnyDraft}
              title={
                hasAnyDraft
                  ? "Render this sheet with your unpublished edits"
                  : "No unpublished edits"
              }
            >
              Preview draft
            </button>
          </div>
          {tab !== "colors" && tab !== "classes" && (
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
          )}
          {tab !== "colors" && tab !== "classes" && (
          <button
            type="button"
            className="print-panel__link"
            onClick={resetPublished}
            disabled={!canEdit || publishState === "saving"}
          >
            Clear all published overrides
          </button>
          )}
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
          <input type="hidden" name="zoom" value={clampZoomPct(zoomPct) / 100} />
          <input type="hidden" name="buildings" value={showBuildings ? "1" : "0"} />
          <input type="hidden" name="locations" value={showLocations ? "1" : "0"} />
          {/* Omitted entirely when the palette never loaded — see
              paletteLoaded above. */}
          {paletteLoaded && (
            <input
              type="hidden"
              name="colors"
              value={JSON.stringify({ ...palette, ...paletteDraft })}
            />
          )}
          {paletteLoaded && (
            <input
              type="hidden"
              name="theme"
              value={JSON.stringify({ ...theme, ...themeDraft })}
            />
          )}
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
