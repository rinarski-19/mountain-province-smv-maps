// Hierarchical SMV schedule data for Bontoc — OFFICIAL schedule
// transcribed from "Bontoc GR form 1 -edited by sir.docx".
// 2 commercial classes (C-1, C-2) + 10 residential classes (R-1..R-10).
//
// NOTE: the source doc shows 2012 + 2024 columns; the 2024 values
// here are treated as the operative 2027 General Revision values
// per the user's confirmation. The field name marketValue2027 is
// preserved across all municipalities for shell-component compatibility.
//
// Heads-up: existing bontoc_zones.geojson polygons tagged with R-11
// through R-15 are orphans under this schedule — those tiers were
// dropped. Retag in the editor as appropriate (likely R-10, or new
// R-7/R-8/R-9 depending on the road context).

import { CLASSIFICATION_COLORS as colorByClass } from "./classifications.js";

// 16 PSA-confirmed Bontoc barangays.
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

// Reusable barangay groupings — kept here to keep the classifications
// table readable. These follow the new schedule, not the prior draft.
const NATIONAL_ROAD_OUTER = [
  "alab-oriente",
  "alab-proper",
  "bayyo",
  "gonogon",
  "talubin",
  "tocucan",
];
const PROVINCIAL_ROAD_INNER_R7 = [
  "alab-oriente",
  "alab-proper",
  "balili",
  "bayyo",
  "caneo",
  "gonogon",
  "guinaang",
  "mainit",
  "maligcong",
  "talubin",
  "tocucan",
];
const BARANGAY_ROAD_TIER_R8 = [
  "balili",
  "guinaang",
  "mainit",
  "maligcong",
  "talubin",
];
const BARANGAY_ROAD_INNER_R9 = [
  "balili",
  "guinaang",
  "maligcong",
  "talubin",
];

export const BONTOC_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 9860,
    locationGroups: [
      {
        label:
          "Commercial lots along National Road within Poblacion — both sides from Circle to Kalangeg building; Circle to start of National Bridge fronting MPGCHS; Circle to Municipal Capitol; EDNP building to the Barracks; Pearl Café to Barracks; and Gomez residence to the National Road Junction at the Municipal Capitol. Also along Municipal Road from Wanchakan building to Pines Kitchenette down to Circle, and from JBA building to Pooten building.",
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
          "Commercial lots along National Road of Bontoc Ili to Gonogon (Joel Tad-awan building to Palinga-aw, Gonogon, both sides) and along Lanao Road. Commercial lots along National Road of Caluttit (Centrum building in front of DPWH to Pingew Restaurant, both sides), along National Road of Samoki (end of National Bridge to Sukit / Anayas's Restaurant, both sides), and along National Road from Barracks to Cadre Road. Also along Municipal Roads: Akfab, Fakeg, Kayyab, Sengang, Layad, Ayyoweng, and Tugwi Streets.",
        barangays: ["bontoc-ili", "calutit", "gonogon", "poblacion", "samoki"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 9860,
    locationGroups: [
      {
        label:
          "Residential lots along National Roads from Circle to Malichom Samoki (Romel Lengwa Residence); Circle to Pakkil Caluttit (Morareng Residence); Circle to Balikian Bridge (Bontoc–Baguio Road); EDNP building to the Barracks; Pearl Café to Barracks. Also along Caluttit–Plaza Road, Eyeb–Lanao Road, and Municipal Road from Wanchakan building to Pines Kitchenette down to Circle, and from JBA building to Pooten building.",
        barangays: ["bontoc-ili", "calutit", "poblacion", "samoki"],
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
          "Residential lots along National Road from end of Balikian Bridge to Amlosong; along National Road of Caluttit (Fagyan Residence to Pingew Restaurant); along National Road of Samoki starting from Malichom. Also along Municipal Roads: Akfab, Fakeg, Kayyab, Sengang, Layad, Ayyoweng, Tugwi — including inner lots of Poblacion.",
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
          "Residential lots along Provincial Road (Bontoc–Maligcong Road) and along Bontoc–Mainit Road.",
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
        label:
          "Inner lots of Caluttit, Bontoc Ili, and Samoki; residential lots along Provincial Roads of Maligcong, Guina-ang, Mainit, Talubin, Can-eo, Balili, and along Balikian–Dalican Road.",
        barangays: [
          "bontoc-ili",
          "calutit",
          "samoki",
          "maligcong",
          "guinaang",
          "mainit",
          "talubin",
          "caneo",
          "balili",
          "dalican",
        ],
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
          "Along National Roads of Tocucan, Talubin, Bayyo, Alab Proper, Alab Oriente, and Gonogon.",
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
          "Inner lots along Provincial Roads of Tocucan, Talubin, Bayyo, Alab Proper, Alab Oriente, Gonogon, Maligcong, Guina-ang, Mainit, Can-eo, and Balili.",
        barangays: PROVINCIAL_ROAD_INNER_R7,
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
          "Residential lots along Barangay Roads of Balili, Maligcong, Guina-ang, Mainit, and Talubin.",
        barangays: BARANGAY_ROAD_TIER_R8,
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
          "Inner lots along Barangay Roads of Balili, Maligcong, Guina-ang, and Talubin.",
        barangays: BARANGAY_ROAD_INNER_R9,
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
          "Inner lots of Dalican and Can-eo; mountainous and far-flung sitios of Maligcong, Guina-ang, and Can-eo (Chapyosen).",
        barangays: ["dalican", "caneo", "maligcong", "guinaang"],
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
