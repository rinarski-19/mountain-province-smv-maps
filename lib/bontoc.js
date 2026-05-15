// Hierarchical SMV schedule data for Bontoc, derived from the LGU's
// 2024 valuation table. 2 commercial classes (C-1, C-2) and 15
// residential classes (R-1..R-15) — the deepest residential ladder
// of any municipality currently in the app.
//
// NOTE: the field name marketValue2027 is preserved across all
// municipalities for shell-component compatibility, but the values
// stored here are the LGU-supplied 2024 figures (Bontoc's schedule
// is dated 2024, not 2027). The matching JSON snapshot lives at
// public/data/bontoc_smv_schedule.json.

const colorByClass = {
  // Commercial: only 2 tiers in Bontoc.
  "C-1": "#c63b24",
  "C-2": "#b91c1c",
  // Residential R-1..R-7 share the pink/violet/plum palette used
  // across the other municipalities. R-8..R-15 extend into deeper
  // blues and slates — see lib/classifications.js for the canonical
  // copy.
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2f3c6e",
  "R-8": "#22406b",
  "R-9": "#1f3a5f",
  "R-10": "#1c3553",
  "R-11": "#1a3048",
  "R-12": "#172b3d",
  "R-13": "#142632",
  "R-14": "#102127",
  "R-15": "#0c1c1f",
};

// 16 PSA-confirmed Bontoc barangays. The "Poblacion (Bontoc)" PSA
// label is normalised to just "Poblacion" in the fetched GeoJSON so
// the slug map below resolves it. "Caluttit" in the LGU schedule
// is the same barangay PSA spells "Calutit" — the alias map handles
// either spelling.
export const BONTOC_BARANGAYS = [
  { slug: "alab-oriente", name: "Alab Oriente", digitized: false },
  { slug: "alab-proper", name: "Alab Proper", digitized: false },
  { slug: "balili", name: "Balili", digitized: false },
  { slug: "bayyo", name: "Bayyo", digitized: false },
  { slug: "bontoc-ili", name: "Bontoc Ili", digitized: false },
  { slug: "calutit", name: "Calutit", digitized: false },
  { slug: "caneo", name: "Caneo", digitized: false },
  { slug: "dalican", name: "Dalican", digitized: false },
  { slug: "gonogon", name: "Gonogon", digitized: false },
  { slug: "guinaang", name: "Guinaang", digitized: false },
  { slug: "mainit", name: "Mainit", digitized: false },
  { slug: "maligcong", name: "Maligcong", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "samoki", name: "Samoki", digitized: false },
  { slug: "talubin", name: "Talubin", digitized: false },
  { slug: "tocucan", name: "Tocucan", digitized: false },
];

