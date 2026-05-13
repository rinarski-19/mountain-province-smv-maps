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

const PROVINCE = "Mountain Province";

const BASE_MUNICIPALITIES = [
  { slug: "barlig", name: "Barlig" },
  { slug: "bauko", name: "Bauko" },
  { slug: "besao", name: "Besao" },
  { slug: "bontoc", name: "Bontoc" },
  { slug: "natonin", name: "Natonin" },
  { slug: "paracelis", name: "Paracelis" },
  { slug: "sabangan", name: "Sabangan" },
  { slug: "sadanga", name: "Sadanga" },
  { slug: "sagada", name: "Sagada" },
  { slug: "tadian", name: "Tadian" },
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

const CONFIG_BY_SLUG = {
  bauko: BAUKO_CONFIG,
  barlig: BARLIG_CONFIG,
  tadian: TADIAN_CONFIG,
  sagada: SAGADA_CONFIG,
};

export const MUNICIPALITY_OPTIONS = BASE_MUNICIPALITIES.map((municipality) => ({
  ...municipality,
  enabled: Boolean(CONFIG_BY_SLUG[municipality.slug]?.enabled),
}));

export function getMunicipalityConfig(slug) {
  return CONFIG_BY_SLUG[slug] ?? BAUKO_CONFIG;
}
