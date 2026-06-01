// Hierarchical SMV schedule data for Besao, derived from the 2027
// valuation table. Same shape as lib/sabangan.js / lib/tadian.js so the
// shared shell (Sidebar, BottomBar, slideshow nav) drives Besao without
// changes.

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
  "R-7": "#2a2a6f",
  "R-8": "#1a1a4f",
};

// 14 PSA-confirmed Besao barangays. Slugs are lowercase hyphenated;
// Kin-iway keeps its hyphen as part of the canonical name. PSGC
// municipality code is PH144403; per-barangay PSGC codes
// (PH144403001-014) sit in the matching
// public/data/besao_barangays.geojson properties once fetched.
//
// NOTE: the LGU 2027 SMV table references "Dandanac" as a C-3 area.
// That name is not in the PSA barangay list; it may be a sitio of one
// of the listed barangays (most likely Catengan or Tamboan). Verify
// with PAO and either remap it to its parent barangay slug or, if it
// turns out to be a 15th barangay, add it here and bump
// `expectedBarangays` in scripts/fetch-psa-boundaries.mjs from 14 to 15.
export const BESAO_BARANGAYS = [
  { slug: "agawa", name: "Agawa", digitized: false },
  { slug: "ambagiw", name: "Ambagiw", digitized: false },
  { slug: "banguitan", name: "Banguitan", digitized: false },
  { slug: "besao-east", name: "Besao East", digitized: false },
  { slug: "besao-west", name: "Besao West", digitized: false },
  { slug: "catengan", name: "Catengan", digitized: false },
  { slug: "gueday", name: "Gueday", digitized: false },
  { slug: "kin-iway", name: "Kin-iway", digitized: false },
  { slug: "lacmaan", name: "Lacmaan", digitized: false },
  { slug: "laylaya", name: "Laylaya", digitized: false },
  { slug: "padangaan", name: "Padangaan", digitized: false },
  { slug: "payeo", name: "Payeo", digitized: false },
  { slug: "suquib", name: "Suquib", digitized: false },
  { slug: "tamboan", name: "Tamboan", digitized: false },
];

// Build the name -> slug map directly off the canonical BESAO_BARANGAYS
// entries. "Dandanac" is mapped to catengan provisionally (most
// commonly grouped with Catengan in PAO reference notes) until PAO
// confirms the real parent; remove the alias if it becomes its own
// barangay.
const slugByName = new Map(
  BESAO_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
slugByName.set("besao east (poblacion)", "besao-east");
slugByName.set("dandanac", "catengan");

export function slugForBesaoName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function besaoBarangayBySlug(slug) {
  return BESAO_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Besao 2027 SMV. Source: LGU schedule of base unit market values.
// Values are in PHP per square meter. Three commercial classes (C-1
// through C-3) and eight residential classes (R-1 through R-8).
//
// The schedule layers Kin-iway (the poblacion) as the highest tier,
// then Besao East / West + their immediate satellite barangays at the
// middle tiers, then the outer-ring barangays descending in price as
// you move away from the road network.
export const BESAO_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 4810,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather road within Barangay Kin-iway.",
        barangays: ["kin-iway"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 3610,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather roads and inner lots within Besao East, Besao West, Payeo, Padangaan, Suquib, Lacmaan, Agawa, and Banguitan; and inner lots within Kin-iway.",
        barangays: [
          "besao-east",
          "besao-west",
          "payeo",
          "padangaan",
          "suquib",
          "lacmaan",
          "agawa",
          "banguitan",
          "kin-iway",
        ],
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: colorByClass["C-3"],
    marketValue2027: 2560,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather roads and inner lots of Catengan, Gueday, Laylaya, Ambagiw, Dandanac, and Tamboan.",
        barangays: [
          "catengan",
          "gueday",
          "laylaya",
          "ambagiw",
          "tamboan",
        ],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 4810,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather road within Barangay Kin-iway.",
        barangays: ["kin-iway"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 3610,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Payeo and Padangaan, and inner lots of Kin-iway.",
        barangays: ["payeo", "padangaan", "kin-iway"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 2560,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads of Besao West and Besao East, and inner lots within Payeo and Padangaan.",
        barangays: ["besao-west", "besao-east", "payeo", "padangaan"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 1910,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Suquib and Lacmaan, and inner lots within Besao East and Besao West.",
        barangays: ["suquib", "lacmaan", "besao-east", "besao-west"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 1490,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Banguitan and Agawa, and inner lots of Suquib and Lacmaan.",
        barangays: ["banguitan", "agawa", "suquib", "lacmaan"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 1230,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Gueday and Catengan, and inner lots within Banguitan and Agawa.",
        barangays: ["gueday", "catengan", "banguitan", "agawa"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 1010,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Laylaya and Ambagiw, and inner lots within Gueday and Catengan.",
        barangays: ["laylaya", "ambagiw", "gueday", "catengan"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: 830,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads and inner lots of Barangay Tamboan, and inner lots within Laylaya and Ambagiw.",
        barangays: ["tamboan", "laylaya", "ambagiw"],
      },
    ],
  },
];

export const BESAO_COMMERCIAL_CLASSIFICATIONS = BESAO_CLASSIFICATIONS.filter(
  (c) => c.category === "commercial"
);
export const BESAO_RESIDENTIAL_CLASSIFICATIONS = BESAO_CLASSIFICATIONS.filter(
  (c) => c.category === "residential"
);

export function uniqueBarangaysForBesao(classification) {
  return Array.from(
    new Set(
      (classification?.locationGroups ?? []).flatMap((group) => group.barangays)
    )
  );
}
