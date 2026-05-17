import {
  BAUKO_BARANGAYS,
  BAUKO_CLASSIFICATIONS,
  COMMERCIAL_CLASSIFICATIONS as BAUKO_COMMERCIAL,
  RESIDENTIAL_CLASSIFICATIONS as BAUKO_RESIDENTIAL,
  barangayBySlug as baukoBarangayBySlug,
  slugForName as baukoSlugForName,
  uniqueBarangaysFor as baukoUniqueBarangaysFor,
} from "./bauko";
import {
  BARLIG_BARANGAYS,
  BARLIG_CLASSIFICATIONS,
  BARLIG_COMMERCIAL_CLASSIFICATIONS as BARLIG_COMMERCIAL,
  BARLIG_RESIDENTIAL_CLASSIFICATIONS as BARLIG_RESIDENTIAL,
  barligBarangayBySlug,
  slugForBarligName,
  uniqueBarangaysForBarlig,
} from "./barlig";
import {
  TADIAN_BARANGAYS,
  TADIAN_CLASSIFICATIONS,
  TADIAN_COMMERCIAL_CLASSIFICATIONS as TADIAN_COMMERCIAL,
  TADIAN_RESIDENTIAL_CLASSIFICATIONS as TADIAN_RESIDENTIAL,
  tadianBarangayBySlug,
  slugForTadianName,
  uniqueBarangaysForTadian,
} from "./tadian";
import {
  SAGADA_BARANGAYS,
  SAGADA_CLASSIFICATIONS,
  SAGADA_COMMERCIAL_CLASSIFICATIONS as SAGADA_COMMERCIAL,
  SAGADA_RESIDENTIAL_CLASSIFICATIONS as SAGADA_RESIDENTIAL,
  sagadaBarangayBySlug,
  slugForSagadaName,
  uniqueBarangaysForSagada,
} from "./sagada";
import {
  BONTOC_BARANGAYS,
  BONTOC_CLASSIFICATIONS,
  BONTOC_COMMERCIAL_CLASSIFICATIONS as BONTOC_COMMERCIAL,
  BONTOC_RESIDENTIAL_CLASSIFICATIONS as BONTOC_RESIDENTIAL,
  bontocBarangayBySlug,
  slugForBontocName,
  uniqueBarangaysForBontoc,
} from "./bontoc";
import {
  SABANGAN_BARANGAYS,
  SABANGAN_CLASSIFICATIONS,
  SABANGAN_COMMERCIAL_CLASSIFICATIONS as SABANGAN_COMMERCIAL,
  SABANGAN_RESIDENTIAL_CLASSIFICATIONS as SABANGAN_RESIDENTIAL,
  sabanganBarangayBySlug,
  slugForSabanganName,
  uniqueBarangaysForSabangan,
} from "./sabangan";

const PROVINCE = "Mountain Province";

const BASE_MUNICIPALITIES = [
  { slug: "barlig", name: "Barlig" },
  { slug: "bauko", name: "Bauko" },
  // Parallel preview slug for the LGU DXF-derived Bauko zones. Same
  // barangays + schedule as Bauko, but reads from bauko_zones_dxf.geojson
  // so it doesn't trample the canonical bauko_zones.geojson everyone is
  // collaborating on. Visit via /?m=bauko-dxf.
  { slug: "bauko-dxf", name: "Bauko (DXF preview)" },
  { slug: "besao", name: "Besao" },
  { slug: "bontoc", name: "Bontoc" },
  // Parallel preview slug for the LGU DXF-derived Bontoc zones. Same
  // barangays + schedule as Bontoc, but reads from bontoc_zones_dxf.geojson
  // so it doesn't trample the auto-generated bontoc_zones.geojson while
  // we validate the DXF conversion. Visit via /?m=bontoc-dxf.
  { slug: "bontoc-dxf", name: "Bontoc (DXF preview)" },
  { slug: "natonin", name: "Natonin" },
  { slug: "paracelis", name: "Paracelis" },
  { slug: "sabangan", name: "Sabangan" },
  // Parallel preview slug for the (future) LGU DXF-derived Sabangan
  // zones. Same barangays + schedule as Sabangan, but reads from
  // sabangan_zones_dxf.geojson so it doesn't trample the canonical
  // sabangan_zones.geojson. Visit via /?m=sabangan-dxf.
  { slug: "sabangan-dxf", name: "Sabangan (DXF preview)" },
  { slug: "sadanga", name: "Sadanga" },
  { slug: "sagada", name: "Sagada" },
  // Sandbox view for previewing the LGU DXF-derived Sagada zones. Same
  // schedule + barangays as Sagada, but points at sagada_zones_dxf.geojson
  // so it doesn't touch the canonical sagada_zones.geojson everyone is
  // collaborating on. Visit via /?m=sagada-dxf.
  { slug: "sagada-dxf", name: "Sagada (DXF preview)" },
  { slug: "tadian", name: "Tadian" },
  // Parallel preview slug for the LGU DXF-derived Tadian zones (when
  // the .dwg eventually gets converted). Same schedule + barangays as
  // Tadian, points at tadian_zones_dxf.geojson so it doesn't trample
  // tadian_zones.geojson. Visit via /?m=tadian-dxf.
  { slug: "tadian-dxf", name: "Tadian (DXF preview)" },
];

