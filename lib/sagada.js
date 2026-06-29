// Hierarchical SMV schedule data for Sagada, derived from the LGU's
// 2027 General Revision schedule (user-provided 2026-06-19). 10
// commercial classes (C-1..C-10) and 11 residential classes
// (R-1..R-11). Sagada's commercial ladder mirrors its residential
// ladder — every C-N tier shares its ₱ value with the matching R-N
// tier — with the single exception of R-11 (sitios unreached by
// road, ₱500), which has no commercial counterpart.
//
// Field naming: marketValue2027 is now accurate (was carrying 2026
// numbers in the previous draft). Same field name is preserved
// across municipalities for shell-component compatibility.

import { CLASSIFICATION_COLORS as colorByClass } from "./classifications.js";

// 19 Sagada barangays. Canonical spellings track the LGU schedule —
// PSA's "Angkeling"/"Tetepan"/"Bangaan"/"Fidelisan" variants are
// normalized to "Ankileng"/"Tetep-an"/"Banga-an"/"Fedilisan" in the
// fetched GeoJSON so this slug map resolves them directly.
export const SAGADA_BARANGAYS = [
  { slug: "aguid", name: "Aguid", digitized: false },
  { slug: "ambasing", name: "Ambasing", digitized: false },
  { slug: "ankileng", name: "Ankileng", digitized: false },
  { slug: "antadao", name: "Antadao", digitized: false },
  { slug: "balugan", name: "Balugan", digitized: false },
  { slug: "banga-an", name: "Banga-an", digitized: false },
  { slug: "dagdag", name: "Dagdag", digitized: false },
  { slug: "demang", name: "Demang", digitized: false },
  { slug: "fedilisan", name: "Fedilisan", digitized: false },
  { slug: "kilong", name: "Kilong", digitized: false },
  { slug: "madongo", name: "Madongo", digitized: false },
  { slug: "nacagang", name: "Nacagang", digitized: false },
  { slug: "patay", name: "Patay", digitized: false },
  { slug: "pide", name: "Pide", digitized: false },
  { slug: "suyo", name: "Suyo", digitized: false },
  { slug: "taccong", name: "Taccong", digitized: false },
  { slug: "tanulong", name: "Tanulong", digitized: false },
  { slug: "tetep-an-norte", name: "Tetep-an Norte", digitized: false },
  { slug: "tetep-an-sur", name: "Tetep-an Sur", digitized: false },
];

