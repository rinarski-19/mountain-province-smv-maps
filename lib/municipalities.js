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
import {
  BESAO_BARANGAYS,
  BESAO_CLASSIFICATIONS,
  BESAO_COMMERCIAL_CLASSIFICATIONS as BESAO_COMMERCIAL,
  BESAO_RESIDENTIAL_CLASSIFICATIONS as BESAO_RESIDENTIAL,
  besaoBarangayBySlug,
  slugForBesaoName,
  uniqueBarangaysForBesao,
} from "./besao";
import {
  SADANGA_BARANGAYS,
  SADANGA_CLASSIFICATIONS,
  SADANGA_COMMERCIAL_CLASSIFICATIONS as SADANGA_COMMERCIAL,
  SADANGA_RESIDENTIAL_CLASSIFICATIONS as SADANGA_RESIDENTIAL,
  sadangaBarangayBySlug,
  slugForSadangaName,
  uniqueBarangaysForSadanga,
} from "./sadanga";
import {
  NATONIN_BARANGAYS,
  NATONIN_CLASSIFICATIONS,
  NATONIN_COMMERCIAL_CLASSIFICATIONS as NATONIN_COMMERCIAL,
  NATONIN_RESIDENTIAL_CLASSIFICATIONS as NATONIN_RESIDENTIAL,
  natoninBarangayBySlug,
  slugForNatoninName,
  uniqueBarangaysForNatonin,
} from "./natonin";
import {
  PARACELIS_BARANGAYS,
  PARACELIS_CLASSIFICATIONS,
  PARACELIS_COMMERCIAL_CLASSIFICATIONS as PARACELIS_COMMERCIAL,
  PARACELIS_RESIDENTIAL_CLASSIFICATIONS as PARACELIS_RESIDENTIAL,
  paracelisBarangayBySlug,
  slugForParacelisName,
  uniqueBarangaysForParacelis,
} from "./paracelis";

const PROVINCE = "Mountain Province";