const BAUKO_CONFIG = {
  slug: "bauko",
  name: "Bauko",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/bauko.geojson",
    barangays: "/data/bauko_barangays.geojson",
    barangaysCustom: "/data/bauko_barangays_custom.geojson",
    valuations: "/data/bauko_valuations.json",
    zones: "/data/bauko_zones.geojson",
    osmRoads: "/data/bauko_osm_roads.geojson",
    // Pre-computed distance bands (0-30m / 30-60m / 60+m) from the OSM
    // road network, used as a visual guide for the LGU's 30 m
    // depth-of-frontage rule when editing zones.
    frontageBands: "/data/bauko_frontage_bands.geojson",
    // Named landmarks (hospitals, schools, churches, govt buildings)
    // rendered on the top labels-pane so their names always sit above
    // SMV polygon fills. Fetched via `npm run landmarks:bauko`.
    landmarks: "/data/bauko_landmarks.geojson",
  },
  zones: {
    storageKey: "bauko-zones-v1",
    eventName: "bauko:zones-saved",
    exportFilename: "bauko_zones.geojson",
    saveSlug: "bauko",
    savePathLabel: "public/data/bauko_zones.geojson",
  },
  tiles: {
    offlineHintCommand: "npm run tiles:bauko",
  },
  ui: {
    outlineLabel: "Bauko outline",
  },
  schedule: {
    classifications: BAUKO_CLASSIFICATIONS,
    commercial: BAUKO_COMMERCIAL,
    residential: BAUKO_RESIDENTIAL,
    barangays: BAUKO_BARANGAYS,
    getBarangayBySlug: baukoBarangayBySlug,
    getUniqueBarangaysForClass: baukoUniqueBarangaysFor,
    slugForName: baukoSlugForName,
  },
};

const BARLIG_CONFIG = {
  slug: "barlig",
  name: "Barlig",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/barlig.geojson",
    barangays: "/data/barlig_barangays.geojson",
    // No QGIS-edited override yet — runtime falls back to the PSA file.
    valuations: "/data/barlig_valuations.json",
    zones: "/data/barlig_zones.geojson",
    osmRoads: "/data/barlig_osm_roads.geojson",
    frontageBands: "/data/barlig_frontage_bands.geojson",
  },
  zones: {
    storageKey: "barlig-zones-v1",
    eventName: "barlig:zones-saved",
    exportFilename: "barlig_zones.geojson",
    saveSlug: "barlig",
    savePathLabel: "public/data/barlig_zones.geojson",
  },
  tiles: {
    offlineHintCommand: "node scripts/download-tiles.mjs --bbox barlig --zooms 10-16",
  },
  ui: {
    outlineLabel: "Barlig outline",
  },
  schedule: {
    classifications: BARLIG_CLASSIFICATIONS,
    commercial: BARLIG_COMMERCIAL,
    residential: BARLIG_RESIDENTIAL,
    barangays: BARLIG_BARANGAYS,
    getBarangayBySlug: barligBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForBarlig,
    slugForName: slugForBarligName,
  },
};