// Build the name → slug map off canonical entries, then add aliases for
// PSA spellings just in case a downstream caller passes the raw layer
// name without going through the post-processed GeoJSON.
const slugByName = new Map(
  SAGADA_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
const ALIASES = [
  ["angkeling", "ankileng"],
  ["tetepan norte", "tetep-an-norte"],
  ["tetepan sur", "tetep-an-sur"],
  ["bangaan", "banga-an"],
  ["fidelisan", "fedilisan"],
];
for (const [psa, slug] of ALIASES) slugByName.set(psa, slug);

export function slugForSagadaName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function sagadaBarangayBySlug(slug) {
  return SAGADA_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Slug subsets that show up repeatedly across the 2027 schedule.
// Each tier maps to a specific row of the LGU schedule — names match
// the user-provided table; "Maduto" in C-6/R-6 is a road segment in
// Taccong, not a separate barangay.
const TIER_1 = ["patay", "dagdag", "demang"]; // C-1 / R-1 — national + provincial
const TIER_2 = ["patay"]; // C-2 / R-2 — municipal/barangay/farm-to-market road of Patay
const TIER_3 = ["dagdag", "demang"]; // C-3 / R-3 — municipal/barangay roads
const TIER_4 = ["ambasing", "antadao"]; // C-4 / R-4 — national roads
const TIER_5 = ["ankileng", "suyo"]; // C-5 / R-5 — provincial (Ankileng extension)
const TIER_6 = ["taccong", "madongo", "banga-an"]; // C-6 / R-6 — provincial
const TIER_7 = [
  "kilong",
  "tetep-an-sur",
  "tetep-an-norte",
  "ankileng",
  "balugan",
  "taccong",
]; // C-7 / R-7 — provincial (Ankileng main)
const TIER_8 = ["aguid", "nacagang"]; // C-8 / R-8 — provincial
const TIER_9 = ["tanulong", "pide"]; // C-9 / R-9 — barangay road
const TIER_10 = ["fedilisan"]; // C-10 / R-10 — within Fedilisan
const TIER_11_ALL_BARANGAYS = SAGADA_BARANGAYS.map((b) => b.slug); // R-11 — sitios in every barangay

export const SAGADA_CLASSIFICATIONS = [
  // -------- Commercial Lands (C-1 .. C-10) --------
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 5000,
    locationGroups: [
      {
        label:
          "Commercial lots along the National and Provincial roads of Patay, Dagdag, and Demang.",
        barangays: TIER_1,
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 4200,
    locationGroups: [
      {
        label:
          "Commercial lots along the Municipal / Barangay / Farm-to-Market road of Patay.",
        barangays: TIER_2,
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: colorByClass["C-3"],
    marketValue2027: 3500,
    locationGroups: [
      {
        label:
          "Commercial lots along the Municipal / Barangay roads of Dagdag and Demang.",
        barangays: TIER_3,
      },
    ],
  },
  {
    id: "c-4",
    subClass: "C-4",
    category: "commercial",
    color: colorByClass["C-4"],
    marketValue2027: 2900,
    locationGroups: [
      {
        label:
          "Commercial lots along the National roads of Ambasing and Antadao.",
        barangays: TIER_4,
      },
    ],
  },
  {
    id: "c-5",
    subClass: "C-5",
    category: "commercial",
    color: colorByClass["C-5"],
    marketValue2027: 2400,
    locationGroups: [
      {
        label:
          "Commercial lots along the Provincial roads of Ankileng (extension) and Suyo.",
        barangays: TIER_5,
      },
    ],
  },
  {
    id: "c-6",
    subClass: "C-6",
    category: "commercial",
    color: colorByClass["C-6"],
    marketValue2027: 1900,
    locationGroups: [
      {
        label:
          "Commercial lots along the Provincial road of Maduto-Taccong segment, Madongo, and Banga-an.",
        barangays: TIER_6,
      },
    ],
  },
  {
    id: "c-7",
    subClass: "C-7",
    category: "commercial",
    color: colorByClass["C-7"],
    marketValue2027: 1600,
    locationGroups: [
      {
        label:
          "Commercial lots along the Provincial road of Kilong, Tetep-an Sur, Tetep-an Norte, Ankileng (main), Balugan, and Taccong.",
        barangays: TIER_7,
      },
    ],
  },
  {
    id: "c-8",
    subClass: "C-8",
    category: "commercial",
    color: colorByClass["C-8"],
    marketValue2027: 1200,
    locationGroups: [
      {
        label:
          "Commercial lots along the Provincial road of Aguid and Nacagang.",
        barangays: TIER_8,
      },
    ],
  },
  {
    id: "c-9",
    subClass: "C-9",
    category: "commercial",
    color: colorByClass["C-9"],
    marketValue2027: 900,
    locationGroups: [
      {
        label:
          "Commercial lots along the Barangay road of Tanulong and Pide.",
        barangays: TIER_9,
      },
    ],
  },
  {
    id: "c-10",
    subClass: "C-10",
    category: "commercial",
    color: colorByClass["C-10"],
    marketValue2027: 700,
    locationGroups: [
      {
        label: "Commercial lots within Barangay Fedilisan.",
        barangays: TIER_10,
      },
    ],
  },
  // -------- Residential Lands (R-1 .. R-11) --------
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 5000,
    locationGroups: [
      {
        label:
          "Residential lots along the National and Provincial roads of Patay, Dagdag, and Demang.",
        barangays: TIER_1,
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 4200,
    locationGroups: [
      {
        label:
          "Residential lots along the Municipal / Barangay / Farm-to-Market road of Patay.",
        barangays: TIER_2,
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 3500,
    locationGroups: [
      {
        label:
          "Residential lots along the Municipal / Barangay roads of Dagdag and Demang.",
        barangays: TIER_3,
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 2900,
    locationGroups: [
      {
        label:
          "Residential lots along the National roads of Ambasing and Antadao.",
        barangays: TIER_4,
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 2400,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial roads of Ankileng (extension) and Suyo.",
        barangays: TIER_5,
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 1900,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial road of Maduto-Taccong segment, Madongo, and Banga-an.",
        barangays: TIER_6,
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 1600,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial road of Kilong, Tetep-an Sur, Tetep-an Norte, Ankileng (main), Balugan, and Taccong.",
        barangays: TIER_7,
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: 1200,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial road of Aguid and Nacagang.",
        barangays: TIER_8,
      },
    ],
  },
  {
    id: "r-9",
    subClass: "R-9",
    category: "residential",
    color: colorByClass["R-9"],
    marketValue2027: 900,
    locationGroups: [
      {
        label:
          "Residential lots along the Barangay road of Tanulong and Pide.",
        barangays: TIER_9,
      },
    ],
  },
  {
    id: "r-10",
    subClass: "R-10",
    category: "residential",
    color: colorByClass["R-10"],
    marketValue2027: 700,
    locationGroups: [
      {
        label: "Residential lots within Barangay Fedilisan.",
        barangays: TIER_10,
      },
    ],
  },
  {
    id: "r-11",
    subClass: "R-11",
    category: "residential",
    color: colorByClass["R-11"],
    marketValue2027: 500,
    locationGroups: [
      {
        label:
          "Residential lots in sitios of every barangay unreached by road.",
        barangays: TIER_11_ALL_BARANGAYS,
      },
    ],
  },
];

export const SAGADA_COMMERCIAL_CLASSIFICATIONS = SAGADA_CLASSIFICATIONS.filter(
  (classification) => classification.category === "commercial"
);
export const SAGADA_RESIDENTIAL_CLASSIFICATIONS = SAGADA_CLASSIFICATIONS.filter(
  (classification) => classification.category === "residential"
);

export function uniqueBarangaysForSagada(classification) {
  return Array.from(
    new Set((classification?.locationGroups ?? []).flatMap((group) => group.barangays))
  );
}
