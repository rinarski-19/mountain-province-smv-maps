// Classification metadata + helpers used across the map UI.
//
// Printer-friendly categorical palette. Every class has its own color;
// commercial and residential classes never share a hex value, even when
// their market values happen to match. The colors are deliberately spread
// across hue families so adjacent zones remain distinguishable on screen
// and on an A3 print. Blue and cyan are intentionally excluded because
// the basemap reserves that visual family for rivers and other water.

export const CLASSIFICATION_INFO = {
  "C-1": { color: "#A84848", label: "C-1", category: "Commercial", value: 6240 },
  "C-2": { color: "#D88858", label: "C-2", category: "Commercial", value: 5140 },
  "C-3": { color: "#D8B868", label: "C-3", category: "Commercial", value: 4030 },
  "C-4": { color: "#684838", label: "C-4", category: "Commercial", value: 3550 },
  // C-5..C-10 — extensions added for Sagada's schedule, where the
  // commercial ladder continues all the way down to ₱700/m². Colors
  // are distinct from all C-1..C-4 and R-1..R-15, and stay clear of
  // the blue/cyan band reserved for water.
  "C-5": { color: "#C87838", label: "C-5", category: "Commercial", value: 2400 },
  "C-6": { color: "#788038", label: "C-6", category: "Commercial", value: 1900 },
  "C-7": { color: "#989878", label: "C-7", category: "Commercial", value: 1600 },
  "C-8": { color: "#784878", label: "C-8", category: "Commercial", value: 1200 },
  "C-9": { color: "#998858", label: "C-9", category: "Commercial", value: 900 },
  "C-10": { color: "#B89888", label: "C-10", category: "Commercial", value: 700 },
  // C-11, C-12 — extensions for Tadian's 2027 GR Form No. 1 schedule
  // (₱600 and ₱400). Distinct hexes, stay clear of blue/cyan.
  "C-11": { color: "#704848", label: "C-11", category: "Commercial", value: 600 },
  "C-12": { color: "#A8A858", label: "C-12", category: "Commercial", value: 400 },
  "R-1": { color: "#58C858", label: "R-1", category: "Residential", value: 6240 },
  "R-2": { color: "#385838", label: "R-2", category: "Residential", value: 5140 },
  "R-3": { color: "#88C898", label: "R-3", category: "Residential", value: 4030 },
  "R-4": { color: "#8858D8", label: "R-4", category: "Residential", value: 3150 },
  "R-5": { color: "#9888B8", label: "R-5", category: "Residential", value: 2480 },
  "R-6": { color: "#D858A8", label: "R-6", category: "Residential", value: 1300 },
  "R-7": { color: "#683858", label: "R-7", category: "Residential", value: 1050 },
  "R-8": { color: "#588838", label: "R-8", category: "Residential", value: 2390 },
  "R-9": { color: "#583888", label: "R-9", category: "Residential", value: 1970 },
  "R-10": { color: "#D888A8", label: "R-10", category: "Residential", value: 1620 },
  "R-11": { color: "#887838", label: "R-11", category: "Residential", value: 1330 },
  "R-12": { color: "#D858D8", label: "R-12", category: "Residential", value: 1090 },
  "R-13": { color: "#C888D8", label: "R-13", category: "Residential", value: 990 },
  "R-14": { color: "#98C868", label: "R-14", category: "Residential", value: 820 },
  "R-15": { color: "#A88878", label: "R-15", category: "Residential", value: 640 },
  // Unclassified / pending
  UNCLASSIFIED: {
    color: "#9ca3af",
    label: "Unclassified",
    category: "—",
    value: null,
  },
};

export const CLASSIFICATION_COLORS = Object.freeze(
  Object.fromEntries(
    Object.entries(CLASSIFICATION_INFO).map(([klass, info]) => [klass, info.color])
  )
);

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
// Helper: pick the commercial color for the given tier number. Used
// to build the override map below — every R-N that shares a ₱ value
// with its sibling C-N inherits the C-N color so the matching tier
// reads as a single visual band on both the editor and the printed
// plate.
const cColor = (n) => CLASSIFICATION_INFO[`C-${n}`]?.color;

export const LGU_LOCAL_COLOR_OVERRIDES = {
  // For every LGU below: each R-N has the same ₱/m² value as the
  // corresponding C-N in that LGU's official schedule, so R-N is
  // overridden to use C-N's color. C-N keeps the global palette color
  // (commercial reds/oranges/golds/etc.) by default; only the R side
  // gets pulled across. Matching pairs were extracted from every
  // <slug>_valuations.json — see lib/classifications.js comment above.
  bauko: {
    "R-1": cColor(1), // both ₱5,170
    "R-2": cColor(2), // both ₱4,210
    "R-3": cColor(3), // both ₱3,140
  },
  barlig: {
    "R-1": cColor(1), // both ₱1,950
  },
  besao: {
    "R-1": cColor(1), // both ₱2,560
    "R-2": cColor(2), // both ₱1,910
    "R-3": cColor(3), // both ₱1,490
  },
  bontoc: {
    "R-1": cColor(1), // both ₱9,860
    "R-2": cColor(2), // both ₱7,710
  },
  natonin: {
    "R-1": cColor(1), // both ₱1,820
  },
  paracelis: {
    "R-1": cColor(1), // both ₱2,100
  },
  sabangan: {
    "R-1": cColor(1), // both ₱3,880
    "R-2": cColor(2), // both ₱2,770
  },
  sadanga: {
    "R-1": cColor(1), // both ₱2,130
  },
  sagada: {
    "R-1": cColor(1), // both ₱5,000
    "R-2": cColor(2), // both ₱4,200
    "R-3": cColor(3), // both ₱3,500
    "R-4": cColor(4), // both ₱2,900
    "R-5": cColor(5), // both ₱2,400
    "R-6": cColor(6), // both ₱1,900
    "R-7": cColor(7), // both ₱1,600
    "R-8": cColor(8), // both ₱1,200
    "R-9": cColor(9), // both ₱900
    "R-10": cColor(10), // both ₱700
  },
  tadian: {
    "R-1": cColor(1), // both ₱5,100
    "R-2": cColor(2), // both ₱4,500
    "R-3": cColor(3), // both ₱3,900
    "R-4": cColor(4), // both ₱3,400
    "R-5": cColor(5), // both ₱2,900
    "R-6": cColor(6), // both ₱2,400
    "R-7": cColor(7), // both ₱2,000
    "R-8": cColor(8), // both ₱1,600
    "R-9": cColor(9), // both ₱1,100
    "R-10": cColor(10), // both ₱800
    "R-11": cColor(11), // both ₱600
    "R-12": cColor(12), // both ₱400
  },
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

export function textColorForBackground(color) {
  const hex = String(color ?? "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.36 ? "#111827" : "#ffffff";
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