const TADIAN_CONFIG = {
  slug: "tadian",
  name: "Tadian",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/tadian.geojson",
    barangays: "/data/tadian_barangays.geojson",
    valuations: "/data/tadian_valuations.json",
    zones: "/data/tadian_zones.geojson",
    osmRoads: "/data/tadian_osm_roads.geojson",
    // Pre-computed 0–30m / 30–60m frontage chips. Regenerate via
    // `npm run bands:tadian`.
    frontageBands: "/data/tadian_frontage_bands.geojson",
  },
  zones: {
    storageKey: "tadian-zones-v1",
    eventName: "tadian:zones-saved",
    exportFilename: "tadian_zones.geojson",
    saveSlug: "tadian",
    savePathLabel: "public/data/tadian_zones.geojson",
  },
  tiles: {
    offlineHintCommand: "node scripts/download-tiles.mjs --bbox tadian --zooms 10-16",
  },
  ui: {
    outlineLabel: "Tadian outline",
  },
  schedule: {
    classifications: TADIAN_CLASSIFICATIONS,
    commercial: TADIAN_COMMERCIAL,
    residential: TADIAN_RESIDENTIAL,
    barangays: TADIAN_BARANGAYS,
    getBarangayBySlug: tadianBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForTadian,
    slugForName: slugForTadianName,
  },
};

// Parallel preview view for the LGU DXF-derived Tadian zones. Mirrors
// SAGADA_DXF_CONFIG / BONTOC_DXF_CONFIG / BAUKO_DXF_CONFIG. The .dwg
// at /Users/rinar/Documents/LAND VALUE MAP/TADIAN LAND VALUE MAP.dwg
// needs to be exported to .dxf in AutoCAD (or LibreOffice) before the
// in-app "Import DXF…" button can populate this slug's zones file.
const TADIAN_DXF_CONFIG = {
  ...TADIAN_CONFIG,
  slug: "tadian-dxf",
  name: "Tadian (DXF preview)",
  dataFiles: {
    ...TADIAN_CONFIG.dataFiles,
    zones: "/data/tadian_zones_dxf.geojson",
  },
  zones: {
    storageKey: "tadian-dxf-zones-v1",
    eventName: "tadian-dxf:zones-saved",
    exportFilename: "tadian_zones_dxf.geojson",
    saveSlug: "tadian-dxf",
    savePathLabel: "public/data/tadian_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Tadian outline (DXF preview)",
  },
};

const SAGADA_CONFIG = {
  slug: "sagada",
  name: "Sagada",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/sagada.geojson",
    barangays: "/data/sagada_barangays.geojson",
    valuations: "/data/sagada_valuations.json",
    zones: "/data/sagada_zones.geojson",
    osmRoads: "/data/sagada_osm_roads.geojson",
    // Pre-computed 0–30m / 30–60m frontage bands. Chipped per OSM
    // road segment with the 4m road centerline carved out, so the
    // band chips render as donut rings and bake into corridor zones
    // that don't cover the road carriageway. Regenerate via
    // `npm run bands:sagada`.
    frontageBands: "/data/sagada_frontage_bands.geojson",
  },
  zones: {
    storageKey: "sagada-zones-v1",
    eventName: "sagada:zones-saved",
    exportFilename: "sagada_zones.geojson",
    saveSlug: "sagada",
    savePathLabel: "public/data/sagada_zones.geojson",
  },
  tiles: {
    offlineHintCommand: "node scripts/download-tiles.mjs --bbox sagada --zooms 10-16",
  },
  ui: {
    outlineLabel: "Sagada outline",
  },
  schedule: {
    classifications: SAGADA_CLASSIFICATIONS,
    commercial: SAGADA_COMMERCIAL,
    residential: SAGADA_RESIDENTIAL,
    barangays: SAGADA_BARANGAYS,
    getBarangayBySlug: sagadaBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForSagada,
    slugForName: slugForSagadaName,
  },
};