const BASE_MUNICIPALITIES = [
  { slug: "barlig", name: "Barlig" },
  { slug: "bauko", name: "Bauko" },
  // Separate Bauko profile for print-specific composition work. It
  // shares Bauko's official data files, but keeps its own saved views
  // and UI defaults so print experiments don't disturb the public map.
  { slug: "bauko-print", name: "Bauko (Print)" },
  { slug: "besao", name: "Besao" },
  // Parallel preview slug for the LGU DXF-derived Besao zones. Same
  // schedule + barangays as Besao, points at besao_zones_dxf.geojson.
  // Visit via /?m=besao-dxf.
  { slug: "besao-dxf", name: "Besao (DXF preview)" },
  { slug: "bontoc", name: "Bontoc" },
  // Parallel preview slug for the LGU DXF-derived Bontoc zones. Same
  // barangays + schedule as Bontoc, but reads from bontoc_zones_dxf.geojson
  // so it doesn't trample the auto-generated bontoc_zones.geojson while
  // we validate the DXF conversion. Visit via /?m=bontoc-dxf.
  { slug: "bontoc-dxf", name: "Bontoc (DXF preview)" },
  { slug: "natonin", name: "Natonin" },
  // Parallel preview slug for the (future) LGU DXF-derived Natonin
  // zones. Visit via /?m=natonin-dxf.
  { slug: "natonin-dxf", name: "Natonin (DXF preview)" },
  { slug: "paracelis", name: "Paracelis" },
  // Parallel preview slug for the (future) LGU DXF-derived Paracelis
  // zones. Visit via /?m=paracelis-dxf.
  { slug: "paracelis-dxf", name: "Paracelis (DXF preview)" },
  { slug: "sabangan", name: "Sabangan" },
  // Parallel preview slug for the (future) LGU DXF-derived Sabangan
  // zones. Same barangays + schedule as Sabangan, but reads from
  // sabangan_zones_dxf.geojson so it doesn't trample the canonical
  // sabangan_zones.geojson. Visit via /?m=sabangan-dxf.
  { slug: "sabangan-dxf", name: "Sabangan (DXF preview)" },
  { slug: "sadanga", name: "Sadanga" },
  // Parallel preview slug for the (future) LGU DXF-derived Sadanga
  // zones. Same schedule as Sadanga, points at
  // sadanga_zones_dxf.geojson. Visit via /?m=sadanga-dxf.
  { slug: "sadanga-dxf", name: "Sadanga (DXF preview)" },
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

const BAUKO_PRINT_CONFIG = {
  ...BAUKO_CONFIG,
  slug: "bauko-print",
  name: "Bauko (Print)",
  // Keep all authoritative map data shared with Bauko. Saved camera
  // views are keyed by this profile slug in app/page.js, so print
  // composition can evolve separately from the consultation view.
  dataFiles: {
    ...BAUKO_CONFIG.dataFiles,
  },
  zones: {
    ...BAUKO_CONFIG.zones,
    // Editing in the print profile still writes to the canonical Bauko
    // zones file. This profile is for layout/view customization, not a
    // fork of the SMV geometry.
    saveSlug: "bauko",
  },
  tiles: {
    ...BAUKO_CONFIG.tiles,
    // Editor uses the same OSM-vector basemap the print SVG renders
    // (water / buildings / roads with tier-based colors / place
    // labels). WYSIWYG: what's on screen here is what the printed
    // page will show.
    defaultTileMode: "vector_basemap",
  },
  map: {
    ...(BAUKO_CONFIG.map ?? {}),
    defaultZoom: 12,
  },
  ui: {
    ...BAUKO_CONFIG.ui,
    outlineLabel: "Bauko outline (print)",
    printProfile: true,
    viewSlug: "bauko",
    wholeMapPrint: true,
    minPrintZoom: 12,
    wholeMapPrintZoom: 14,
    defaultFrontageBands: false,
    hideMapLabels: true,
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
// SAGADA_DXF_CONFIG / BONTOC_DXF_CONFIG. The .dwg
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
    osmRoads: "/data/sabangan_osm_roads.geojson",
    // Pre-computed 0-30m / 30-60m frontage chips. Regenerate via
    // `npm run bands:sabangan` (requires roads:fetch:sabangan first).
    frontageBands: "/data/sabangan_frontage_bands.geojson",
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

const BESAO_CONFIG = {
  slug: "besao",
  name: "Besao",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/besao.geojson",
    barangays: "/data/besao_barangays.geojson",
    valuations: "/data/besao_valuations.json",
    zones: "/data/besao_zones.geojson",
    osmRoads: "/data/besao_osm_roads.geojson",
    // Pre-computed 0-30m / 30-60m frontage chips. Regenerate via
    // `npm run bands:besao` (requires roads:fetch:besao first).
    frontageBands: "/data/besao_frontage_bands.geojson",
  },
  zones: {
    storageKey: "besao-zones-v1",
    eventName: "besao:zones-saved",
    exportFilename: "besao_zones.geojson",
    saveSlug: "besao",
    savePathLabel: "public/data/besao_zones.geojson",
  },
  tiles: {
    offlineHintCommand:
      "node scripts/download-tiles.mjs --bbox besao --zooms 10-16",
  },
  ui: {
    outlineLabel: "Besao outline",
  },
  schedule: {
    classifications: BESAO_CLASSIFICATIONS,
    commercial: BESAO_COMMERCIAL,
    residential: BESAO_RESIDENTIAL,
    barangays: BESAO_BARANGAYS,
    getBarangayBySlug: besaoBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForBesao,
    slugForName: slugForBesaoName,
  },
};

const SADANGA_CONFIG = {
  slug: "sadanga",
  name: "Sadanga",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/sadanga.geojson",
    barangays: "/data/sadanga_barangays.geojson",
    valuations: "/data/sadanga_valuations.json",
    zones: "/data/sadanga_zones.geojson",
    osmRoads: "/data/sadanga_osm_roads.geojson",
    frontageBands: "/data/sadanga_frontage_bands.geojson",
    // Sadanga is the first municipality with a per-building override
    // mode. The OSM buildings file is fetched by
    // `npm run buildings:fetch:sadanga` (see scripts/) and rendered
    // as a clickable layer when the editor's "Per-building override"
    // toggle is on. Other LGUs don't reference this key, so they
    // skip the buildings layer entirely.
    osmBuildings: "/data/sadanga_osm_buildings.geojson",
  },
  zones: {
    storageKey: "sadanga-zones-v1",
    eventName: "sadanga:zones-saved",
    exportFilename: "sadanga_zones.geojson",
    saveSlug: "sadanga",
    savePathLabel: "public/data/sadanga_zones.geojson",
  },
  tiles: {
    offlineHintCommand:
      "node scripts/download-tiles.mjs --bbox sadanga --zooms 10-16",
    // Sadanga used to default to Google Streets for per-building
    // verification, but the project moved to OSM as the universal
    // default. PAO staff doing per-building work can flip to Google
    // Satellite or Hybrid manually via the gear-icon tile picker.
  },
  ui: {
    outlineLabel: "Sadanga outline",
  },
  schedule: {
    classifications: SADANGA_CLASSIFICATIONS,
    commercial: SADANGA_COMMERCIAL,
    residential: SADANGA_RESIDENTIAL,
    barangays: SADANGA_BARANGAYS,
    getBarangayBySlug: sadangaBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForSadanga,
    slugForName: slugForSadangaName,
  },
};

const NATONIN_CONFIG = {
  slug: "natonin",
  name: "Natonin",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/natonin.geojson",
    barangays: "/data/natonin_barangays.geojson",
    valuations: "/data/natonin_valuations.json",
    zones: "/data/natonin_zones.geojson",
    osmRoads: "/data/natonin_osm_roads.geojson",
    frontageBands: "/data/natonin_frontage_bands.geojson",
  },
  zones: {
    storageKey: "natonin-zones-v1",
    eventName: "natonin:zones-saved",
    exportFilename: "natonin_zones.geojson",
    saveSlug: "natonin",
    savePathLabel: "public/data/natonin_zones.geojson",
  },
  tiles: {
    offlineHintCommand:
      "node scripts/download-tiles.mjs --bbox natonin --zooms 10-16",
  },
  ui: {
    outlineLabel: "Natonin outline",
  },
  schedule: {
    classifications: NATONIN_CLASSIFICATIONS,
    commercial: NATONIN_COMMERCIAL,
    residential: NATONIN_RESIDENTIAL,
    barangays: NATONIN_BARANGAYS,
    getBarangayBySlug: natoninBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForNatonin,
    slugForName: slugForNatoninName,
  },
};

