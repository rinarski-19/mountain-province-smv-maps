// Hierarchical SMV schedule data for Sagada, derived from the LGU's
// 2026 schedule provided by the user. The schedule has 4 commercial
// classes (C-1..C-4) and 11 residential classes (R-1..R-11).
//
// Field naming: marketValue2027 is preserved across municipalities for
// component compatibility, but Sagada's values below are the operative
// 2026 market values per sqm.

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES.
const color = (klass) => colorForClass(klass, "sagada");

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

// Slug subsets that show up repeatedly across the 2026 schedule.
const CENTRAL_BARANGAYS = ["patay", "dagdag", "demang"];
const OTHER_MAIN_ROAD_BARANGAYS = [
  "antadao",
  "kilong",
  "ambasing",
  "ankileng",
  "suyo",
  "taccong",
  "madongo",
  "banga-an",
  "aguid",
];
const INNER_ROAD_BARANGAYS = [
  "antadao",
  "kilong",
  "ambasing",
  "ankileng",
  "suyo",
  "taccong",
  "balugan",
];
const TETEPAN_KILONG_INNER_ROAD_BARANGAYS = [
  "tetep-an-sur",
  "tetep-an-norte",
  "kilong",
];
const GENERAL_RESIDENTIAL_BARANGAYS = [
  "antadao",
  "kilong",
  "ankileng",
  "suyo",
  "balugan",
  "ambasing",
  "taccong",
  "tetep-an-sur",
  "tetep-an-norte",
  "madongo",
  "banga-an",
];
const AGUID_NACAGANG = ["aguid", "nacagang"];
const TANULONG_PIDE = ["tanulong", "pide"];
const FEDILISAN = ["fedilisan"];
const ALL_BARANGAYS = SAGADA_BARANGAYS.map((b) => b.slug);

export const SAGADA_CLASSIFICATIONS = [
  // -------- Commercial Lands (C-1 .. C-4) --------
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 5000,
    marketValue2012: 179.2,
    locationGroups: [
      {
        label:
          "Commercial lots located along the National roads of barangay Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: color("C-2"),
    marketValue2027: 4200,
    marketValue2012: 179.2,
    locationGroups: [
      {
        label:
          "Commercial lots located along provincial, municipal, and farm-to-market roads of barangay Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: color("C-3"),
    marketValue2027: 3500,
    locationGroups: [
      {
        label: "Commercial inner lots of Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "c-4",
    subClass: "C-4",
    category: "commercial",
    color: color("C-4"),
    marketValue2027: 2900,
    locationGroups: [
      {
        label:
          "Commercial lots located along the national and/or provincial roads (main road) of barangay Antadao, Kilong, Ambasing, Ankileng, Suyo, Taccong, Madongo, Banga-an, and Aguid.",
        barangays: OTHER_MAIN_ROAD_BARANGAYS,
      },
    ],
  },
  // -------- Residential Lands (R-1 .. R-11) --------
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: color("R-1"),
    marketValue2027: 5000,
    marketValue2012: 112.1,
    locationGroups: [
      {
        label:
          "Residential lots located along the national and provincial road of barangay Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 4200,
    marketValue2012: 112.1,
    locationGroups: [
      {
        label:
          "Residential lots located along provincial, municipal, and farm-to-market roads of barangay Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 3500,
    marketValue2012: 112.1,
    locationGroups: [
      {
        label: "Residential inner lots of Patay, Dagdag, and Demang.",
        barangays: CENTRAL_BARANGAYS,
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 2900,
    marketValue2012: 112.1,
    locationGroups: [
      {
        label:
          "Residential lots located along the national and/or provincial roads (main road) of Antadao, Kilong, Ambasing, Ankileng, Suyo, Taccong, Madongo, Banga-an, and Aguid.",
        barangays: OTHER_MAIN_ROAD_BARANGAYS,
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: color("R-5"),
    marketValue2027: 2400,
    marketValue2012: 112.1,
    locationGroups: [
      {
        label:
          "Residential lots located along the inner roads of barangay Antadao, Kilong, Ambasing, Ankileng, Suyo, Taccong, and Balugan.",
        barangays: INNER_ROAD_BARANGAYS,
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: color("R-6"),
    marketValue2027: 1900,
    locationGroups: [
      {
        label:
          "Residential lots located along the inner roads of barangay Tetep-an Sur, Tetep-an Norte, and Kilong.",
        barangays: TETEPAN_KILONG_INNER_ROAD_BARANGAYS,
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: color("R-7"),
    marketValue2027: 1600,
    marketValue2012: 40.3,
    locationGroups: [
      {
        label:
          "Residential lots within barangay Antadao, Kilong, Ankileng, Suyo, Balugan, Ambasing, Taccong, Tetep-an Sur, Tetep-an Norte, Madongo, and Banga-an.",
        barangays: GENERAL_RESIDENTIAL_BARANGAYS,
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: color("R-8"),
    marketValue2027: 1200,
    marketValue2012: 40.3,
    locationGroups: [
      {
        label: "Residential lots within barangay Aguid and Nacagang.",
        barangays: AGUID_NACAGANG,
      },
    ],
  },
  {
    id: "r-9",
    subClass: "R-9",
    category: "residential",
    color: color("R-9"),
    marketValue2027: 900,
    marketValue2012: 40.3,
    locationGroups: [
      {
        label: "Residential lots within barangay Tanulong and Pide.",
        barangays: TANULONG_PIDE,
      },
    ],
  },
  {
    id: "r-10",
    subClass: "R-10",
    category: "residential",
    color: color("R-10"),
    marketValue2027: 700,
    marketValue2012: 40.3,
    locationGroups: [
      {
        label: "Residential lots located at barangay Fedilisan.",
        barangays: FEDILISAN,
      },
    ],
  },
  {
    id: "r-11",
    subClass: "R-11",
    category: "residential",
    color: color("R-11"),
    marketValue2027: 500,
    marketValue2012: 40.3,
    locationGroups: [
      {
        label:
          "Residential lots in sitios of every barangay unreached by road.",
        barangays: ALL_BARANGAYS,
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