// Sandbox view: same Sagada schedule + barangays, but reads zones from
// the LGU's DXF-derived file. Lives in parallel to the main Sagada view
// so coworker edits on /?m=sagada don't collide with DXF preview work.
// Save to project for this slug writes to sagada_zones_dxf.geojson
// (whitelisted in app/api/zones/save/route.js).
const SAGADA_DXF_CONFIG = {
  ...SAGADA_CONFIG,
  slug: "sagada-dxf",
  name: "Sagada (DXF preview)",
  dataFiles: {
    ...SAGADA_CONFIG.dataFiles,
    zones: "/data/sagada_zones_dxf.geojson",
  },
  zones: {
    storageKey: "sagada-dxf-zones-v1",
    eventName: "sagada-dxf:zones-saved",
    exportFilename: "sagada_zones_dxf.geojson",
    saveSlug: "sagada-dxf",
    savePathLabel: "public/data/sagada_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Sagada outline (DXF preview)",
  },
};

const BONTOC_CONFIG = {
  slug: "bontoc",
  name: "Bontoc",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/bontoc.geojson",
    barangays: "/data/bontoc_barangays.geojson",
    valuations: "/data/bontoc_valuations.json",
    zones: "/data/bontoc_zones.geojson",
    osmRoads: "/data/bontoc_osm_roads.geojson",
    // Pre-computed 0–30m / 30–60m frontage chips along Bontoc's
    // all-weather roads. Regenerate via `npm run bands:bontoc`.
    frontageBands: "/data/bontoc_frontage_bands.geojson",
    // LGU-curated POIs that aren't well-mapped in OSM or visible on
    // Google's basemap tiles (e.g. Kalangeg Bldg). Edit by hand:
    // public/data/bontoc_custom_landmarks.geojson — each Feature is a
    // Point with {name, kind, barangay, notes} properties.
    customLandmarks: "/data/bontoc_custom_landmarks.geojson",
  },
  zones: {
    storageKey: "bontoc-zones-v1",
    eventName: "bontoc:zones-saved",
    exportFilename: "bontoc_zones.geojson",
    saveSlug: "bontoc",
    savePathLabel: "public/data/bontoc_zones.geojson",
  },
  tiles: {
    offlineHintCommand: "node scripts/download-tiles.mjs --bbox bontoc --zooms 10-16",
  },
  ui: {
    outlineLabel: "Bontoc outline",
  },
  schedule: {
    classifications: BONTOC_CLASSIFICATIONS,
    commercial: BONTOC_COMMERCIAL,
    residential: BONTOC_RESIDENTIAL,
    barangays: BONTOC_BARANGAYS,
    getBarangayBySlug: bontocBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForBontoc,
    slugForName: slugForBontocName,
  },
};

// Parallel preview view for the LGU DXF-derived Bauko zones. Same
// schedule + barangays as Bauko, just points at bauko_zones_dxf.geojson.
// Lets coworkers drop a fresh LGU DXF into /?m=bauko-dxf without
// trampling the canonical bauko_zones.geojson that the consultation
// app reads from.
const BAUKO_DXF_CONFIG = {
  ...BAUKO_CONFIG,
  slug: "bauko-dxf",
  name: "Bauko (DXF preview)",
  dataFiles: {
    ...BAUKO_CONFIG.dataFiles,
    zones: "/data/bauko_zones_dxf.geojson",
  },
  zones: {
    storageKey: "bauko-dxf-zones-v1",
    eventName: "bauko-dxf:zones-saved",
    exportFilename: "bauko_zones_dxf.geojson",
    saveSlug: "bauko-dxf",
    savePathLabel: "public/data/bauko_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Bauko outline (DXF preview)",
  },
};

// Parallel preview view for the LGU DXF-derived Bontoc zones. Same
// schedule + barangays as Bontoc, just points at bontoc_zones_dxf.geojson.
// Mirrors SAGADA_DXF_CONFIG.
const BONTOC_DXF_CONFIG = {
  ...BONTOC_CONFIG,
  slug: "bontoc-dxf",
  name: "Bontoc (DXF preview)",
  dataFiles: {
    ...BONTOC_CONFIG.dataFiles,
    zones: "/data/bontoc_zones_dxf.geojson",
  },
  zones: {
    storageKey: "bontoc-dxf-zones-v1",
    eventName: "bontoc-dxf:zones-saved",
    exportFilename: "bontoc_zones_dxf.geojson",
    saveSlug: "bontoc-dxf",
    savePathLabel: "public/data/bontoc_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Bontoc outline (DXF preview)",
  },
};

