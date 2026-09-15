// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Editable field names ("labels") for the printed A3 sheet.
//
// Every piece of fixed wording the print SVG draws — the sheet title,
// the MUNICIPALITY/PROVINCE OF/ISLAND OF row captions, the legend
// column headers, the road-tier names, the prepared-by block — lives
// here as a default. An unlocked editor can override any of them from
// the Print panel; the overrides are persisted per LGU in
// public/data/<slug>_print_settings.json and merged over these
// defaults at render time.
//
// Shared by:
//   - lib/print-svg-builder.js  (render side)
//   - components/PrintPanel.js  (edit side — drives the form)
// so the form can never drift from what the renderer actually draws.

// Hard bounds. Without them a long caption or an absurd value silently
// destroys the sheet: the title is one un-wrapped, middle-anchored
// <text>, so a 400-character string measured 1465 mm wide on a 297 mm
// page, and a 24-digit value overprinted the neighbouring legend column.
// Clamping here means every writer — API, CLI, preview — is bounded.
export const MAX_LABEL_LENGTH = 60;
export const MAX_CLASS_VALUE = 100_000_000;

export const PRINT_LABEL_FIELDS = Object.freeze([
  // --- Title block ---
  { key: "title", group: "Title block", label: "Sheet title", default: "UNIT LAND VALUE MAP" },
  { key: "barangayLabel", group: "Title block", label: "Barangay caption", default: "BARANGAY:" },
  { key: "municipalityLabel", group: "Title block", label: "Municipality caption", default: "MUNICIPALITY:" },
  { key: "provinceLabel", group: "Title block", label: "Province caption", default: "PROVINCE OF:" },
  { key: "provinceValue", group: "Title block", label: "Province value", default: "MOUNTAIN PROVINCE" },
  { key: "islandLabel", group: "Title block", label: "Island caption", default: "ISLAND OF:" },
  { key: "islandValue", group: "Title block", label: "Island value", default: "LUZON" },

  // --- Legend ---
  { key: "legendLabel", group: "Legend", label: "Legend caption", default: "LEGEND:" },
  { key: "commercialHeader", group: "Legend", label: "Commercial column", default: "Commercial" },
  { key: "residentialHeader", group: "Legend", label: "Residential column", default: "Residential" },
  { key: "roadsHeader", group: "Legend", label: "Roads column", default: "Roads" },
  { key: "landmarksHeader", group: "Legend", label: "Landmarks column", default: "Landmarks" },
  { key: "institutionalLabel", group: "Legend", label: "Institutional row", default: "Institutional" },
  { key: "currencySymbol", group: "Legend", label: "Currency symbol", default: "₱" },

  // --- Road tiers ---
  { key: "roadNationalLabel", group: "Road tiers", label: "National", default: "National" },
  { key: "roadProvincialLabel", group: "Road tiers", label: "Provincial", default: "Provincial" },
  { key: "roadBarangayLabel", group: "Road tiers", label: "Barangay", default: "Barangay" },
  { key: "roadOtherLabel", group: "Road tiers", label: "Other", default: "Other" },

  // --- Locations panel (only drawn with ?locations=1) ---
  { key: "locationsHeader", group: "Locations panel", label: "Panel heading", default: "LOCATIONS" },

  // --- Prepared-by block ---
  { key: "preparedByLabel", group: "Prepared by", label: "Caption", default: "Prepared by:" },
  { key: "preparedByName", group: "Prepared by", label: "Name", default: "Rinar M. Dengwas" },
  { key: "preparedByTitle", group: "Prepared by", label: "Position", default: "Programmer" },
]);

export const PRINT_LABEL_DEFAULTS = Object.freeze(
  Object.fromEntries(PRINT_LABEL_FIELDS.map((f) => [f.key, f.default]))
);

export const PRINT_LABEL_KEYS = Object.freeze(
  PRINT_LABEL_FIELDS.map((f) => f.key)
);

// Group the field list for the edit form, preserving declaration order.
export function printLabelGroups() {
  const groups = [];
  for (const field of PRINT_LABEL_FIELDS) {
    let bucket = groups.find((g) => g.name === field.group);
    if (!bucket) {
      bucket = { name: field.group, fields: [] };
      groups.push(bucket);
    }
    bucket.fields.push(field);
  }
  return groups;
}

// Merge user overrides over the defaults. Unknown keys are dropped and
// blank/whitespace-only overrides fall back to the default, so a user
// clearing a field restores the stock wording rather than printing an
// empty caption.
export function resolvePrintLabels(overrides) {
  const out = { ...PRINT_LABEL_DEFAULTS };
  if (!overrides || typeof overrides !== "object") return out;
  for (const key of PRINT_LABEL_KEYS) {
    const value = overrides[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

// Keep only the overrides that actually differ from the default, so the
// persisted file stays a small diff rather than a full copy. Makes it
// obvious in git what an editor changed.
export function compactPrintLabels(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== "object") return out;
  for (const key of PRINT_LABEL_KEYS) {
    const value = overrides[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
    if (trimmed && trimmed !== PRINT_LABEL_DEFAULTS[key]) out[key] = trimmed;
  }
  return out;
}

// Class value overrides: `{ "C-1": 5170, "R-3": 2100 }`. Values must be
// finite non-negative numbers; anything else is dropped rather than
// silently rendering as NaN on paper.
export function compactClassValues(values) {
  const out = {};
  if (!values || typeof values !== "object") return out;
  for (const [klass, raw] of Object.entries(values)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(klass)) continue;
    if (raw === "" || raw == null) continue;
    const num = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(num) || num < 0 || num > MAX_CLASS_VALUE) continue;
    out[klass.toUpperCase()] = num;
  }
  return out;
}

// Normalize a whole settings payload (whatever came from localStorage,
// the network, or the on-disk file) into the canonical shape.
export function normalizePrintSettings(raw) {
  return {
    classValues: compactClassValues(raw?.classValues),
    labels: compactPrintLabels(raw?.labels),
  };
}