// Build the name → slug map off canonical entries, then add aliases
// for the LGU schedule spellings ("Caluttit", "Can-eo", "Guina-ang")
// so labels and lookups stay consistent regardless of source.
const slugByName = new Map(
  BONTOC_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
const ALIASES = [
  ["caluttit", "calutit"],
  ["can-eo", "caneo"],
  ["guina-ang", "guinaang"],
];
for (const [alt, slug] of ALIASES) slugByName.set(alt, slug);

export function slugForBontocName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function bontocBarangayBySlug(slug) {
  return BONTOC_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Tier slug subsets that repeat across the schedule. Kept here so the
// classifications array below stays readable.
const POBLACION_CORE = ["bontoc-ili", "calutit", "poblacion", "samoki"];
const NATIONAL_ROAD_OUTER = [
  "alab-oriente",
  "alab-proper",
  "bayyo",
  "gonogon",
  "talubin",
  "tocucan",
];
const PROVINCIAL_ROAD_TIER = [
  "balili",
  "caneo",
  "guinaang",
  "mainit",
  "maligcong",
  "talubin",
];
const BARANGAY_ROAD_TIER = [
  "balili",
  "guinaang",
  "mainit",
  "maligcong",
  "talubin",
];

export const BONTOC_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 8910,
    locationGroups: [
      {
        label:
          "Commercial lots along National Road within Barangay Poblacion — both sides from Circle to Kalangeg building, Circle to start of National Bridge fronting MPGCHS, Circle to Municipal Capitol, EDNP building to the Barracks, and Gomez residence to the National Road Junction at the Municipal Capitol. Also along Municipal Road from Wanchakan building to Pines Kitchenette down to Circle, and from JBA building to Pooten building.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 7710,
    locationGroups: [
      {
        label:
          "Commercial lots along National Road of Bontoc Ili to Gonogon (Joel Tad-awan building to Palinga-aw, Gonogon), Lanao Road, National Road of Caluttit (Centrum building to Pingew Restaurant), National Road of Samoki (end of National Bridge to Sukit / Anayas's Restaurant), and National Road from Barracks to Cadre Road. Also along Municipal Roads: Akfab, Fakeg, Kayyab, Sengang, Layad, Ayyoweng, Tugwi, and Bishop Claver Road.",
        barangays: ["bontoc-ili", "calutit", "gonogon", "poblacion", "samoki"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 8910,
    locationGroups: [
      {
        label:
          "Residential lots along National Roads from Circle to Malichom Samoki, Circle to Pakkil Caluttit, Circle to Tikitik (Bontoc–Baguio Road), and EDNP building to the Barracks. Also along Caluttit–Plaza Road, Eyeb–Lanao Road, and Municipal Road from Wanchakan building to Pines Kitchenette down to Circle, and from JBA building to Pooten building.",
        barangays: POBLACION_CORE,
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 7710,
    locationGroups: [
      {
        label:
          "Residential lots along National Road from end of Balikian Bridge to Amlosong, along National Road of Caluttit (Fagyan Residence to Pingew Restaurant), and along National Road of Samoki starting from Malichom. Also along Municipal Roads: Akfab, Fakeg, Kayyab, Sengang, Layad, Ayyoweng, Tugwi, and inner lots of Poblacion.",
        barangays: ["calutit", "poblacion", "samoki"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 6340,
    locationGroups: [
      {
        label:
          "Residential lots along Provincial Road (Bontoc–Maligcong Road) from Bilibid Junction to Lengsad, and along Bontoc–Mainit Road from Post Office Junction to Pagturao.",
        barangays: ["mainit", "maligcong"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 5220,
    locationGroups: [
      {
        label: "Inner lots of Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 4290,
    locationGroups: [
      {
        label: "Inner lots of Caluttit, Bontoc Ili, and Samoki.",
        barangays: ["bontoc-ili", "calutit", "samoki"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 3530,
    locationGroups: [
      {
        label:
          "Along national roads of Tocucan, Talubin, Bayyo, Alab Proper, Alab Oriente, and Gonogon.",
        barangays: NATIONAL_ROAD_OUTER,
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 2910,
    locationGroups: [
      {
        label:
          "Inner lots along national roads of Tocucan, Talubin, Bayyo, Alab Proper, Alab Oriente, and Gonogon.",
        barangays: NATIONAL_ROAD_OUTER,
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: 2390,
    locationGroups: [
      {
        label:
          "Residential lots along provincial roads of Maligcong, Guina-ang, Mainit, Talubin, Can-eo, and Balili.",
        barangays: PROVINCIAL_ROAD_TIER,
      },
    ],
  },
  {
    id: "r-9",
    subClass: "R-9",
    category: "residential",
    color: colorByClass["R-9"],
    marketValue2027: 1970,
    locationGroups: [
      {
        label:
          "Inner lots along provincial roads of Maligcong, Guina-ang, Mainit, Talubin, Can-eo, and Balili.",
        barangays: PROVINCIAL_ROAD_TIER,
      },
    ],
  },
  {
    id: "r-10",
    subClass: "R-10",
    category: "residential",
    color: colorByClass["R-10"],
    marketValue2027: 1620,
    locationGroups: [
      {
        label:
          "Residential lots along barangay roads of Balili, Maligcong, Guina-ang, Mainit, and Talubin.",
        barangays: BARANGAY_ROAD_TIER,
      },
    ],
  },
  {
    id: "r-11",
    subClass: "R-11",
    category: "residential",
    color: colorByClass["R-11"],
    marketValue2027: 1330,
    locationGroups: [
      {
        label:
          "Inner lots along barangay roads of Balili, Maligcong, Guina-ang, Mainit, and Talubin.",
        barangays: BARANGAY_ROAD_TIER,
      },
    ],
  },
  {
    id: "r-12",
    subClass: "R-12",
    category: "residential",
    color: colorByClass["R-12"],
    marketValue2027: 1090,
    locationGroups: [
      {
        label:
          "Talubin (lower portions), Tocucan interior, and Gonogon outskirts.",
        barangays: ["gonogon", "talubin", "tocucan"],
      },
    ],
  },
  {
    id: "r-13",
    subClass: "R-13",
    category: "residential",
    color: colorByClass["R-13"],
    marketValue2027: 990,
    locationGroups: [
      {
        label:
          "Upper Talubin, hillside portions of Gonogon, and interior sitios of Can-eo.",
        barangays: ["caneo", "gonogon", "talubin"],
      },
    ],
  },
  {
    id: "r-14",
    subClass: "R-14",
    category: "residential",
    color: colorByClass["R-14"],
    marketValue2027: 820,
    locationGroups: [
      {
        label: "Remote sitios of Dalican and Mainit.",
        barangays: ["dalican", "mainit"],
      },
    ],
  },
  {
    id: "r-15",
    subClass: "R-15",
    category: "residential",
    color: colorByClass["R-15"],
    marketValue2027: 640,
    locationGroups: [
      {
        label:
          "Mountainous and far-flung sitios of Maligcong, Guina-ang, and Can-eo (Chapyosen).",
        barangays: ["caneo", "guinaang", "maligcong"],
      },
    ],
  },
];

export const BONTOC_COMMERCIAL_CLASSIFICATIONS = BONTOC_CLASSIFICATIONS.filter(
  (c) => c.category === "commercial"
);
export const BONTOC_RESIDENTIAL_CLASSIFICATIONS = BONTOC_CLASSIFICATIONS.filter(
  (c) => c.category === "residential"
);

export function uniqueBarangaysForBontoc(classification) {
  return Array.from(
    new Set((classification?.locationGroups ?? []).flatMap((g) => g.barangays))
  );
}