const SABANGAN_CONFIG = {
  slug: "sabangan",
  name: "Sabangan",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/sabangan.geojson",
    barangays: "/data/sabangan_barangays.geojson",
    valuations: "/data/sabangan_valuations.json",
    zones: "/data/sabangan_zones.geojson",
    // OSM-derived roads + auto-generated frontage bands aren't wired
    // yet for Sabangan. Generate them via:
    //   npm run osm:sabangan
    //   npm run bands:sabangan
    // and uncomment the lines below once the files exist.
    // osmRoads: "/data/sabangan_osm_roads.geojson",
    // frontageBands: "/data/sabangan_frontage_bands.geojson",
  },
  zones: {
    storageKey: "sabangan-zones-v1",
    eventName: "sabangan:zones-saved",
    exportFilename: "sabangan_zones.geojson",
    saveSlug: "sabangan",
    savePathLabel: "public/data/sabangan_zones.geojson",
  },
  tiles: {
    offlineHintCommand:
      "node scripts/download-tiles.mjs --bbox sabangan --zooms 10-16",
  },
  ui: {
    outlineLabel: "Sabangan outline",
  },
  schedule: {
    classifications: SABANGAN_CLASSIFICATIONS,
    commercial: SABANGAN_COMMERCIAL,
    residential: SABANGAN_RESIDENTIAL,
    barangays: SABANGAN_BARANGAYS,
    getBarangayBySlug: sabanganBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForSabangan,
    slugForName: slugForSabanganName,
  },
};

// Parallel preview view for the (future) LGU DXF-derived Sabangan
// zones. Mirrors TADIAN_DXF_CONFIG / SAGADA_DXF_CONFIG / BONTOC_DXF_CONFIG.
// Drop a Sabangan .dxf in /Users/rinar/Documents/LAND VALUE MAP/ and
// either run scripts/dxf-to-geojson.py against it, or use the in-app
// "Import DXF…" button on /?m=sabangan-dxf to populate this slug's
// zones file.
const SABANGAN_DXF_CONFIG = {
  ...SABANGAN_CONFIG,
  slug: "sabangan-dxf",
  name: "Sabangan (DXF preview)",
  dataFiles: {
    ...SABANGAN_CONFIG.dataFiles,
    zones: "/data/sabangan_zones_dxf.geojson",
  },
  zones: {
    storageKey: "sabangan-dxf-zones-v1",
    eventName: "sabangan-dxf:zones-saved",
    exportFilename: "sabangan_zones_dxf.geojson",
    saveSlug: "sabangan-dxf",
    savePathLabel: "public/data/sabangan_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Sabangan outline (DXF preview)",
  },
};

const CONFIG_BY_SLUG = {
  bauko: BAUKO_CONFIG,
  "bauko-dxf": BAUKO_DXF_CONFIG,
  barlig: BARLIG_CONFIG,
  tadian: TADIAN_CONFIG,
  "tadian-dxf": TADIAN_DXF_CONFIG,
  sagada: SAGADA_CONFIG,
  "sagada-dxf": SAGADA_DXF_CONFIG,
  bontoc: BONTOC_CONFIG,
  "bontoc-dxf": BONTOC_DXF_CONFIG,
  sabangan: SABANGAN_CONFIG,
  "sabangan-dxf": SABANGAN_DXF_CONFIG,
};

export const MUNICIPALITY_OPTIONS = BASE_MUNICIPALITIES.map((municipality) => ({
  ...municipality,
  enabled: Boolean(CONFIG_BY_SLUG[municipality.slug]?.enabled),
}));

export function getMunicipalityConfig(slug) {
  return CONFIG_BY_SLUG[slug] ?? BAUKO_CONFIG;
}
