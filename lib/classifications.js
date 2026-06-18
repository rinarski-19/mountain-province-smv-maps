// Classification metadata + helpers used across the map UI.
//
// Printer-friendly palette derived from the Tableau 10 / ColorBrewer
// families: each hex is inside the CMYK gamut (no pure RGB primaries,
// no neon saturations), so what shows on screen reproduces faithfully
// on inkjet and laser printers. Within those constraints, neighbouring
// value tiers are pushed apart by either hue or lightness so any two
// classes that might share an edge on the map read as different
// colors at a glance.
//
//   ₱6,240  C-1 / R-1  crimson red       #d62728
//   ₱5,140  C-2 / R-2  vivid orange      #ff7f0e
//   ₱4,030  C-3 / R-3  pink              #e377c2
//   ₱3,550  C-4        amber / gold      #ffbf00
//   ₱3,150  R-4        medium purple     #9467bd
//   ₱2,480  R-5        deep purple       #5e3c99
//   ₱2,390  R-8        blue              #1f77b4
//   ₱1,970  R-9        sky blue          #6baed6
//   ₱1,620  R-10       cyan              #17becf
//   ₱1,330  R-11       mint green        #66c2a5
//   ₱1,300  R-6        green             #2ca02c
//   ₱1,090  R-12       dark green        #006d2c
//   ₱1,050  R-7        olive             #bcbd22
//   ₱990    R-13       brown             #8c564b
//   ₱820    R-14       dark brown        #543005
//   ₱640    R-15       neutral gray      #7f7f7f
//
// "Same value = same color" pattern preserved across the C-N / R-N
// pair: C-1 and R-1 share crimson, C-3 and R-3 share pink, etc. So the
// reader can decode value at a glance and use the legend to tell C vs R.

export const CLASSIFICATION_INFO = {
  // Commercial — top three share with R-1..R-3 (same ₱ value)
  "C-1": { color: "#d62728", label: "C-1", category: "Commercial", value: 6240 },
  "C-2": { color: "#ff7f0e", label: "C-2", category: "Commercial", value: 5140 },
  "C-3": { color: "#e377c2", label: "C-3", category: "Commercial", value: 4030 },
  "C-4": { color: "#ffbf00", label: "C-4", category: "Commercial", value: 3550 },
  // Residential — first three mirror the commercial tiers above.
  "R-1": { color: "#d62728", label: "R-1", category: "Residential", value: 6240 },
  "R-2": { color: "#ff7f0e", label: "R-2", category: "Residential", value: 5140 },
  "R-3": { color: "#e377c2", label: "R-3", category: "Residential", value: 4030 },
  "R-4": { color: "#9467bd", label: "R-4", category: "Residential", value: 3150 },
  "R-5": { color: "#5e3c99", label: "R-5", category: "Residential", value: 2480 },
  "R-6": { color: "#2ca02c", label: "R-6", category: "Residential", value: 1300 },
  "R-7": { color: "#bcbd22", label: "R-7", category: "Residential", value: 1050 },
  // R-8 … R-15: Bontoc's lower residential tiers. Values descend from
  // 2,390 down to 640, alternating between blue / cyan / mint / dark
  // green / brown / gray so consecutive tiers always swap hue family.
  "R-8": { color: "#1f77b4", label: "R-8", category: "Residential", value: 2390 },
  "R-9": { color: "#6baed6", label: "R-9", category: "Residential", value: 1970 },
  "R-10": { color: "#17becf", label: "R-10", category: "Residential", value: 1620 },
  "R-11": { color: "#66c2a5", label: "R-11", category: "Residential", value: 1330 },
  "R-12": { color: "#006d2c", label: "R-12", category: "Residential", value: 1090 },
  "R-13": { color: "#8c564b", label: "R-13", category: "Residential", value: 990 },
  "R-14": { color: "#543005", label: "R-14", category: "Residential", value: 820 },
  "R-15": { color: "#7f7f7f", label: "R-15", category: "Residential", value: 640 },
  // Unclassified / pending
  UNCLASSIFIED: {
    color: "#9ca3af",
    label: "Unclassified",
    category: "—",
    value: null,
  },
};

// Default *inner-lots* classification for each Bauko barangay,
// derived from the valuation document descriptions. Roadside corridors
// (C-1, C-2, R-1, R-2) need to be drawn manually with the editor — they
// follow road geometry, not barangay shape.
export const BARANGAY_DEFAULT_INNER_CLASS = {
  Abatan: "UNCLASSIFIED", // inner lots of Abatan: value = null
  Mabaay: "R-3",
  Sinto: "R-3",
  Sadsadan: "R-3",
  Poblacion: "R-3",
  "Guinzadan Central": "R-3",
  "Guinzadan Sur": "R-3",
  "Monamon Sur": "R-3",
  "Mount Data": "R-3",
  "Monamon Norte": "R-4",
  Banao: "R-4",
  "Otucan Sur": "R-4",
  "Otucan Norte": "R-4",
  Tapapan: "R-4",
  Leseb: "R-4",
  Lagawa: "R-4",
  "Guinzadan Norte": "UNCLASSIFIED", // along all-weather roads only, inner null
  Bila: "UNCLASSIFIED",
  Mayag: "UNCLASSIFIED",
  "Bagnen Proper": "UNCLASSIFIED",
  "Bagnen Oriente": "UNCLASSIFIED",
  Balintaugan: "R-5",
};

