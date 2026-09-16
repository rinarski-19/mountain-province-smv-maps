// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Every colour on the sheet that is NOT an SMV class: the road hierarchy,
// the basemap, and boundaries.
//
// Landmark pin colours are deliberately NOT here. They are a fixed
// iconography shared with the on-screen map, and the LGU asked for them
// to stay fixed — see lib/landmark-icons.js if they ever need changing.
//
// SMV class colours live in lib/classifications.js because they carry
// valuation meaning and are keyed by class code. These are cartography —
// the quiet layers the classes sit on top of — so they get their own
// declarative list, in the same shape as PRINT_LABEL_FIELDS, and the
// editor renders itself from it.
//
// Like the class palette, the theme is province-wide: a road drawn as a
// national route must look the same on every municipality's sheet.
//
// Client-safe: no node:fs.

const HEX = /^#[0-9a-fA-F]{6}$/;

export const PRINT_THEME_FIELDS = Object.freeze([
  // --- Road hierarchy (these appear as legend swatches) ---
  { key: "roadFillTrunk", group: "Roads", label: "National fill", default: "#fcd34d" },
  { key: "roadCasingTrunk", group: "Roads", label: "National outline", default: "#a16207" },
  { key: "roadFillProvincial", group: "Roads", label: "Provincial fill", default: "#fb923c" },
  { key: "roadCasingProvincial", group: "Roads", label: "Provincial outline", default: "#9a3412" },
  { key: "roadFillBarangay", group: "Roads", label: "Barangay fill", default: "#ffffff" },
  { key: "roadCasingBarangay", group: "Roads", label: "Barangay outline", default: "#bababa" },
  { key: "roadFill", group: "Roads", label: "Other roads fill", default: "#a8a39b" },
  { key: "roadCasing", group: "Roads", label: "Other roads outline", default: "#ffffff" },

  // --- Boundaries ---
  { key: "municipalityStroke", group: "Boundaries", label: "Municipality outline", default: "#000000" },
  { key: "barangayStroke", group: "Boundaries", label: "Barangay outline", default: "#1f2937" },

  // --- Basemap ---
  { key: "paper", group: "Basemap", label: "Paper background", default: "#ffffff" },
  { key: "waterFill", group: "Basemap", label: "Water fill", default: "#d8eaf6" },
  { key: "waterStroke", group: "Basemap", label: "Water outline", default: "#7eb3dc" },
  { key: "waterLine", group: "Basemap", label: "Rivers and streams", default: "#9ec5e8" },
  { key: "buildingFill", group: "Basemap", label: "Building fill", default: "#ebe8e2" },
  { key: "buildingStroke", group: "Basemap", label: "Building outline", default: "#c8c5bf" },
  { key: "placeLabel", group: "Basemap", label: "Place label text", default: "#000000" },
  { key: "placeHalo", group: "Basemap", label: "Place label halo", default: "#ffffff" },

]);

export const PRINT_THEME_DEFAULTS = Object.freeze(
  Object.fromEntries(PRINT_THEME_FIELDS.map((f) => [f.key, f.default]))
);

export const PRINT_THEME_KEYS = Object.freeze(
  PRINT_THEME_FIELDS.map((f) => f.key)
);


export function printThemeGroups() {
  const groups = [];
  for (const field of PRINT_THEME_FIELDS) {
    let bucket = groups.find((g) => g.name === field.group);
    if (!bucket) {
      bucket = { name: field.group, fields: [] };
      groups.push(bucket);
    }
    bucket.fields.push(field);
  }
  return groups;
}

// Keep only well-formed hex for keys that exist, and drop anything equal
// to the stock value so the published file stays a small diff.
export function sanitizePrintTheme(theme) {
  const out = {};
  if (!theme || typeof theme !== "object") return out;
  for (const key of PRINT_THEME_KEYS) {
    const value = theme[key];
    if (typeof value !== "string") continue;
    const hex = value.trim().toLowerCase();
    if (!HEX.test(hex)) continue;
    if (hex === PRINT_THEME_DEFAULTS[key].toLowerCase()) continue;
    out[key] = hex;
  }
  return out;
}

export function resolvePrintTheme(overrides) {
  return { ...PRINT_THEME_DEFAULTS, ...sanitizePrintTheme(overrides) };
}

// ---------------------------------------------------------------------
// Live theme, for the on-screen map.
//
// The print builder gets its theme passed in per render. The Leaflet map
// cannot — its styles are read at draw time from module scope — so it
// goes through this registry, the same pattern colorForClass() uses for
// class colours. Without it the map kept its own hardcoded duplicates of
// these values and a published road or water colour changed the printed
// sheet while the screen stayed stock, permanently.
// ---------------------------------------------------------------------
let THEME_OVERRIDES = {};

export function setPrintThemeOverrides(theme) {
  THEME_OVERRIDES = sanitizePrintTheme(theme);
  return THEME_OVERRIDES;
}

export function getPrintThemeOverrides() {
  return { ...THEME_OVERRIDES };
}

export function themeColor(key) {
  return THEME_OVERRIDES[key] ?? PRINT_THEME_DEFAULTS[key];
}
