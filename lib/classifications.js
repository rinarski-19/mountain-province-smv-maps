// Classification metadata + helpers used across the map UI.
// Color scheme tuned for readability over the OSM Mapnik tile layer.

export const CLASSIFICATION_INFO = {
  // Commercial
  "C-1": { color: "#c63b24", label: "C-1", category: "Commercial", value: 6240 },
  "C-2": { color: "#b91c1c", label: "C-2", category: "Commercial", value: 5140 },
  "C-3": { color: "#ef4444", label: "C-3", category: "Commercial", value: 4030 },
  "C-4": { color: "#f97316", label: "C-4", category: "Commercial", value: 3550 },
  // Residential — pinks/violets/plums palette (left → right in the source
  // swatch reads R-1 → R-7: hot magenta, orchid, vivid violet, mauve plum,
  // deep wine, indigo, and deep slate blue.
  "R-1": { color: "#ff26f0", label: "R-1", category: "Residential", value: 6240 },
  "R-2": { color: "#c440ea", label: "R-2", category: "Residential", value: 5140 },
  "R-3": { color: "#8b33ff", label: "R-3", category: "Residential", value: 4030 },
  "R-4": { color: "#8c458b", label: "R-4", category: "Residential", value: 3150 },
  "R-5": { color: "#5a364e", label: "R-5", category: "Residential", value: 2480 },
  "R-6": { color: "#3f3f8f", label: "R-6", category: "Residential", value: 1300 },
  "R-7": { color: "#2f3c6e", label: "R-7", category: "Residential", value: 1050 },
  // R-8 … R-15: extending the palette into deeper blues and slates for
  // Bontoc's lower residential tiers. Values are the Bontoc 2024 schedule
  // figures (Bontoc is the only municipality currently using R-8..R-15).
  "R-8": { color: "#22406b", label: "R-8", category: "Residential", value: 2390 },
  "R-9": { color: "#1f3a5f", label: "R-9", category: "Residential", value: 1970 },
  "R-10": { color: "#1c3553", label: "R-10", category: "Residential", value: 1620 },
  "R-11": { color: "#1a3048", label: "R-11", category: "Residential", value: 1330 },
  "R-12": { color: "#172b3d", label: "R-12", category: "Residential", value: 1090 },
  "R-13": { color: "#142632", label: "R-13", category: "Residential", value: 990 },
  "R-14": { color: "#102127", label: "R-14", category: "Residential", value: 820 },
  "R-15": { color: "#0c1c1f", label: "R-15", category: "Residential", value: 640 },
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

// Choropleth-style: filled polygon with semi-transparent fill so the basemap
// stays visible underneath. Used for the "SMV (₱/m²)" overlay.
export function smvFillStyle(klass) {
  const info = CLASSIFICATION_INFO[klass] ?? CLASSIFICATION_INFO.UNCLASSIFIED;
  return {
    color: info.color,
    weight: 1.4,
    opacity: 0.9,
    fillColor: info.color,
    fillOpacity: 0.45,
  };
}

export function styleForClass(klass) {
  const info = CLASSIFICATION_INFO[klass] ?? CLASSIFICATION_INFO.UNCLASSIFIED;
  return {
    color: info.color,
    weight: 1,
    fillColor: info.color,
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
