// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Classes an LGU added after the schedule in lib/<slug>.js was
// transcribed.
//
// The per-municipality schedules are code, and they are the record of
// what the official GR Form No. 1 said. Rather than rewrite them, an
// added class is stored as data in public/data/<slug>_classes.json and
// merged over the code at runtime — so the transcription stays intact,
// and every addition is a small reviewable diff instead of a source edit
// that could break the build.
//
// A class code has to already exist in CLASSIFICATION_INFO (the
// province-wide catalog, C-1..C-12 / R-1..R-15 / INSTITUTIONAL). This is
// for giving a municipality a tier it does not currently use — Sadanga
// gaining a C-2, say — not for inventing new codes. Extending the
// catalog itself is a separate change in lib/classifications.js.
//
// Deletion works in two different ways, because the two kinds of class
// are not the same thing:
//   - an ADDED class is removed by publishing a list without it; it was
//     only ever data, so it simply stops existing.
//   - an OFFICIAL class (one transcribed into lib/<slug>.js) is removed by
//     naming it in `removed`. The transcription still says what the
//     document said; the municipality is stating that this tier no longer
//     applies to them. Reversible by un-naming it.
//
// Client-safe: no node:fs. The server reader lives in
// lib/added-classes-store.js.

import { CLASSIFICATION_INFO } from "./classifications.js";
import { MAX_CLASS_VALUE } from "./print-labels.js";

export const MAX_ADDED_CLASSES = 12;
export const MAX_LOCATION_LABEL = 1200;

export function categoryForClass(subClass) {
  const key = String(subClass ?? "").toUpperCase();
  if (key.startsWith("C-")) return "commercial";
  if (key.startsWith("R-")) return "residential";
  if (key === "INSTITUTIONAL") return "institutional";
  return "other";
}

// The schedule rows use a lowercase id ("c-1"); keep that convention so
// anything keying off `id` keeps working for added rows too.
export function idForClass(subClass) {
  return String(subClass ?? "").trim().toLowerCase();
}

function sanitizeLocationGroups(raw, validBarangaySlugs) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const group of raw.slice(0, 8)) {
    const label = String(group?.label ?? "").trim().slice(0, MAX_LOCATION_LABEL);
    const barangays = Array.isArray(group?.barangays)
      ? group.barangays
          .map((b) => String(b ?? "").trim().toLowerCase())
          .filter(
            (b) =>
              b &&
              (!validBarangaySlugs || validBarangaySlugs.has(b))
          )
      : [];
    if (!label && barangays.length === 0) continue;
    out.push({ label, barangays: Array.from(new Set(barangays)) });
  }
  return out;
}

// `existingSubClasses` are the codes already in the LGU's transcribed
// schedule. Re-adding one is rejected: that is an edit of the official
// record, which belongs in lib/<slug>.js, not an addition.
export function sanitizeAddedClasses(raw, options = {}) {
  const { existingSubClasses, validBarangaySlugs } = options;
  const existing = existingSubClasses
    ? new Set([...existingSubClasses].map((s) => String(s).toUpperCase()))
    : new Set();
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.classes) ? raw.classes : [];
  const out = [];
  const seen = new Set();

  for (const entry of list) {
    const subClass = String(entry?.subClass ?? "").trim().toUpperCase();
    if (!subClass) continue;
    if (!CLASSIFICATION_INFO[subClass]) continue; // not a known code
    if (subClass === "UNCLASSIFIED") continue;
    if (existing.has(subClass)) continue; // already in the official schedule
    if (seen.has(subClass)) continue;

    const rawValue = entry?.marketValue2027;
    let value = null;
    if (rawValue !== "" && rawValue != null) {
      const num =
        typeof rawValue === "number"
          ? rawValue
          : Number(String(rawValue).replace(/,/g, ""));
      if (Number.isFinite(num) && num >= 0 && num <= MAX_CLASS_VALUE) value = num;
      else continue; // a class with an unusable value would print as junk
    }

    seen.add(subClass);
    out.push({
      id: idForClass(subClass),
      subClass,
      category: categoryForClass(subClass),
      marketValue2027: value,
      locationGroups: sanitizeLocationGroups(entry?.locationGroups, validBarangaySlugs),
      // Marks the row as data rather than transcription, so the UI can
      // show it as removable and reviewers can tell the two apart.
      added: true,
    });
    if (out.length >= MAX_ADDED_CLASSES) break;
  }
  return out;
}

// Codes the municipality has withdrawn from its own schedule. Only codes
// actually in the transcription can be removed — naming anything else is
// meaningless and would hide a typo rather than report it.
export function sanitizeRemovedClasses(raw, options = {}) {
  const { existingSubClasses } = options;
  const existing = existingSubClasses
    ? new Set([...existingSubClasses].map((s) => String(s).toUpperCase()))
    : null;
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const entry of list) {
    const code = String(entry ?? "").trim().toUpperCase();
    if (!code || code === "UNCLASSIFIED") continue;
    if (existing && !existing.has(code)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

// Order added rows the way the legend does — commercial ladder, then
// residential, then everything else — so a C-2 lands between C-1 and C-3
// instead of at the bottom of the list.
function sortKey(row) {
  const sub = String(row?.subClass ?? "");
  const rank = sub.startsWith("C-") ? 0 : sub.startsWith("R-") ? 1 : 2;
  const num = Number(sub.match(/-(\d+)$/)?.[1] ?? 0);
  return [rank, num, sub];
}

export function mergeClassifications(base = [], added = [], removed = []) {
  const drop = new Set((removed ?? []).map((c) => String(c).toUpperCase()));
  const kept = drop.size
    ? (base ?? []).filter(
        (row) => !drop.has(String(row?.subClass ?? "").toUpperCase())
      )
    : base ?? [];
  if (!added.length) return kept;
  const existing = new Set(
    kept.map((row) => String(row?.subClass ?? "").toUpperCase())
  );
  const extra = added.filter((row) => !existing.has(row.subClass));
  if (!extra.length) return kept;
  return [...kept, ...extra].sort((a, b) => {
    const [ra, na, sa] = sortKey(a);
    const [rb, nb, sb] = sortKey(b);
    return ra - rb || na - nb || sa.localeCompare(sb);
  });
}

// The values an added class contributes to the printed legend.
export function addedClassValues(added = []) {
  const out = {};
  for (const row of added) {
    if (row?.subClass && row.marketValue2027 != null) {
      out[row.subClass] = row.marketValue2027;
    }
  }
  return out;
}
