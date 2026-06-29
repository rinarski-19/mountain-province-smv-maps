// Hierarchical SMV schedule data for Paracelis, transcribed from the
// Provincial Assessor's Office "Paracelis Form no. 1 Office Order"
// (2027 General Revision under RA 12001 §15). Same shape as the other
// LGU modules so the shared shell drives Paracelis without changes.
//
// Standard depth (residential): 30 meters.
// Corner influence: 10 % (residential AND commercial).

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES for
// Paracelis (currently: C-1 inherits R-1's color so the matching ₱2,100
// tier reads as a single visual band). Other classes pass through to
// the global CLASSIFICATION_INFO palette.
const color = (klass) => colorForClass(klass, "paracelis");

// 9 PSA-confirmed Paracelis barangays. PSA's canonical spellings
// are used as `name`; the LGU schedule uses three older variant
// spellings (Bacarri / Butique / Palitud) which are accepted as
// aliases in slugByName below.
export const PARACELIS_BARANGAYS = [
  { slug: "anonat", name: "Anonat", digitized: false },
  { slug: "bacarni", name: "Bacarni", digitized: false },
  { slug: "bananao", name: "Bananao", digitized: false },
  { slug: "bantay", name: "Bantay", digitized: false },
  { slug: "bunot", name: "Bunot", digitized: false },
  { slug: "buringal", name: "Buringal", digitized: false },
  { slug: "butigue", name: "Butigue", digitized: false },
  { slug: "palitod", name: "Palitod", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
];

const slugByName = new Map(
  PARACELIS_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
// Aliases — older / alternate spellings used in the LGU schedule.
slugByName.set("bacarri", "bacarni");
slugByName.set("butique", "butigue");
slugByName.set("palitud", "palitod");

export function slugForParacelisName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (slugByName.has(key)) return slugByName.get(key);
  const stripped = key.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return slugByName.get(stripped) ?? null;
}

export function paracelisBarangayBySlug(slug) {
  return PARACELIS_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Paracelis 2027 SMV — full schedule from the LGU Office Order.
// 1 commercial class + 8 residential classes (R-1..R-8 all keyed).
export const PARACELIS_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 2100,
    locationGroups: [
      {
        label:
          "Commercial lots located along all-weather Road. (PDF does not enumerate barangays; in practice this means the same corridors as R-1.)",
        barangays: ["poblacion", "bananao", "butigue"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: color("R-1"),
    marketValue2027: 2100,
    locationGroups: [
      {
        label:
          "Residential lots along National Roads within Poblacion, Bananao, and Butigue; along Basilan Provincial Road, Marat-Babba Provincial Road, and Tapinit-Licoy Provincial Road within Poblacion.",
        barangays: ["poblacion", "bananao", "butigue"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 1730,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Poblacion; along the National Road within Bantay and Palitod; along the Provincial Road, Bacarri-Addang-Tawang Road, and Aba-Bacarri-Nansuso Road.",
        barangays: ["poblacion", "bantay", "palitod", "bacarni"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 1420,
    locationGroups: [
      {
        label:
          "Residential lots along Municipal and Barangay Roads within Palitod, Butigue, and Bananao.",
        barangays: ["palitod", "butigue", "bananao"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 1170,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial Road, from Poblacion to Bantay; along Municipal and Barangay Roads within Bantay and Bacarni.",
        barangays: ["poblacion", "bantay", "bacarni"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: color("R-5"),
    marketValue2027: 960,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Bananao, Palitod, and Butigue; along the National Road within Anonat; along the Catubangan-Nanalao-Kiling Road.",
        barangays: ["bananao", "palitod", "butigue", "anonat"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: color("R-6"),
    marketValue2027: 790,
    locationGroups: [
      {
        label:
          "Residential lots within Bantay and Bacarni; along the National Road within Anonat.",
        barangays: ["bantay", "bacarni", "anonat"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: color("R-7"),
    marketValue2027: 620,
    locationGroups: [
      {
        label: "Residential lots along Barangay roads within Buringal.",
        barangays: ["buringal"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: color("R-8"),
    marketValue2027: 460,
    locationGroups: [
      {
        label:
          "Residential lots within Bunot, and within the inner parts of Buringal and Anonat.",
        barangays: ["bunot", "buringal", "anonat"],
      },
    ],
  },
];

export const PARACELIS_COMMERCIAL_CLASSIFICATIONS =
  PARACELIS_CLASSIFICATIONS.filter((c) => c.category === "commercial");
export const PARACELIS_RESIDENTIAL_CLASSIFICATIONS =
  PARACELIS_CLASSIFICATIONS.filter((c) => c.category === "residential");

export function uniqueBarangaysForParacelis(classification) {
  return Array.from(
    new Set(
      (classification?.locationGroups ?? []).flatMap((group) => group.barangays)
    )
  );
}