const PARACELIS_CONFIG = {
  slug: "paracelis",
  name: "Paracelis",
  province: PROVINCE,
  enabled: true,
  dataFiles: {
    outline: "/data/paracelis.geojson",
    barangays: "/data/paracelis_barangays.geojson",
    valuations: "/data/paracelis_valuations.json",
    zones: "/data/paracelis_zones.geojson",
    osmRoads: "/data/paracelis_osm_roads.geojson",
    frontageBands: "/data/paracelis_frontage_bands.geojson",
  },
  zones: {
    storageKey: "paracelis-zones-v1",
    eventName: "paracelis:zones-saved",
    exportFilename: "paracelis_zones.geojson",
    saveSlug: "paracelis",
    savePathLabel: "public/data/paracelis_zones.geojson",
  },
  tiles: {
    offlineHintCommand:
      "node scripts/download-tiles.mjs --bbox paracelis --zooms 10-16",
  },
  ui: {
    outlineLabel: "Paracelis outline",
  },
  schedule: {
    classifications: PARACELIS_CLASSIFICATIONS,
    commercial: PARACELIS_COMMERCIAL,
    residential: PARACELIS_RESIDENTIAL,
    barangays: PARACELIS_BARANGAYS,
    getBarangayBySlug: paracelisBarangayBySlug,
    getUniqueBarangaysForClass: uniqueBarangaysForParacelis,
    slugForName: slugForParacelisName,
  },
};

const PARACELIS_DXF_CONFIG = {
  ...PARACELIS_CONFIG,
  slug: "paracelis-dxf",
  name: "Paracelis (DXF preview)",
  dataFiles: {
    ...PARACELIS_CONFIG.dataFiles,
    zones: "/data/paracelis_zones_dxf.geojson",
  },
  zones: {
    storageKey: "paracelis-dxf-zones-v1",
    eventName: "paracelis-dxf:zones-saved",
    exportFilename: "paracelis_zones_dxf.geojson",
    saveSlug: "paracelis-dxf",
    savePathLabel: "public/data/paracelis_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Paracelis outline (DXF preview)",
  },
};