// PSA / GADM include "Bila (Bua)" and "Poblacion (Bauko)" — the parenthetical
// is a sitio/disambiguation suffix. Strip it before looking up the class so
// the data files don't have to match the valuation document's wording exactly.
function normaliseBarangayKey(name) {
  if (!name) return name;
  const stripped = String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped;
}

function barangayNameFromProps(props = {}) {
  const raw =
    props.name ??
    props.NAME_3 ??
    props.Barangay ??
    props.BARANGAY ??
    props.Brgy_Name ??
    props.BRGY_NAME ??
    props.ADM4_EN ??
    props.ADM3_EN ??
    props.NAME;
  return raw ? String(raw).trim() : null;
}

export function classFor(barangayName) {
  const key = normaliseBarangayKey(barangayName);
  return BARANGAY_DEFAULT_INNER_CLASS[key] ?? "UNCLASSIFIED";
}

// Pick a class for a feature, preferring a value the user set in QGIS
// (`smv` column) over the derived inner-lots default.
//   smv = "R-3"          → uses that class directly
//   smv = 4030           → finds the matching class by value
//   smv = null/missing   → falls back to classFor(name)
export function classForFeature(feature) {
  const props = feature?.properties ?? {};
  const raw = props.smv;
  if (raw != null && raw !== "") {
    if (typeof raw === "string" && CLASSIFICATION_INFO[raw.toUpperCase()]) {
      return raw.toUpperCase();
    }
    const num = typeof raw === "number" ? raw : parseFloat(raw);
    if (Number.isFinite(num)) {
      // Closest matching class by value.
      let best = "UNCLASSIFIED";
      let bestDiff = Infinity;
      for (const [k, info] of Object.entries(CLASSIFICATION_INFO)) {
        if (info.value == null) continue;
        const d = Math.abs(info.value - num);
        if (d < bestDiff) {
          bestDiff = d;
          best = k;
        }
      }
      return best;
    }
  }
  return classFor(barangayNameFromProps(props));
}

export function valueForFeature(feature) {
  const props = feature?.properties ?? {};
  const raw = props.smv;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw !== "") {
    const num = parseFloat(raw);
    if (Number.isFinite(num)) return num;
    if (CLASSIFICATION_INFO[raw.toUpperCase()]) {
      return CLASSIFICATION_INFO[raw.toUpperCase()].value;
    }
  }
  return CLASSIFICATION_INFO[classFor(barangayNameFromProps(props))]?.value ?? null;
}

// LGU-local color overrides applied on top of CLASSIFICATION_INFO.
// Used when a municipality's ordinance assigns the same market value
// to a commercial AND a residential class — the visual story should
// then read as one value band, not two. Single source of truth: every
// downstream consumer (lib/bauko.js schedule chips, the print SVG
// builder, the editor's zoneStyle) imports from here so the colors
// never drift between sidebar, screen, and paper.
//
//   Bauko C-3 (₱4,030) matches R-3 (₱4,030) → both paint the same value band.
//
// Add LGU entries here if other municipalities need similar visual
// merges; nothing else needs to change.
export const LGU_LOCAL_COLOR_OVERRIDES = {
  // No LGU-specific overrides at present. The new high-contrast
  // palette already aligns C-3 and R-3 (both magenta #d81b60) so
  // Bauko's old override is redundant. Add new entries here if a
  // future LGU needs a different visual treatment for a specific tier.
};

// Resolve the fill / stroke color for a class, honoring any LGU-local
// override before falling back to CLASSIFICATION_INFO. Pass slug=null
// to skip overrides entirely (e.g. the generic legend).
export function colorForClass(klass, slug = null) {
  if (slug && LGU_LOCAL_COLOR_OVERRIDES[slug]?.[klass]) {
    return LGU_LOCAL_COLOR_OVERRIDES[slug][klass];
  }
  return (
    CLASSIFICATION_INFO[klass]?.color ??
    CLASSIFICATION_INFO.UNCLASSIFIED.color
  );
}

export function isCommercialClass(klass) {
  return String(klass ?? "").toUpperCase().startsWith("C-");
}

export function isResidentialClass(klass) {
  return String(klass ?? "").toUpperCase().startsWith("R-");
}

const COMMERCIAL_HATCH_COLORS = {
  "C-1": "#8F1D12",
  "C-2": "#B91C8F",
  "C-3": "#8F5A2F",
};

export function commercialHatchColorForClass(klass, slug = null) {
  const key = String(klass ?? "").toUpperCase();
  return COMMERCIAL_HATCH_COLORS[key] ?? colorForClass(key, slug);
}

// Choropleth-style: filled polygon with semi-transparent fill so the basemap
// stays visible underneath. Used for the "SMV (₱/m²)" overlay.
export function smvFillStyle(klass, slug = null) {
  const color = colorForClass(klass, slug);
  return {
    color,
    weight: 1.4,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: 0.45,
  };
}

export function styleForClass(klass, slug = null) {
  const color = colorForClass(klass, slug);
  return {
    color,
    weight: 1,
    fillColor: color,
    fillOpacity: 0.35,
  };
}

// Produce the items the legend renders.
export function legendEntries() {
  const order = [
    "C-1",
    "C-2",
    "C-3",
    "C-4",
    "R-1",
    "R-2",
    "R-3",
    "R-4",
    "R-5",
    "R-6",
    "R-7",
    "R-8",
    "R-9",
    "R-10",
    "R-11",
    "R-12",
    "R-13",
    "R-14",
    "R-15",
    "UNCLASSIFIED",
  ];
  return order.map((k) => ({ key: k, ...CLASSIFICATION_INFO[k] }));
}
