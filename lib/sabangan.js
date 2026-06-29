// Hierarchical SMV schedule data for Sabangan, derived from the 2027
// valuation table. Same shape as lib/tadian.js so the shared shell
// (Sidebar, BottomBar, slideshow nav) drives Sabangan without changes.

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES for
// sabangan: every R-N that shares a ₱ value with the matching C-N
// inherits the C-N color so the tier reads as a single visual band.
const color = (klass) => colorForClass(klass, "sabangan");

// 15 PSA-confirmed Sabangan barangays. Slugs are lowercase hyphenated;
// Bao-angan and Bun-ayan keep their hyphens as part of the canonical
// name. PSGC codes (PH144407001–015) are in the matching
// public/data/sabangan_barangays.geojson properties.
export const SABANGAN_BARANGAYS = [
  { slug: "bao-angan", name: "Bao-angan", digitized: false },
  { slug: "bun-ayan", name: "Bun-ayan", digitized: false },
  { slug: "busa", name: "Busa", digitized: false },
  { slug: "camatagan", name: "Camatagan", digitized: false },
  { slug: "capinitan", name: "Capinitan", digitized: false },
  { slug: "data", name: "Data", digitized: false },
  { slug: "gayang", name: "Gayang", digitized: false },
  { slug: "lagan", name: "Lagan", digitized: false },
  { slug: "losad", name: "Losad", digitized: false },
  { slug: "namatec", name: "Namatec", digitized: false },
  { slug: "napua", name: "Napua", digitized: false },
  { slug: "pingad", name: "Pingad", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "supang", name: "Supang", digitized: false },
  { slug: "tambingan", name: "Tambingan", digitized: false },
];

// Build the name → slug map directly off the canonical SABANGAN_BARANGAYS
// entries. Aliases used by the schedule but not matching the canonical
// barangay name (e.g. "Lusad" -> losad, "Población" -> poblacion) are
// appended after the auto-built ones.
const slugByName = new Map(
  SABANGAN_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
slugByName.set("lusad", "losad");
slugByName.set("población", "poblacion");

export function slugForSabanganName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function sabanganBarangayBySlug(slug) {
  return SABANGAN_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Sabangan 2027 SMV — OFFICIAL schedule from "Sabangan Form No. 1.docx"
// (Office of the Provincial Assessor, April 24, 2025 order). Replaces
// the earlier C-1..C-2 + R-1..R-12 draft with the canonical 2 commercial
// + 5 residential ladder.
//
// Standard depth: 30 m (both residential and commercial).
//
// Heads-up: existing besao_zones polygons classified as R-6..R-12 are
// orphans under this schedule and need manual re-tagging in the editor.
// Most map to R-2 (corridor frontages) or R-4 (inner-lot fills) in the
// new ladder.
export const SABANGAN_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 3880,
    locationGroups: [
      {
        label:
          "Commercial lots along the National Road: Nacagang Junction to Palinga-ao (Lagan); Nacagang Junction to Lintoco (Supang); Nacagang Junction to Poblacion to Panorama (Losad).",
        barangays: ["lagan", "supang", "poblacion", "losad"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: color("C-2"),
    marketValue2027: 2770,
    locationGroups: [
      {
        label:
          "Commercial lots along the National Road from Bisibisan (Supang) to Dawaic (Supang); along the Provincial Road from Dawdawan to Madepdeppas to Pinumdeng (Data); along the National Road from Panorama (Losad) through Bun-ayan, Bao-angan, Pingad, Camatagan, Capinitan, Busa, Namatec to Aw-awigan (Napua boundary).",
        barangays: [
          "supang",
          "data",
          "losad",
          "bun-ayan",
          "bao-angan",
          "pingad",
          "camatagan",
          "capinitan",
          "busa",
          "namatec",
          "napua",
        ],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: color("R-1"),
    marketValue2027: 3880,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road: Nacagang/Tambingan Junction to Palinga-ao (Lagan); Nacagang Junction to Lintoco (Supang); Nacagang Junction from Poblacion to Panorama (Losad).",
        barangays: ["lagan", "supang", "poblacion", "losad", "tambingan"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 2770,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road from Bisibisan (Supang) to Dawaic (Supang); along the Provincial Road from Dawdawan (Data) to Madepdeppas to Pinumdeng (Data); along the National Road from Panorama (Losad) through Bun-ayan, Bao-angan, Pingad, Camatagan, Capinitan, Busa, Namatec to Aw-awigan (Napua); inner part from Nacagang to Palinga-ao (Lagan) to Bisibisan (Supang) to Dawaic (Supang); and within Poblacion, Lagan, Losad (except Sitio Sao and Osong, Losad).",
        barangays: [
          "supang",
          "data",
          "losad",
          "bun-ayan",
          "bao-angan",
          "pingad",
          "camatagan",
          "capinitan",
          "busa",
          "namatec",
          "napua",
          "lagan",
          "poblacion",
        ],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 1960,
    locationGroups: [
      {
        label:
          "Residential lots along all Provincial, Municipal, and Barangay roads in Supang, Madepdeppas and Proper Data (Sitio Abatan Junction to Proper Data), Bun-ayan, Gayang, Camatagan, Capinitan, Namatec, Upper Tambingan, and Napua.",
        barangays: [
          "supang",
          "data",
          "bun-ayan",
          "gayang",
          "camatagan",
          "capinitan",
          "namatec",
          "tambingan",
          "napua",
        ],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 1550,
    locationGroups: [
      {
        label:
          "Residential lots in the inner part of Data, Upper Tambingan, Maggon (sitio of Supang), Supang, Sao and Osong (sitios of Losad), Bun-ayan, Bao-angan, Camatagan, Gayang, Capinitan, Busa, Namatec, and Napua.",
        barangays: [
          "data",
          "tambingan",
          "supang",
          "losad",
          "bun-ayan",
          "bao-angan",
          "camatagan",
          "gayang",
          "capinitan",
          "busa",
          "namatec",
          "napua",
        ],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: color("R-5"),
    marketValue2027: 1150,
    locationGroups: [
      {
        label:
          "Residential lots in the inner part of Sitio Duskit, Napua.",
        barangays: ["napua"],
      },
    ],
  },
];

export const SABANGAN_COMMERCIAL_CLASSIFICATIONS =
  SABANGAN_CLASSIFICATIONS.filter((c) => c.category === "commercial");
export const SABANGAN_RESIDENTIAL_CLASSIFICATIONS =
  SABANGAN_CLASSIFICATIONS.filter((c) => c.category === "residential");

export function uniqueBarangaysForSabangan(classification) {
  return Array.from(
    new Set(
      (classification?.locationGroups ?? []).flatMap((group) => group.barangays)
    )
  );
}
