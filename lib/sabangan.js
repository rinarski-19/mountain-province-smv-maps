// Hierarchical SMV schedule data for Sabangan, derived from the 2027
// valuation table. Same shape as lib/tadian.js so the shared shell
// (Sidebar, BottomBar, slideshow nav) drives Sabangan without changes.

const colorByClass = {
  "C-1": "#c63b24",
  "C-2": "#b91c1c",
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2a2a6f",
  "R-8": "#1a1a4f",
};

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

// Sabangan 2027 SMV. Source: LGU schedule of base unit market values.
// Values are in PHP per square meter. Two commercial classes (C-1, C-2)
// and eight residential classes (R-1 through R-8). Tambingan does not
// appear in the published schedule and is left out of all groups; it
// remains a valid barangay in the PSA list above so its polygon still
// renders.
export const SABANGAN_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 3880,
    locationGroups: [
      {
        label:
          "Commercial lots along the National Road from Nacagang Junction to Palinga-ao, Lagan, and from Nacagang to Sitio Dawdawan, Supang.",
        barangays: ["lagan", "supang"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: 3030,
    locationGroups: [
      {
        label:
          "Commercial lots along the National Road from Nacagang Junction to Sitio Lingey, Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 3880,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road from Nacagang Junction to Palinga-ao, Lagan, and from Nacagang Junction to Supang.",
        barangays: ["lagan", "supang"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 3030,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road from Nacagang Junction to Sitio Liwang, Losad.",
        barangays: ["losad"],
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
          "Residential lots along the National Road starting from Dawdawan (Supang) and the Data Junction to Taccong Road.",
        barangays: ["supang", "data"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 2050,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial Road within Barangay Data, starting from the junction to Bagnen Road.",
        barangays: ["data"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 1690,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road from Dawdawan, Supang to Data Junction.",
        barangays: ["supang", "data"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 1390,
    locationGroups: [
      {
        label:
          "Residential lots in the inner part of Barangay Poblacion, and residential lots along the National Road within Busa, Capinitan, Namatec, Pingad, Losad, Bun-ayan, and Supang.",
        barangays: [
          "poblacion",
          "busa",
          "capinitan",
          "namatec",
          "pingad",
          "losad",
          "bun-ayan",
          "supang",
        ],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 1140,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road within Sitio Tabbak, Libo, and Aw-awingan of Napua, Bao-angan, and Camatagan.",
        barangays: ["napua", "bao-angan", "camatagan"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: 940,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial Road from the National Road Junction to Camatagan and Gayang, from the National Road Junction to Tabbak-Mayosen (Kalawitan) in Napua, and from the National Road Junction to Namatec.",
        barangays: ["camatagan", "gayang", "napua", "namatec"],
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
