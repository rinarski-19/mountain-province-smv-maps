// Hierarchical SMV schedule data for Natonin, derived from the 2027
// valuation table issued by the Provincial Assessor's Office. Same
// shape as lib/sabangan.js / lib/besao.js / lib/sadanga.js so the
// shared shell (Sidebar, BottomBar, slideshow nav) drives Natonin
// without changes.

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES for
// natonin: every R-N that shares a ₱ value with the matching C-N
// inherits the C-N color so the tier reads as a single visual band.
const color = (klass) => colorForClass(klass, "natonin");

// 11 PSA-confirmed Natonin barangays (PSA returns city_code 144405
// with brgy_code 144405001-011). Per-barangay polygons live in
// public/data/natonin_barangays.geojson once the boundary fetch runs.
//
// Two barangays (Balangao and Banawal) are not mentioned in the 2027
// schedule below — they'll still render as polygon outlines but
// won't appear in any class chip's stretch list until the LGU
// publishes a class for them.
export const NATONIN_BARANGAYS = [
  { slug: "alunogan", name: "Alunogan", digitized: false },
  { slug: "balangao", name: "Balangao", digitized: false },
  { slug: "banao", name: "Banao", digitized: false },
  { slug: "banawal", name: "Banawal", digitized: false },
  { slug: "butac", name: "Butac", digitized: false },
  { slug: "maducayan", name: "Maducayan", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "pudo", name: "Pudo", digitized: false },
  { slug: "saliok", name: "Saliok", digitized: false },
  { slug: "sta-isabel", name: "Santa Isabel", digitized: false },
  { slug: "tonglayan", name: "Tonglayan", digitized: false },
];

const slugByName = new Map(
  NATONIN_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
// Aliases for variants used by PSA returns or the LGU schedule.
slugByName.set("sta. isabel", "sta-isabel");
slugByName.set("sta isabel", "sta-isabel");
slugByName.set("santa isabel", "sta-isabel");
// PSA spells it "Banawal"; the LGU schedule uses "Banawel".
slugByName.set("banawel", "banawal");

export function slugForNatoninName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (slugByName.has(key)) return slugByName.get(key);
  const stripped = key.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return slugByName.get(stripped) ?? null;
}

export function natoninBarangayBySlug(slug) {
  return NATONIN_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Natonin 2027 SMV. Source: PAO Natonin schedule, transcribed from
// the table with 2006 / 2012 / 2027 columns. Only 2027 is keyed here.
//
// Two corridor tiers (C-1 / R-1 + R-3 / R-4 / R-5) follow the
// National Road and the Saliok-Maducayan Provincial Road; one
// inner-lot tier (R-2) covers Poblacion's interior.
//
//   C-1 / R-1: Poblacion's all-weather road + Saliok along the
//              National Road
//   R-2:       inner lots of Poblacion
//   R-3:       National Road through Butac / Sta. Isabel /
//              Alunogan / Pudo
//   R-4:       National Road through Tonglayan / Banao
//   R-5:       Saliok-Maducayan Provincial Road
export const NATONIN_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 1820,
    locationGroups: [
      {
        label:
          "Commercial lots along the all-weather road within Barangay Poblacion, and along the National Road within Barangay Saliok.",
        barangays: ["poblacion", "saliok"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: color("R-1"),
    marketValue2027: 1820,
    locationGroups: [
      {
        label:
          "Residential lots along the all-weather road within Barangay Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 1500,
    locationGroups: [
      {
        label: "Residential lots within the inner part of Barangay Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 1290,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road within Barangays Butac, Santa Isabel, Alunogan, and Pudo.",
        barangays: ["butac", "sta-isabel", "alunogan", "pudo"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 1120,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road within Barangays Tonglayan and Banao.",
        barangays: ["tonglayan", "banao"],
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
          "Residential lots along the Saliok-Maducayan Provincial Road.",
        // Saliok is the starting barangay; Maducayan is the
        // destination. Both are listed so the sidebar shows the
        // corridor's two endpoints.
        barangays: ["saliok", "maducayan"],
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
          "Residential lots along the all-weather roads within Barangays Balangao and Banawal, and within the inner part of Butac, Santa Isabel, Alunogan, and Pudo.",
        barangays: [
          "balangao",
          "banawal",
          "butac",
          "sta-isabel",
          "alunogan",
          "pudo",
        ],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: color("R-7"),
    marketValue2027: 590,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Barangays Tonglayan, Banao, and Saliok.",
        barangays: ["tonglayan", "banao", "saliok"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: color("R-8"),
    marketValue2027: 440,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Barangay Maducayan, and within the inner parts of Balangao and Banawal.",
        barangays: ["maducayan", "balangao", "banawal"],
      },
    ],
  },
];

export const NATONIN_COMMERCIAL_CLASSIFICATIONS =
  NATONIN_CLASSIFICATIONS.filter((c) => c.category === "commercial");
export const NATONIN_RESIDENTIAL_CLASSIFICATIONS =
  NATONIN_CLASSIFICATIONS.filter((c) => c.category === "residential");

export function uniqueBarangaysForNatonin(classification) {
  return Array.from(
    new Set(
      (classification?.locationGroups ?? []).flatMap((group) => group.barangays)
    )
  );
}
