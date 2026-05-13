// Hierarchical SMV schedule data for Sagada, derived from the LGU's
// 2026 valuation table. 4 commercial classes (C-1..C-4) and 7
// residential classes (R-1..R-7). NOTE: the field name marketValue2027
// is preserved across all municipalities for shell-component
// compatibility, but the values stored here are the LGU-supplied 2026
// figures (Sagada's schedule is dated 2026, not 2027).

const colorByClass = {
  "C-1": "#c63b24",
  "C-2": "#b91c1c",
  "C-3": "#ef4444",
  "C-4": "#f97316",
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2f3c6e",
};

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

// Slug subsets that show up repeatedly across the schedule.
const POBLACION_TIER = ["patay", "dagdag", "demang", "ambasing"];
const SECONDARY_TIER = [
  "antadao",
  "kilong",
  "ankileng",
  "suyo",
  "taccong",
  "balugan",
];
const SECONDARY_TIER_WITH_AMBASING = [
  "antadao",
  "kilong",
  "ambasing",
  "ankileng",
  "balugan",
  "suyo",
  "taccong",
];
const OUTER_TIER = [
  "tetep-an-norte",
  "tetep-an-sur",
  "madongo",
  "banga-an",
  "aguid",
  "fedilisan",
  "pide",
];
const FAR_TIER = ["nacagang", "pide", "tanulong"];

export const SAGADA_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 6200,
    locationGroups: [
      {
        label:
          "Commercial lots along all-weather roads of Patay, Dagdag, Demang, and Ambasing.",
        barangays: POBLACION_TIER,
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 5100,
    locationGroups: [
      {
        label: "Commercial inner lots of Patay, Dagdag, Demang, and Ambasing.",
        barangays: POBLACION_TIER,
      },
      {
        label:
          "Commercial lots along all-weather roads of Antadao, Kilong, Ankileng, Suyo, Taccong, and Balugan.",
        barangays: SECONDARY_TIER,
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: colorByClass["C-3"],
    marketValue2027: 4150,
    locationGroups: [
      {
        label:
          "Commercial inner lots of Antadao, Kilong, Ankileng, Suyo, and Balugan.",
        barangays: ["antadao", "kilong", "ankileng", "suyo", "balugan"],
      },
      {
        label:
          "Commercial lots along all-weather roads of Tetep-an Norte, Tetep-an Sur, Madongo, Banga-an, Aguid, Fedilisan, and Pide.",
        barangays: OUTER_TIER,
      },
    ],
  },
  {
    id: "c-4",
    subClass: "C-4",
    category: "commercial",
    color: colorByClass["C-4"],
    marketValue2027: 3550,
    locationGroups: [
      {
        label:
          "Commercial inner lots of Tetep-an Norte, Tetep-an Sur, Madongo, Banga-an, Aguid, Fedilisan, and Pide.",
        barangays: OUTER_TIER,
      },
      {
        label: "Commercial lots of Nacagang, Pide, and Tanulong.",
        barangays: FAR_TIER,
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 6150,
    locationGroups: [
      {
        label:
          "Residential lots along all-weather roads of Patay, Dagdag, Demang, and Ambasing.",
        barangays: POBLACION_TIER,
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 3000,
    locationGroups: [
      {
        label: "Residential inner lots of Patay, Dagdag, Demang, and Ambasing.",
        barangays: POBLACION_TIER,
      },
      {
        label:
          "Residential lots along all-weather roads of Antadao, Kilong, Ambasing, Ankileng, Balugan, Suyo, and Taccong.",
        barangays: SECONDARY_TIER_WITH_AMBASING,
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 2500,
    locationGroups: [
      {
        label:
          "Residential inner lots of Antadao, Kilong, Ambasing, Ankileng, Balugan, Suyo, and Taccong.",
        barangays: SECONDARY_TIER_WITH_AMBASING,
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 2000,
    locationGroups: [
      {
        label:
          "Residential lots along all-weather roads of Tetep-an Sur, Tetep-an Norte, Madongo, Banga-an, Aguid, and Fedilisan.",
        barangays: ["tetep-an-sur", "tetep-an-norte", "madongo", "banga-an", "aguid", "fedilisan"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 1650,
    locationGroups: [
      {
        label:
          "Residential inner lots of Tetep-an Sur, Tetep-an Norte, Madongo, Banga-an, Aguid, and Fedilisan.",
        barangays: ["tetep-an-sur", "tetep-an-norte", "madongo", "banga-an", "aguid", "fedilisan"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 1300,
    locationGroups: [
      {
        label:
          "Residential lots along barangay roads of Nacagang, Pide, and Tanulong.",
        barangays: FAR_TIER,
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 1050,
    locationGroups: [
      {
        label: "Residential inner lots of Nacagang, Pide, and Tanulong.",
        barangays: FAR_TIER,
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
