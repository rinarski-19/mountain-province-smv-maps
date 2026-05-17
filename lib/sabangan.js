// Hierarchical SMV schedule data for Sabangan. Same shape as lib/tadian.js
// so the shared shell (Sidebar, BottomBar, slideshow nav) drives Sabangan
// without changes.
//
// NOTE: The actual 2024/2027 SMV table for Sabangan has not been keyed in
// yet — the classifications below are a placeholder skeleton (mirrors
// Tadian's structure) so the slug renders and zones can be drawn while the
// LGU's schedule is being transcribed. Edit `marketValue2027` and the
// `locationGroups[].label` text in-place once the real table is available.

const colorByClass = {
  "C-1": "#c63b24",
  "C-2": "#b91c1c",
  "C-3": "#ef4444",
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
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
// entries. Any aliases the schedule uses (none currently) can be appended
// after the auto-built ones.
const slugByName = new Map(
  SABANGAN_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);

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

const ALL_SABANGAN_SLUGS = SABANGAN_BARANGAYS.map((b) => b.slug);

// Placeholder schedule mirroring the Tadian shape. Replace the
// `marketValue2027` and `locationGroups[].label` strings with the real
// Sabangan 2027 SMV figures + textual descriptions once the LGU's
// schedule has been transcribed.
export const SABANGAN_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: null, // TODO: fill from LGU schedule
    locationGroups: [
      {
        label:
          "PLACEHOLDER — Commercial lots along all-weather roads of Poblacion. (Replace once the Sabangan 2027 SMV table is keyed in.)",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "c-2",
    subClass: "C-2",
    category: "commercial",
    color: colorByClass["C-2"],
    marketValue2027: null,
    locationGroups: [
      {
        label:
          "PLACEHOLDER — Commercial lots along all-weather roads for all barangays, and commercial inner lots of Poblacion.",
        barangays: ALL_SABANGAN_SLUGS,
      },
    ],
  },
  {
    id: "c-3",
    subClass: "C-3",
    category: "commercial",
    color: colorByClass["C-3"],
    marketValue2027: null,
    locationGroups: [
      {
        label: "PLACEHOLDER — Commercial inner lots for all barangays.",
        barangays: ALL_SABANGAN_SLUGS,
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: null,
    locationGroups: [
      {
        label:
          "PLACEHOLDER — Residential lots along all-weather roads of Poblacion.",
        barangays: ["poblacion"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: null,
    locationGroups: [
      {
        label:
          "PLACEHOLDER — Residential lots along all-weather roads of all barangays.",
        barangays: ALL_SABANGAN_SLUGS,
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: null,
    locationGroups: [
      {
        label: "PLACEHOLDER — Residential inner lots for all barangays.",
        barangays: ALL_SABANGAN_SLUGS,
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: null,
    locationGroups: [
      {
        label: "PLACEHOLDER — Outer residential lots / second-tier barangays.",
        barangays: ALL_SABANGAN_SLUGS,
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: null,
    locationGroups: [
      {
        label: "PLACEHOLDER — Marginal residential lots.",
        barangays: ALL_SABANGAN_SLUGS,
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
