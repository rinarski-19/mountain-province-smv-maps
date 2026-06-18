// Hierarchical SMV data for Bauko, mirroring the structure used in the
// presentation app: classes → locationGroups → barangays.
//
// Step navigation walks barangays inside a group, then jumps to the next
// group's first barangay, then the next class. The bottom bar reads class
// + group + barangay position counters off this structure.

import { CLASSIFICATION_INFO, colorForClass } from "./classifications.js";

// Barangay slug → human name. Slugs match the presentation app's keys so
// data files line up if you ever swap them.
export const BAUKO_BARANGAYS = [
  { slug: "abatan", name: "Abatan", digitized: false },
  { slug: "mabaay", name: "Mabaay", digitized: false },
  { slug: "sinto", name: "Sinto", digitized: false },
  { slug: "sadsadan", name: "Sadsadan", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "mount-data", name: "Mount Data", digitized: false },
  { slug: "monamon-sur", name: "Monamon Sur", digitized: false },
  { slug: "monamon-norte", name: "Monamon Norte", digitized: false },
  { slug: "banao", name: "Banao", digitized: false },
  { slug: "otucan-sur", name: "Otucan Sur", digitized: false },
  { slug: "otucan-norte", name: "Otucan Norte", digitized: false },
  { slug: "bila", name: "Bila", digitized: false },
  { slug: "guinzadan-sur", name: "Guinzadan Sur", digitized: false },
  { slug: "guinzadan-central", name: "Guinzadan Central", digitized: false },
  { slug: "guinzadan-norte", name: "Guinzadan Norte", digitized: false },
  { slug: "tapapan", name: "Tapapan", digitized: false },
  { slug: "leseb", name: "Leseb", digitized: false },
  { slug: "lagawa", name: "Lagawa", digitized: false },
  { slug: "bagnen-oriente", name: "Bagnen Oriente", digitized: false },
  { slug: "bagnen-proper", name: "Bagnen Proper", digitized: true },
  { slug: "mayag", name: "Mayag", digitized: false },
  { slug: "balintaugan", name: "Balintaugan", digitized: false },
];

const slugByName = new Map(
  BAUKO_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);

