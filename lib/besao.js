// Hierarchical SMV schedule data for Besao, derived from the 2027
// valuation table. Same shape as lib/sabangan.js / lib/tadian.js so the
// shared shell (Sidebar, BottomBar, slideshow nav) drives Besao without
// changes.

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES for
// besao: every R-N that shares a ₱ value with the matching C-N
// inherits the C-N color so the tier reads as a single visual band.
const color = (klass) => colorForClass(klass, "besao");

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

// Besao 2027 SMV — OFFICIAL schedule transcribed 2026-06-22 from
// "Besao GR FORM No. 1" (Office Order No. 01, Office of the
// Provincial Assessor). 2006 / 2014 / 2027 columns are in the source
// document; only the 2027 values are keyed here. Three commercial
// classes (C-1..C-3) and seven residential classes (R-1..R-7) — no
// R-8 in the official schedule.
//
// Standard depth: 30 m (both residential and commercial).
//
// Heads-up: the previous (pre-official) draft included R-8 (₱830,
// Tamboan corridor + inner Laylaya/Ambagiw). Official schedule folds
// those into R-6 (Laylaya/Tamboan corridor) and R-7 (Ambagiw +
// Gueday/Laylaya/Tamboan/Catengan inner). Existing R-8 polygons in
// public/data/besao_zones.geojson need manual re-tagging.
export const BESAO_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 2560,
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
    color: color("C-2"),
    marketValue2027: 1910,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather roads and inner lots within Besao East, Besao West, Payeo, Padangaan, Suquib, Lacmaan, Catengan, and Laylaya; and inner lots within Kin-iway.",
        barangays: [
          "besao-east",
          "besao-west",
          "payeo",
          "padangaan",
          "suquib",
          "lacmaan",
          "catengan",
          "laylaya",
          "kin-iway",
        ],
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: color("C-3"),
    marketValue2027: 1490,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather roads and inner lots of Agawa, Gueday, Banguitan, Ambagiw, and Tamboan.",
        barangays: [
          "agawa",
          "gueday",
          "banguitan",
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
    color: color("R-1"),
    marketValue2027: 2560,
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
    color: color("R-2"),
    marketValue2027: 1910,
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
    color: color("R-3"),
    marketValue2027: 1490,
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
    color: color("R-4"),
    marketValue2027: 1230,
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
    color: color("R-5"),
    marketValue2027: 1060,
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
    color: color("R-6"),
    marketValue2027: 960,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather roads within Laylaya, Tamboan, Gueday, and Catengan, and inner lots within Banguitan and Agawa.",
        barangays: [
          "laylaya",
          "tamboan",
          "gueday",
          "catengan",
          "banguitan",
          "agawa",
        ],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: color("R-7"),
    marketValue2027: 830,
    locationGroups: [
      {
        label:
          "Residential lots within Barangay Ambagiw, and inner lots within Gueday, Laylaya, Tamboan, and Catengan.",
        barangays: [
          "ambagiw",
          "gueday",
          "laylaya",
          "tamboan",
          "catengan",
        ],
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
