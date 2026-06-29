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

// Hierarchical SMV table — OFFICIAL Bauko 2027 schedule, transcribed
// from "Bauko GR FORM No. 1.docx" (Office of the Provincial Assessor,
// April 24, 2025 order). Replaces the earlier draft.
//
// 3 commercial classes (C-1..C-3) + 7 residential classes (R-1..R-7).
// New tiers R-6 (₱1,680) and R-7 (₱1,330) added. All values shifted
// down vs the earlier draft (e.g. C-1 6,240 → 5,170).
//
// The PDF lists very specific corridors/sitios per barangay for each
// class. Here we only enumerate the *barangays* that have any
// polygon in each class — full location text lives in
// public/data/bauko_valuations.json. Use the chip palette to pick a
// class, then draw the polygon along the specific corridor/sitio the
// PDF describes.
export const BAUKO_CLASSIFICATIONS = [
  {
    id: "c-1",
    subClass: "C-1",
    category: "commercial",
    color: color("C-1"),
    marketValue2027: 5170,
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
    marketValue2027: 4210,
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
    marketValue2027: 3140,
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
    marketValue2027: 5170,
    locationGroups: [
      {
        label:
          "Abatan: Junction → Mr. Cue Building → Tadian; Junction → Mr. Palpal building beside Christ the King Church → Bontoc; Junction → Mr. Golocan house → Caguimongan",
        barangays: ["abatan"],
      },
      {
        label: "Mabaay: Junction to Caltex",
        barangays: ["mabaay"],
      },
    ],
  },
  {
    id: "r-2",
    subClass: "R-2",
    category: "residential",
    color: color("R-2"),
    marketValue2027: 4210,
    locationGroups: [
      {
        label:
          "Abatan: Mr. Cue → Jomar Hardware (Malupa); Mr. Golocan house → Tabatab waitingshed (Baguio direction); Mr. Palpal → Abatan/Poblacion boundary (Bontoc direction)",
        barangays: ["abatan"],
      },
      {
        label:
          "Guinzadan Central: Pek-as → Tongtongbawi. Guinzadan Sur: Tontongbawi → Pesnadan",
        barangays: ["guinzadan-central", "guinzadan-sur"],
      },
      {
        label:
          "Mabaay: Junction → Odidiyan; Junction → Welcome Arc (Sabangan direction)",
        barangays: ["mabaay"],
      },
      {
        label: "Monamon Sur: Boga",
        barangays: ["monamon-sur"],
      },
      {
        label: "Sadsadan: Karatula → Junction (Balicanao direction)",
        barangays: ["sadsadan"],
      },
      {
        label: "Sinto: along National Road",
        barangays: ["sinto"],
      },
    ],
  },
  {
    id: "r-3",
    subClass: "R-3",
    category: "residential",
    color: color("R-3"),
    marketValue2027: 3140,
    locationGroups: [
      {
        label:
          "Abatan: Tabatab Waiting shed → Guinzadan Central boundary; Mr. Daytaca Hardware (Malupa) → Bauko/Tadian boundary; Junction → Kiwangen",
        barangays: ["abatan"],
      },
      {
        label: "Banao: Andanum → MPSPC. Bila: Pak-as → Napu",
        barangays: ["banao", "bila"],
      },
      {
        label:
          "Guinzadan Central: Abatan boundary → Pek-as. Guinzadan Sur: Pesnadan → Tapapan boundary",
        barangays: ["guinzadan-central", "guinzadan-sur"],
      },
      {
        label: "Mabaay: Caltex → Sadsadan/Mabaay boundary",
        barangays: ["mabaay"],
      },
      {
        label:
          "Monamon Sur: Mt. Data cliff → Loreta Benos house; Natonglob → Monamon Proper; sitio Lukib",
        barangays: ["monamon-sur"],
      },
      {
        label: "Mount Data: all lots along the National Road",
        barangays: ["mount-data"],
      },
      {
        label: "Otucan Sur: Kisop Bridge → Pak-as",
        barangays: ["otucan-sur"],
      },
      {
        label: "Poblacion: all lots along National Road",
        barangays: ["poblacion"],
      },
      {
        label:
          "Sadsadan: Mabaay boundary → Karatula. Sinto: road going to Mankayan",
        barangays: ["sadsadan", "sinto"],
      },
    ],
  },
  {
    id: "r-4",
    subClass: "R-4",
    category: "residential",
    color: color("R-4"),
    marketValue2027: 2330,
    locationGroups: [
      {
        label:
          "Abatan: all lots not described in higher tiers",
        barangays: ["abatan"],
      },
      {
        label:
          "Banao: MPSPC → Banao School; Junction (Mr. Isican) → Guinzadan Norte boundary",
        barangays: ["banao"],
      },
      {
        label: "Bila: Napu → Otucan Norte boundary + all other lots",
        barangays: ["bila"],
      },
      {
        label:
          "Guinzadan Central: sitio Lalasi → bridge + all other lots. Guinzadan Norte: bridge → sitio Lingayo. Guinzadan Sur: all other lots",
        barangays: ["guinzadan-central", "guinzadan-norte", "guinzadan-sur"],
      },
      {
        label:
          "Leseb: Tapapan boundary → Lawlawitan; Lawlawitan → Mabaay boundary",
        barangays: ["leseb"],
      },
      {
        label: "Mabaay: Welcome Arc → Sabangan boundary. Mayag: Kiwangen → Doling",
        barangays: ["mabaay", "mayag"],
      },
      {
        label: "Monamon Norte: sitio Bansa",
        barangays: ["monamon-norte"],
      },
      {
        label:
          "Monamon Sur: Benos house → sitio Binaka; Little Hill → Guisguisaan; sitio Pactil. Mount Data: all other lots not described",
        barangays: ["monamon-sur", "mount-data"],
      },
      {
        label:
          "Otucan Sur: Kapayawan Bridge → Dawaic bridge + Kapayawan lots",
        barangays: ["otucan-sur"],
      },
      {
        label:
          "Poblacion: along Municipal Road from Municipal Hall + all other lots not described",
        barangays: ["poblacion"],
      },
      {
        label:
          "Sadsadan: Junction (Balicanao direction) → Monamon Sur boundary (National Road)",
        barangays: ["sadsadan"],
      },
      {
        label: "Sinto: all other lots not mentioned",
        barangays: ["sinto"],
      },
      {
        label:
          "Tapapan: Guinzadan Sur boundary → Junction (Lebao direction)",
        barangays: ["tapapan"],
      },
    ],
  },
  {
    id: "r-5",
    subClass: "R-5",
    category: "residential",
    color: color("R-5"),
    marketValue2027: 1950,
    locationGroups: [
      {
        label:
          "Banao: Banao school → Lagawa boundary + all other lots. Guinzadan Norte: Lingayo → Banao boundary",
        barangays: ["banao", "guinzadan-norte"],
      },
      {
        label: "Lagawa: all other lots not described",
        barangays: ["lagawa"],
      },
      {
        label: "Mabaay: sitio Banata → sitio Deppas. Mayag: Doling → Mayag",
        barangays: ["mabaay", "mayag"],
      },
      {
        label:
          "Monamon Norte: sitio Tamog-o + sitio Suyo. Monamon Sur: sitio Binaka → sitio Suyo; sitio Pactil → sitio Sil-ac → Guisguisaan; sitio Taptapoc",
        barangays: ["monamon-norte", "monamon-sur"],
      },
      {
        label: "Otucan Sur: all other lots not described",
        barangays: ["otucan-sur"],
      },
      {
        label:
          "Sadsadan: sitio Mabilig + Longon. Tapapan: Junction (Lebao) → Leseb boundary + Tapapan Diversion Road",
        barangays: ["sadsadan", "tapapan"],
      },
    ],
  },
  {
    id: "r-6",
    subClass: "R-6",
    category: "residential",
    color: color("R-6"),
    marketValue2027: 1680,
    locationGroups: [
      {
        label:
          "Lagawa: Banao boundary → turning point near Mr. Banaken house. Mabaay: sitio Deppas → sitio Gao-gao",
        barangays: ["lagawa", "mabaay"],
      },
      {
        label: "Mayag: all other lots not described",
        barangays: ["mayag"],
      },
      {
        label:
          "Monamon Norte: sitio Suyo → Tipunan. Monamon Sur: sitio Sengyew + Asbiagan",
        barangays: ["monamon-norte", "monamon-sur"],
      },
      {
        label: "Sadsadan: sitio Cuba. Tapapan: Letang",
        barangays: ["sadsadan", "tapapan"],
      },
    ],
  },
  {
    id: "r-7",
    subClass: "R-7",
    category: "residential",
    color: color("R-7"),
    marketValue2027: 1330,
    locationGroups: [
      {
        label:
          "Lagawa: turning point → Adadogan/Lao-ingan; turning point → 1 km toward Coputan",
        barangays: ["lagawa"],
      },
      {
        label:
          "Leseb: Lawlawitan → Leseb Elementary School + all other lots not described",
        barangays: ["leseb"],
      },
      {
        label:
          "Mabaay: sitio Gao-gao → sitio Beas + all other lots not described",
        barangays: ["mabaay"],
      },
      {
        label:
          "Monamon Norte: Tipunan → sitio Pitpitan; sitio Nabilngan → sitio Pangao + all other lots",
        barangays: ["monamon-norte"],
      },
      {
        label: "Otucan Norte: all lots",
        barangays: ["otucan-norte"],
      },
      {
        label:
          "Otucan Sur: Pak-as → Kapayawan Bridge (Bontoc direction)",
        barangays: ["otucan-sur"],
      },
      {
        label: "Sadsadan: sitio Bato + Sumey-ang",
        barangays: ["sadsadan"],
      },
    ],
  },
  {
    id: "r-8",
    subClass: "R-8",
    category: "residential",
    color: color("R-8"),
    marketValue2027: 1080,
    locationGroups: [
      {
        label:
          "Bagnen Oriente: 200 m below the school → steps going up to Mt. Polis",
        barangays: ["bagnen-oriente"],
      },
      {
        label: "Lagawa: 1 km → turning point to Coputan",
        barangays: ["lagawa"],
      },
      {
        label: "Monamon Sur: sitio Dodoan. Sadsadan: sitio Balicanao",
        barangays: ["monamon-sur", "sadsadan"],
      },
    ],
  },
  {
    id: "r-9",
    subClass: "R-9",
    category: "residential",
    color: color("R-9"),
    marketValue2027: 850,
    locationGroups: [
      {
        label:
          "Bagnen Oriente: Sabangan boundary → 200 m below the school; Mt. Polis steps → Bagnen Proper boundary",
        barangays: ["bagnen-oriente"],
      },
      {
        label:
          "Bagnen Proper: 200 m below the school → Junction",
        barangays: ["bagnen-proper"],
      },
      {
        label: "Lagawa: all other lots not described",
        barangays: ["lagawa"],
      },
      {
        label:
          "Monamon Sur: sitio Bebe + all other lots not described",
        barangays: ["monamon-sur"],
      },
      {
        label:
          "Sadsadan: sitio Am-am + sitio Salin + all other lots not mentioned",
        barangays: ["sadsadan"],
      },
    ],
  },
  {
    id: "r-10",
    subClass: "R-10",
    category: "residential",
    color: color("R-10"),
    marketValue2027: 650,
    locationGroups: [
      {
        label: "Bagnen Oriente: all lots not described in higher tiers",
        barangays: ["bagnen-oriente"],
      },
      {
        label:
          "Bagnen Proper: Bagnen Oriente boundary → 200 m below the school; Junction → 300 m on Abatan-Bagnen Road; 300 m → Poblacion (Bauko) boundary; Junction → Balintaugan boundary; all other lots not described",
        barangays: ["bagnen-proper"],
      },
    ],
  },
  {
    id: "r-11",
    subClass: "R-11",
    category: "residential",
    color: color("R-11"),
    marketValue2027: 530,
    locationGroups: [
      {
        label: "Balintaugan: all residential lots",
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