export function slugForName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function barangayBySlug(slug) {
  return BAUKO_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Per-class color resolution. Delegates to the shared resolver in
// lib/classifications.js so the Bauko-local override for C-3
// (matches R-3 at ₱4,030) is the single source of truth — the same
// override that drives the sidebar chips also drives the editor's
// zone fills and the print SVG. See LGU_LOCAL_COLOR_OVERRIDES.
const color = (klass) => colorForClass(klass, "bauko");

// Hierarchical SMV table. Mirrors the presentation app, but values pulled
// from CLASSIFICATION_INFO so palette tweaks in lib/classifications.js
// flow through without editing this file.
export const BAUKO_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 6240,
    locationGroups: [
      {
        label: "Along Provincial and National Roads of Abatan",
        barangays: ["abatan"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: color("C-2"),
    marketValue2027: 5140,
    locationGroups: [
      {
        label: "Along National Road of Mabaay, Sinto, Sadsadan and Poblacion",
        barangays: ["mabaay", "sinto", "sadsadan", "poblacion"],
      },
      { label: "Inner lots of Abatan", barangays: ["abatan"] },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: color("C-3"),
    marketValue2027: 4030,
    locationGroups: [
      {
        label:
          "Along all-weather roads of Mount Data, Monamon Sur, Monamon Norte, Banao, Otucan Sur, Otucan Norte, Bila, Guinzadan Sur, Guinzadan Central, Guinzadan Norte, Tapapan, Leseb, Lagawa, Bagnen Oriente, Bagnen Proper, Mayag & Balintaugan",
        barangays: [
          "mount-data",
          "monamon-sur",
          "monamon-norte",
          "banao",
          "otucan-sur",
          "otucan-norte",
          "bila",
          "guinzadan-sur",
          "guinzadan-central",
          "guinzadan-norte",
          "tapapan",
          "leseb",
          "lagawa",
          "bagnen-oriente",
          "bagnen-proper",
          "mayag",
          "balintaugan",
        ],
      },
      {
        label: "Inner lots of all barangays except Abatan",
        barangays: [
          "mabaay",
          "sinto",
          "sadsadan",
          "poblacion",
          "mount-data",
          "monamon-sur",
          "monamon-norte",
          "banao",
          "otucan-sur",
          "otucan-norte",
          "bila",
          "guinzadan-sur",
          "guinzadan-central",
          "guinzadan-norte",
          "tapapan",
          "leseb",
          "lagawa",
          "bagnen-oriente",
          "bagnen-proper",
          "mayag",
          "balintaugan",
        ],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: color("R-1"),
    marketValue2027: 6240,
    locationGroups: [
      {
        label: "Along Provincial and National Roads of Abatan",
        barangays: ["abatan"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 5140,
    locationGroups: [
      {
        label:
          "Along National Road of Mabaay, Sinto, Sadsadan, Poblacion, Guinzadan Central, Guinzadan Sur, Monamon Sur and Mount Data",
        barangays: [
          "mabaay",
          "sinto",
          "sadsadan",
          "poblacion",
          "guinzadan-central",
          "guinzadan-sur",
          "monamon-sur",
          "mount-data",
        ],
      },
      { label: "Inner lots of Abatan", barangays: ["abatan"] },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 4030,
    locationGroups: [
      {
        label:
          "Inner lots of Mabaay, Sinto, Sadsadan, Guinzadan Central, Guinzadan Sur, Mount Data, Monamon Sur and Poblacion",
        barangays: [
          "mabaay",
          "sinto",
          "sadsadan",
          "guinzadan-central",
          "guinzadan-sur",
          "mount-data",
          "monamon-sur",
          "poblacion",
        ],
      },
      {
        label:
          "Residential lots along all-weather roads within the barangays of Guinzadan Norte, Tapapan, Leseb, Lagawa & Bila",
        barangays: ["guinzadan-norte", "tapapan", "leseb", "lagawa", "bila"],
      },
      {
        label:
          "Along National Road and all-weather roads within Banao and Otucan Sur except from Kapayawan Bridge until Saint Paul Parish Church, Pak-as",
        barangays: ["banao", "otucan-sur"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 3150,
    locationGroups: [
      {
        label:
          "Inner lots of Monamon Norte, Banao, Otucan Sur & Norte, Tapapan, Leseb and Lagawa",
        barangays: [
          "monamon-norte",
          "banao",
          "otucan-sur",
          "otucan-norte",
          "tapapan",
          "leseb",
          "lagawa",
        ],
      },
      {
        label:
          "Along National Road within Otucan Sur starting from Kapayawan Bridge until Saint Paul Parish Church, Pak-as",
        barangays: ["otucan-sur"],
      },
      {
        label: "Along all-weather roads and inner lots within Mayag",
        barangays: ["mayag"],
      },
      {
        label:
          "Along all-weather roads and inner lots within Bagnen Proper and Oriente",
        barangays: ["bagnen-proper", "bagnen-oriente"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: color("R-5"),
    marketValue2027: 2480,
    locationGroups: [
      {
        label: "Along all-weather roads and inner lots of Balintaugan",
        barangays: ["balintaugan"],
      },
    ],
  },
];

export const COMMERCIAL_CLASSIFICATIONS = BAUKO_CLASSIFICATIONS.filter(
  (c) => c.category === "commercial"
);
export const RESIDENTIAL_CLASSIFICATIONS = BAUKO_CLASSIFICATIONS.filter(
  (c) => c.category === "residential"
);

// All distinct barangay slugs across a class's groups.
export function uniqueBarangaysFor(classification) {
  return Array.from(
    new Set(classification.locationGroups.flatMap((g) => g.barangays))
  );
}
