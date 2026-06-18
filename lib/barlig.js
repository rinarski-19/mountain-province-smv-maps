// Hierarchical SMV schedule data for Barlig, derived from the provided
// valuation table (2027 market values per sqm).

const colorByClass = {
  "C-1": "#c63b24",
  "R-1": "#c63b24",
  "R-2": "#ec6bd6",
  "R-3": "#fda4af",
  "R-4": "#8c458b",
  "R-5": "#5a364e",
  "R-6": "#3f3f8f",
  "R-7": "#2f3c6e",
  "R-8": "#24324f",
};

export const BARLIG_BARANGAYS = [
  { slug: "gawana", name: "Gawana", digitized: false },
  { slug: "fiangtin", name: "Fiangtin", digitized: false },
  { slug: "lingoy-upper", name: "Lingoy (Upper)", digitized: false },
  { slug: "lingoy-lower", name: "Lingoy (Lower)", digitized: false },
  { slug: "lias-silangan", name: "Lias Silangan", digitized: false },
  { slug: "lias-kanluran", name: "Lias Kanluran", digitized: false },
  { slug: "chupac", name: "Chupac", digitized: false },
  { slug: "lunas", name: "Lunas", digitized: false },
  { slug: "lunas-mog-ao", name: "Lunas (Sitio Mog-ao)", digitized: false },
  { slug: "macalana", name: "Macalana", digitized: false },
  { slug: "latang", name: "Latang", digitized: false },
  { slug: "kaleo", name: "Kaleo", digitized: false },
  { slug: "ogo-og", name: "Ogo-og", digitized: false },
];

const slugByName = new Map([
  ["gawana", "gawana"],
  ["fiangtin", "fiangtin"],
  ["fiangtins", "fiangtin"],
  ["lingoy", "lingoy-upper"],
  ["lingoy (upper)", "lingoy-upper"],
  ["upper lingoy", "lingoy-upper"],
  ["lingoy (lower)", "lingoy-lower"],
  ["lower lingoy", "lingoy-lower"],
  ["lias silangan", "lias-silangan"],
  ["lias kanluran", "lias-kanluran"],
  ["chupac", "chupac"],
  ["lunas", "lunas"],
  ["sitio mog-ao of lunas", "lunas-mog-ao"],
  ["mog-ao", "lunas-mog-ao"],
  ["macalana", "macalana"],
  ["latang", "latang"],
  ["kaleo", "kaleo"],
  ["ogo-og", "ogo-og"],
]);

// PSA delivers some barangay names with parenthetical qualifiers,
// e.g. "Lingoy (Upper)". The lookup table above includes both forms
// (parenthesised and stripped) so the slug resolves regardless of
// what shape PSA returned. We also accept a paren-stripped fallback
// in case future LGUs introduce new bracketed names.
export function slugForBarligName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (slugByName.has(key)) return slugByName.get(key);
  // Fallback: strip trailing parenthesised qualifier and retry.
  const stripped = key.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return slugByName.get(stripped) ?? null;
}

export function barligBarangayBySlug(slug) {
  return BARLIG_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

export const BARLIG_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: colorByClass["C-1"],
    marketValue2027: 1950,
    locationGroups: [
      {
        label:
          "Commercial lots located along National Road, in sequence through Lingoy Upper, Gawana, Fiangtin, Lias Silangan, Chupac, and Lunas.",
        // Order is the sequence the National Road passes through, so
        // the sidebar renders the stretches in geographic order from
        // Lingoy Upper down to Lunas (Lunas is the terminus at the
        // Natonin side).
        barangays: [
          "lingoy-upper",
          "gawana",
          "fiangtin",
          "lias-silangan",
          "chupac",
          "lunas",
        ],
      },
    ],
  },
  {
    id: "r-1",
    subClass: "R-1",
    category: "residential",
    color: colorByClass["R-1"],
    marketValue2027: 1950,
    locationGroups: [
      {
        label:
          "Residential lots located along National Road (Barlig - Natonin Road), in sequence through Lingoy Upper, Gawana, Fiangtin, Lias Silangan, Chupac, and Lunas.",
        barangays: [
          "lingoy-upper",
          "gawana",
          "fiangtin",
          "lias-silangan",
          "chupac",
          "lunas",
        ],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: colorByClass["R-2"],
    marketValue2027: 1610,
    locationGroups: [
      {
        label:
          "Residential lots along Lingoy Upper Barangay Road, Bauman's Road (Gawana), and Fiangtin's Barangay Road.",
        // Sequence reordered so the sidebar lists Lingoy Upper first
        // (matching the National Road direction in C-1/R-1), then
        // Gawana and Fiangtin.
        barangays: ["lingoy-upper", "gawana", "fiangtin"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: colorByClass["R-3"],
    marketValue2027: 1320,
    locationGroups: [
      {
        label:
          "Residential lots along Lias Silangan Barangay Road, Chupac Barangay Road, and Lunas Barangay Road.",
        barangays: ["lias-silangan", "chupac", "lunas"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: colorByClass["R-4"],
    marketValue2027: 1090,
    locationGroups: [
      {
        label: "Residential lots within the inner part of Barangays Gawana and Fiangtin.",
        barangays: ["gawana", "fiangtin"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: colorByClass["R-5"],
    marketValue2027: 890,
    locationGroups: [
      {
        label:
          "Inner lots of Lias Silangan, Lias Kanluran, Macalana, Latang, Chupac, Lunas, and Upper Lingoy.",
        barangays: [
          "lias-silangan",
          "lias-kanluran",
          "macalana",
          "latang",
          "chupac",
          "lunas",
          "lingoy-upper",
        ],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: colorByClass["R-6"],
    marketValue2027: 700,
    locationGroups: [
      {
        label: "Residential lots located within Barangay Kaleo.",
        barangays: ["kaleo"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: colorByClass["R-7"],
    marketValue2027: 520,
    locationGroups: [
      {
        label: "Residential lots within Barangays Ogo-og and lower Lingoy.",
        barangays: ["ogo-og", "lingoy-lower"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: colorByClass["R-8"],
    marketValue2027: 410,
    locationGroups: [
      {
        label: "Residential lot located within Sitio Mog-ao of Lunas.",
        barangays: ["lunas-mog-ao"],
      },
    ],
  },
];

export const BARLIG_COMMERCIAL_CLASSIFICATIONS = BARLIG_CLASSIFICATIONS.filter(
  (classification) => classification.category === "commercial"
);
export const BARLIG_RESIDENTIAL_CLASSIFICATIONS = BARLIG_CLASSIFICATIONS.filter(
  (classification) => classification.category === "residential"
);

export function uniqueBarangaysForBarlig(classification) {
  return Array.from(
    new Set((classification?.locationGroups ?? []).flatMap((group) => group.barangays))
  );
}