const NATONIN_DXF_CONFIG = {
  ...NATONIN_CONFIG,
  slug: "natonin-dxf",
  name: "Natonin (DXF preview)",
  dataFiles: {
    ...NATONIN_CONFIG.dataFiles,
    zones: "/data/natonin_zones_dxf.geojson",
  },
  zones: {
    storageKey: "natonin-dxf-zones-v1",
    eventName: "natonin-dxf:zones-saved",
    exportFilename: "natonin_zones_dxf.geojson",
    saveSlug: "natonin-dxf",
    savePathLabel: "public/data/natonin_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Natonin outline (DXF preview)",
  },
};

const SADANGA_DXF_CONFIG = {
  ...SADANGA_CONFIG,
  slug: "sadanga-dxf",
  name: "Sadanga (DXF preview)",
  dataFiles: {
    ...SADANGA_CONFIG.dataFiles,
    zones: "/data/sadanga_zones_dxf.geojson",
  },
  zones: {
    storageKey: "sadanga-dxf-zones-v1",
    eventName: "sadanga-dxf:zones-saved",
    exportFilename: "sadanga_zones_dxf.geojson",
    saveSlug: "sadanga-dxf",
    savePathLabel: "public/data/sadanga_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Sadanga outline (DXF preview)",
  },
};

// Parallel preview view for the (future) LGU DXF-derived Besao zones.
// Mirrors TADIAN_DXF_CONFIG / SAGADA_DXF_CONFIG / etc.
const BESAO_DXF_CONFIG = {
  ...BESAO_CONFIG,
  slug: "besao-dxf",
  name: "Besao (DXF preview)",
  dataFiles: {
    ...BESAO_CONFIG.dataFiles,
    zones: "/data/besao_zones_dxf.geojson",
  },
  zones: {
    storageKey: "besao-dxf-zones-v1",
    eventName: "besao-dxf:zones-saved",
    exportFilename: "besao_zones_dxf.geojson",
    saveSlug: "besao-dxf",
    savePathLabel: "public/data/besao_zones_dxf.geojson",
  },
  ui: {
    outlineLabel: "Besao outline (DXF preview)",
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
  "bauko-print": BAUKO_PRINT_CONFIG,
  barlig: BARLIG_CONFIG,
  tadian: TADIAN_CONFIG,
  "tadian-dxf": TADIAN_DXF_CONFIG,
  sagada: SAGADA_CONFIG,
  "sagada-dxf": SAGADA_DXF_CONFIG,
  bontoc: BONTOC_CONFIG,
  "bontoc-dxf": BONTOC_DXF_CONFIG,
  sabangan: SABANGAN_CONFIG,
  "sabangan-dxf": SABANGAN_DXF_CONFIG,
  besao: BESAO_CONFIG,
  "besao-dxf": BESAO_DXF_CONFIG,
  sadanga: SADANGA_CONFIG,
  "sadanga-dxf": SADANGA_DXF_CONFIG,
  natonin: NATONIN_CONFIG,
  "natonin-dxf": NATONIN_DXF_CONFIG,
  paracelis: PARACELIS_CONFIG,
  "paracelis-dxf": PARACELIS_DXF_CONFIG,
};

// Slugs that match this pattern are hidden from the LGU picker menu
// but remain accessible by URL (/?m=<slug>) for ad-hoc previews. The
// DXF preview variants were useful while validating CAD imports but
// aren't part of the operating workflow anymore. The `hidden` flag is
// what menu components filter on; URL routing still finds the option
// in MUNICIPALITY_OPTIONS via slug lookup.
const HIDDEN_FROM_MENU_PATTERNS = [/-dxf$/i];

export const MUNICIPALITY_OPTIONS = BASE_MUNICIPALITIES.map((municipality) => ({
  ...municipality,
  enabled: Boolean(CONFIG_BY_SLUG[municipality.slug]?.enabled),
  hidden: HIDDEN_FROM_MENU_PATTERNS.some((re) => re.test(municipality.slug)),
}));

export function getMunicipalityConfig(slug) {
  return CONFIG_BY_SLUG[slug] ?? BAUKO_CONFIG;
}
