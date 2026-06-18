// Hierarchical SMV schedule data for Paracelis, derived from the
// 2027 valuation table issued by the Provincial Assessor's Office.
// Same shape as lib/sabangan.js / lib/besao.js / lib/sadanga.js /
// lib/natonin.js so the shared shell drives Paracelis without
// changes.
//
// Two known gaps vs. the LGU's authoritative schedule:
//   - No commercial classes (C-1 etc.) keyed in. The schedule the
//     PAO provided was residential-only; if Paracelis has a
//     commercial schedule, send the rows and I'll add them.
//   - R-8 row header exists in the source document but has no
//     description and no price. Not keyed here. When the LGU
//     publishes the R-8 description and value, add it in-place.

const colorByClass = {
  // C-1 is provisional. The schedule paste from the PAO was
  // residential-only, but the Paracelis CAD file has 11 polygons
  // tagged Commercial. Color here is a placeholder so they render in
  // the DXF preview; remove or tune once the LGU sends the
  // commercial schedule rows.
  "C-1": "#c63b24",
  "R-1": "#c63b24",
  "R-2": "#ec6bd6",
  "R-3": "#fda4af",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2a2a6f",
  // R-8 is provisional. Schedule paste had the header but no
  // description / price; the CAD file has 65 polygons tagged R-8.
  // Color here is a placeholder.
  "R-8": "#1a1a4f",
};

// 9 PSA-confirmed Paracelis barangays. PSA's canonical spellings
// are used as `name`; the schedule uses three older variant
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

// Paracelis 2027 SMV. Source: PAO Paracelis schedule, residential
// portion (no commercial classes were provided). Seven authoritative
// tiers plus C-1 and R-8 as provisional placeholders covering
// polygons present in the CAD file but absent from the schedule.
export const PARACELIS_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: null,
    provisional: true,
    locationGroups: [
      {
        label:
          "Provisional C-1 commercial zones from the CAD file. Pending LGU SMV value and barangay scope.",
        barangays: [],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 1730,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Poblacion, along the National Road in Bantay and Palitod, and along the Provincial Road including the Bacarri-Addang-Tawang Road and the Aba-Bacarri-Nansuso Road.",
        barangays: ["poblacion", "bantay", "palitod", "bacarni"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 1420,
    locationGroups: [
      {
        label:
          "Residential lots along the Municipal and Barangay Roads within Palitod, Butigue, and Bananao.",
        barangays: ["palitod", "butigue", "bananao"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 1170,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial Road, from Barangay Poblacion to Bantay.",
        barangays: ["poblacion", "bantay"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 960,
    locationGroups: [
      {
        label:
          "Residential lots along the Municipal and Barangay Roads within Bantay and Bacarni, within the inner part of Bananao, Palitod, and Butigue, along the National Road within Anonat, and along the Catubangan-Nanalao-Kiling Road.",
        barangays: [
          "bantay",
          "bacarni",
          "bananao",
          "palitod",
          "butigue",
          "anonat",
        ],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 790,
    locationGroups: [
      {
        label:
          "Residential lots within Bantay and Bacarni, and along the National Road within Anonat.",
        barangays: ["bantay", "bacarni", "anonat"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 620,
    locationGroups: [
      {
        label: "Residential lots along the barangay roads within Buringal.",
        barangays: ["buringal"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 460,
    locationGroups: [
      {
        label:
          "Residential lots within Bunot, and within the inner parts of Buringal and Anonat.",
        barangays: ["bunot", "buringal", "anonat"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: null,
    provisional: true,
    locationGroups: [
      {
        label:
          "Provisional R-8 zones from the CAD file. Schedule header was present but no description or price.",
        barangays: [],
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
