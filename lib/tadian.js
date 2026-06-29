// Hierarchical SMV schedule data for Tadian — OFFICIAL 2027 schedule
// transcribed from "GR FORM No 1 & 5- TADIAN.docx" (Office of the
// Provincial Assessor, GR Form No. 1). Replaces the earlier 3C+6R draft.
//
// 12 commercial classes (C-1..C-12) + 12 residential classes
// (R-1..R-12). C-N and R-N share the same ₱ value for every tier in
// Tadian, so the schedule reads as a single 12-step ladder applied
// to either commercial or residential use.
//
// Standard depth: 30 m (1st strip) for both residential and commercial.
// Corner influence: 10 % for both.

import { colorForClass } from "./classifications.js";

// Per-class color resolver that honors LGU_LOCAL_COLOR_OVERRIDES for
// tadian: every R-N that shares a ₱ value with the matching C-N
// inherits the C-N color so the tier reads as a single visual band.
const color = (klass) => colorForClass(klass, "tadian");

// 19 PSA-confirmed Tadian barangays. Slugs are lowercase hyphenated;
// Cadad-anan keeps its hyphen as part of the canonical name.
export const TADIAN_BARANGAYS = [
  { slug: "balaoa", name: "Balaoa", digitized: false },
  { slug: "banaao", name: "Banaao", digitized: false },
  { slug: "bantey", name: "Bantey", digitized: false },
  { slug: "batayan", name: "Batayan", digitized: false },
  { slug: "bunga", name: "Bunga", digitized: false },
  { slug: "cadad-anan", name: "Cadad-anan", digitized: false },
  { slug: "cagubatan", name: "Cagubatan", digitized: false },
  { slug: "dacudac", name: "Dacudac", digitized: false },
  { slug: "duagan", name: "Duagan", digitized: false },
  { slug: "kayan-east", name: "Kayan East", digitized: false },
  { slug: "kayan-west", name: "Kayan West", digitized: false },
  { slug: "lenga", name: "Lenga", digitized: false },
  { slug: "lubon", name: "Lubon", digitized: false },
  { slug: "mabalite", name: "Mabalite", digitized: false },
  { slug: "masla", name: "Masla", digitized: false },
  { slug: "pandayan", name: "Pandayan", digitized: false },
  { slug: "poblacion", name: "Poblacion", digitized: false },
  { slug: "sumadel", name: "Sumadel", digitized: false },
  { slug: "tue", name: "Tue", digitized: false },
];

const slugByName = new Map(
  TADIAN_BARANGAYS.map((b) => [b.name.toLowerCase(), b.slug])
);

export function slugForTadianName(name) {
  if (!name) return null;
  const stripped = String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return slugByName.get(stripped) ?? null;
}

export function tadianBarangayBySlug(slug) {
  return TADIAN_BARANGAYS.find((b) => b.slug === slug) ?? null;
}

// Helper: build a (subClass, value, label, barangays) pair for both
// commercial and residential — since Tadian's C-N and R-N share value
// and location per tier, we just emit both rows from one source.
function tier(subNum, value, label, barangays) {
  return [
    {
      id: `c-${subNum}`,
      subClass: `C-${subNum}`,
      category: "commercial",
      color: color(`C-${subNum}`),
      marketValue2027: value,
      locationGroups: [{ label: `Commercial lots — ${label}`, barangays }],
    },
    {
      id: `r-${subNum}`,
      subClass: `R-${subNum}`,
      category: "residential",
      color: color(`R-${subNum}`),
      marketValue2027: value,
      locationGroups: [{ label: `Residential lots — ${label}`, barangays }],
    },
  ];
}

// Per-tier descriptions follow the GR Form No. 1 paragraphs verbatim.
// `c-` and `r-` entries share the location text — only the category
// keyword differs.
const T1 = tier(
  1,
  5100,
  "Along National and Provincial roads of sitio Ol-is and TSAT to Tadian Central School; Bebe to Kawayan; Sagang barangay road; and along Lt. Marrero Street to Back Street of Poblacion.",
  ["poblacion"]
);
const T2 = tier(
  2,
  4500,
  "Along inner roads of sitio Katapag to Supang, Kenkentaan to Kakading of Poblacion.",
  ["poblacion"]
);
const T3 = tier(
  3,
  3900,
  "Along National road of sitio Dogodog and sitio Babalaan of Poblacion.",
  ["poblacion"]
);
const T4 = tier(
  4,
  3400,
  "Along the National road of sitio Ampaong to Cabunagan to Malupa; Kayan East and Kayan West.",
  ["poblacion", "kayan-east", "kayan-west"]
);
const T5 = tier(
  5,
  2900,
  "Along National and Provincial road of sitio Agadangan (Kayan West) to Namontocan (Bunga).",
  ["kayan-west", "bunga"]
);
const T6 = tier(
  6,
  2400,
  "Along the Provincial roads of Lubon (including New Lubon) and Masla; inner roads of Kayan East and Kayan West.",
  ["lubon", "masla", "kayan-east", "kayan-west"]
);
const T7 = tier(
  7,
  2000,
  "Along inner road of Masla (Asseban to Lontog), along National Road of Cagubatan and Pandayan, and sitio Am-am of Cadad-anan.",
  ["masla", "cagubatan", "pandayan", "cadad-anan"]
);
const T8 = tier(
  8,
  1600,
  "Along National & Provincial roads of Balaoa, Tue, Sumadel, Batayan, Lenga, Dacudac; and along inner roads of Cagubatan and Balaoa.",
  ["balaoa", "tue", "sumadel", "batayan", "lenga", "dacudac", "cagubatan"]
);
const T9 = tier(
  9,
  1100,
  "Along inner roads of Lenga, Dacudac, Tue, and Bunga.",
  ["lenga", "dacudac", "tue", "bunga"]
);
const T10 = tier(
  10,
  800,
  "Along all-weather roads of Cadad-anan, Banaao, and Bantey.",
  ["cadad-anan", "banaao", "bantey"]
);
const T11 = tier(
  11,
  600,
  "Along all-weather road of Mabalite.",
  ["mabalite"]
);
const T12 = tier(
  12,
  400,
  "Along all-weather roads of Duagan; sitio Maket-an (Bantey); sitio Ilang (Batayan); sitio Pasnadan and Madange (Dacudac).",
  ["duagan", "bantey", "batayan", "dacudac"]
);

// Flatten commercial first, then residential — matches how the other
// LGU modules order their classifications so the editor's chip palette
// groups commercial and residential together.
export const TADIAN_CLASSIFICATIONS = [
  T1[0], T2[0], T3[0], T4[0], T5[0], T6[0],
  T7[0], T8[0], T9[0], T10[0], T11[0], T12[0],
  T1[1], T2[1], T3[1], T4[1], T5[1], T6[1],
  T7[1], T8[1], T9[1], T10[1], T11[1], T12[1],
];

export const TADIAN_COMMERCIAL_CLASSIFICATIONS = TADIAN_CLASSIFICATIONS.filter(
  (classification) => classification.category === "commercial"
);
export const TADIAN_RESIDENTIAL_CLASSIFICATIONS = TADIAN_CLASSIFICATIONS.filter(
  (classification) => classification.category === "residential"
);

export function uniqueBarangaysForTadian(classification) {
  return Array.from(
    new Set((classification?.locationGroups ?? []).flatMap((group) => group.barangays))
  );
}
