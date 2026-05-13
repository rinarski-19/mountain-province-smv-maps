// Hierarchical SMV schedule data for Tadian, derived from the provided
// 2027 valuation table. Same shape as lib/barlig.js so the shared shell
// (Sidebar, BottomBar, slideshow nav) drives Tadian without changes.

const colorByClass = {
  "C-1": "#c63b24",
  "C-2": "#b91c1c",
  "C-3": "#ef4444",
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
};

// 19 PSA-confirmed Tadian barangays. Slugs are lowercase hyphenated;
// Cadad-anan keeps its hyphen as part of the canonical name.
export const TADIAN_BARANGAYS = [
  { slug: "balaoa", name: "Balaoa", digitized: false },
  { slug: "banaao", name: "Banaao", digitized: false },
  { slug: "bantey", name: "Bantey", digitized: false },
  { slug: "batayan", name: "Batayan", digitized: false },
  { slug: "bunga", name: "Bunga", digitized: false },
  { slug: "cadad-anan", name: "Cadad-anan", digitized: false },
  { slug: "cagubatan", name: "Cagubatan", digitized: false },
  { slug: "dacudac", name: "Dacudac", digitized: false },
  { slug: "duagan", name: "Duagan", digitized: false },
  { slug: "kayan-east", name: "Kayan East", digitized: false },
  { slug: "kayan-west", name: "Kayan West", digitized: false },
  { slug: "lenga", name: "Lenga", digitized: false },
  { slug: "lubon", name: "Lubon", digitized: false },
  { slug: "mabalite", name: "Mabalite", digitized: false },
  { slug: "masla", name: "Masla", digitized: false },
  { slug: "pandayan", name: "Pandayan", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "sumadel", name: "Sumadel", digitized: false },
  { slug: "tue", name: "Tue", digitized: false },
];

// Build the name → slug map directly off the canonical TADIAN_BARANGAYS
// entries. Any aliases the schedule uses (none currently) can be appended
// after the auto-built ones.
const slugByName = new Map(
  TADIAN_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);

export function slugForTadianName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function tadianBarangayBySlug(slug) {
  return TADIAN_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

const ALL_TADIAN_SLUGS = TADIAN_BARANGAYS.map((b) => b.slug);

// Slug subsets that show up repeatedly in the schedule.
const ALL_WEATHER_R2_R4 = [
  "kayan-west",
  "kayan-east",
  "bunga",
  "tue",
  "balaoa",
  "lubon",
  "masla",
];
const ALL_WEATHER_R3_R5 = [
  "cagubatan",
  "banaao",
  "pandayan",
  "cadad-anan",
  "lenga",
  "dacudac",
  "sumadel",
  "batayan",
  "bantey",
  "duagan",
];

export const TADIAN_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 6000,
    locationGroups: [
      {
        label:
          "Commercial lots along all-weather roads of Poblacion and along the national road from Malupa – Cabunagan to Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 4900,
    locationGroups: [
      {
        label:
          "Commercial lots along all-weather roads for all barangays, and commercial inner lots of Poblacion.",
        barangays: ALL_TADIAN_SLUGS,
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: colorByClass["C-3"],
    marketValue2027: 4000,
    locationGroups: [
      {
        label: "Commercial inner lots for all barangays.",
        barangays: ALL_TADIAN_SLUGS,
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 6000,
    locationGroups: [
      {
        label:
          "Residential lots along all-weather roads of Poblacion and along the national road from Malupa – Cabunagan to Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 3300,
    locationGroups: [
      {
        label:
          "Residential lots along all-weather roads of Kayan West, Kayan East, Bunga, Tue, Balaoa, Lubon, and Masla; and inner lots of Poblacion.",
        barangays: [...ALL_WEATHER_R2_R4, "poblacion"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 2600,
    locationGroups: [
      {
        label:
          "Residential lots along all-weather roads of Cagubatan, Banaao, Pandayan, Cadad-anan, Lenga, Dacudac, Sumadel, Batayan, Bantey, and Duagan.",
        barangays: ALL_WEATHER_R3_R5,
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 2150,
    locationGroups: [
      {
        label:
          "Residential inner lots of Kayan West, Kayan East, Bunga, Tue, Balaoa, Lubon, and Masla.",
        barangays: ALL_WEATHER_R2_R4,
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
          "Residential inner lots of Cagubatan, Banaao, Pandayan, Cadad-anan, Lenga, Dacudac, Sumadel, Batayan, Bantey, and Duagan.",
        barangays: ALL_WEATHER_R3_R5,
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 1100,
    locationGroups: [
      {
        label:
          "Residential lots in Mabalite, including sitios Iland, Madange, and Pasnadan.",
        barangays: ["mabalite"],
      },
    ],
  },
];

export const TADIAN_COMMERCIAL_CLASSIFICATIONS = TADIAN_CLASSIFICATIONS.filter(
  (classification) => classification.category === "commercial"
);
export const TADIAN_RESIDENTIAL_CLASSIFICATIONS = TADIAN_CLASSIFICATIONS.filter(
  (classification) => classification.category === "residential"
);

export function uniqueBarangaysForTadian(classification) {
  return Array.from(
    new Set((classification?.locationGroups ?? []).flatMap((group) => group.barangays))
  );
}
