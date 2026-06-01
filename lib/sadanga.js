// Hierarchical SMV schedule data for Sadanga, derived from the 2027
// valuation table issued by the Provincial Assessor's Office. Same
// shape as lib/sabangan.js / lib/besao.js so the shared shell
// (Sidebar, BottomBar, slideshow nav) drives Sadanga without changes.
//
// Sadanga is the first Mountain Province LGU we plan to operate with
// a per-building override mode on top of the corridor schedule below.
// The corridors stay as the base layer; individual building polygons
// can be tagged with their own class (e.g. a commercial sari-sari
// store sitting inside an R-3 inner-lot zone). That mode is wired in
// EditableZones / LeafletMap and gated by `municipalitySlug ===
// "sadanga"`.

const colorByClass = {
  "C-1": "#c63b24",
  "R-1": "#ff26f0",
  "R-2": "#c440ea",
  "R-3": "#8b33ff",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2a2a6f",
};

// 8 PSA-confirmed Sadanga barangays. The municipality's main
// poblacion barangay is officially just "Sadanga" in PSGC, though the
// SMV schedule and local usage refer to it as "Poblacion". We keep
// the canonical PSA name (Sadanga) as the display name and accept
// "poblacion" / "poblacion sadanga" as aliases below so the schedule
// labels still resolve.
export const SADANGA_BARANGAYS = [
  { slug: "anabel", name: "Anabel", digitized: false },
  { slug: "bekigan", name: "Bekigan", digitized: false },
  { slug: "belwang", name: "Belwang", digitized: false },
  { slug: "betwagan", name: "Betwagan", digitized: false },
  { slug: "demang", name: "Demang", digitized: false },
  { slug: "sacasacan", name: "Sacasacan", digitized: false },
  { slug: "saclit", name: "Saclit", digitized: false },
  { slug: "sadanga", name: "Sadanga (Poblacion)", digitized: false },
];

const slugByName = new Map(
  SADANGA_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);
// Aliases for variants used in the schedule or in PSA returns.
slugByName.set("sadanga", "sadanga");
slugByName.set("poblacion", "sadanga");
slugByName.set("poblacion sadanga", "sadanga");
slugByName.set("sadanga poblacion", "sadanga");

export function slugForSadangaName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (slugByName.has(key)) return slugByName.get(key);
  const stripped = key.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return slugByName.get(stripped) ?? null;
}

export function sadangaBarangayBySlug(slug) {
  return SADANGA_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Sadanga 2027 SMV. Source: PAO Sadanga schedule, transcribed from
// the table with 2006 / 2012 / 2027 columns. Only 2027 is keyed here;
// historical values stay in the original document.
//
// The schedule layers are:
//   C-1 / R-1 (highest): National Road through Saclit + Provincial
//     and Municipal Roads through Poblacion (Sadanga) and Sacasacan
//   R-2: secondary roads in Saclit, Betwagan, Anabel
//   R-3: inner lots of Poblacion, Sacasacan, Sitio Fan-ayan
//     (Betwagan), Sitio Lilit (Anabel)
//   R-4: residential lots in Demang, Betwagan, Anabel (whole
//     barangay, not just inner lots)
//   R-5: inner part of Saclit
//   R-6: residential lots in Belwang and Bekigan
//   R-7: residential lots in Sitio Sacco, Anabel
export const SADANGA_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 1890,
    locationGroups: [
      {
        label:
          "Commercial lots along the National Road from Gawa to Mamaga in Saclit, along the Provincial Road from Ampawilen junction to Lidem junction in Poblacion (Sadanga), along the Municipal Road from Lidem junction to the Municipal Hall, and along the Municipal Road from Opocan junction in Poblacion to the Sacasacan Barangay Hall.",
        barangays: ["saclit", "sadanga", "sacasacan"],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 1890,
    locationGroups: [
      {
        label:
          "Residential lots along the National Road from Gawa to Mamaga in Saclit, along the Provincial Road from Ampawilen junction to Lidem junction in Poblacion (Sadanga), along the Municipal Road from Lidem junction to the Municipal Hall, along the Municipal Road from Lidem junction to Tap-ag Elementary School in Poblacion, and along the Municipal Road from Opocan junction to the Sacasacan Barangay Hall.",
        barangays: ["saclit", "sadanga", "sacasacan"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 1590,
    locationGroups: [
      {
        label:
          "Residential lots along the Provincial Road from Mamaga junction to Saclit Road, along the Municipal Road from Tabrak junction to Betwagan Road, and along the Municipal Road from the Anabel Welcome Arc to Sitio Lilit in Anabel.",
        barangays: ["saclit", "betwagan", "anabel"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 1260,
    locationGroups: [
      {
        label:
          "Residential lots within the inner part of Poblacion (Sadanga) and Barangay Sacasacan, within the inner part of Sitio Fan-ayan in Betwagan, and within the inner part of Sitio Lilit in Anabel.",
        barangays: ["sadanga", "sacasacan", "betwagan", "anabel"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 1000,
    locationGroups: [
      {
        label:
          "Residential lots within Barangays Demang, Betwagan, and Anabel.",
        barangays: ["demang", "betwagan", "anabel"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 750,
    locationGroups: [
      {
        label: "Residential lots within the inner part of Barangay Saclit.",
        barangays: ["saclit"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 530,
    locationGroups: [
      {
        label: "Residential lots within Barangays Belwang and Bekigan.",
        barangays: ["belwang", "bekigan"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 400,
    locationGroups: [
      {
        label: "Residential lots within Sitio Sacco in Anabel.",
        barangays: ["anabel"],
      },
    ],
  },
];

export const SADANGA_COMMERCIAL_CLASSIFICATIONS =
  SADANGA_CLASSIFICATIONS.filter((c) => c.category === "commercial");
export const SADANGA_RESIDENTIAL_CLASSIFICATIONS =
  SADANGA_CLASSIFICATIONS.filter((c) => c.category === "residential");

export function uniqueBarangaysForSadanga(classification) {
  return Array.from(
    new Set(
      (classification?.locationGroups ?? []).flatMap((group) => group.barangays)
    )
  );
}
