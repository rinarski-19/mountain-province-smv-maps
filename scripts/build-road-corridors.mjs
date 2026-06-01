#!/usr/bin/env node
// Auto-generate SMV road-corridor zones from OpenStreetMap, classified
// by *which barangay* each road segment falls in.
//
// Why barangay-aware: SMV schedules don't say "all primary roads are
// C-1"; they say "C-1 = along Provincial and National Roads of Abatan"
// (only Abatan), "C-2 = National Road of Mabaay/Sinto/Sadsadan/Poblacion"
// (only those four), etc. The same physical OSM `highway=primary` road
// could be C-1 in Abatan, C-2 in Mabaay, or C-3 in some other barangay.
// This script reads the actual schedule from lib/<m>.js, inverts it
// into a per-barangay lookup, and classifies each OSM way accordingly.
//
// It also emits the parallel residential class for each commercial
// corridor when the schedule has both (e.g. R-1 alongside C-1) — both
// polygons share the same geometry.
//
// Pipeline:
//   1. Load lib/<m>.js to get the schedule + slugForName resolver.
//   2. Invert: barangay slug → [{ subClass, category, tier }] where
//      tier is "primary" (national/provincial) or "any" (all-weather
//      and barangay roads). Inner-lot groups are skipped.
//   3. Fetch barangay polygons from public/data/<m>_barangays.geojson.
//   4. Overpass: every drivable `highway=*` way inside the bbox.
//   5. For each way:
//        - Drop if shorter than MIN_WAY_LENGTH_M (filters driveways).
//        - Find barangay containing its midpoint.
//        - Look up the (barangay, OSM tier) → subClass(es).
//        - Buffer the line by per-class half-width, push into each
//          matching class bucket.
//   6. Union per class, clip to outline, write *_zones_auto.geojson.
//
// Usage:
//   node scripts/build-road-corridors.mjs bauko
//   node scripts/build-road-corridors.mjs barlig
//   node scripts/build-road-corridors.mjs tadian
//   node scripts/build-road-corridors.mjs sagada

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "bauko-leaflet-app/1.0 (road-corridor builder; one-off LGU consultation use)";

// Per-municipality wiring. The lib module exports the inversion
// material we need: the classifications array and the slug resolver.
const MUNICIPALITY_CONFIG = {
  bauko: {
    module: "../lib/bauko.js",
    classificationsExport: "BAUKO_CLASSIFICATIONS",
    slugFnExport: "slugForName",
  },
  barlig: {
    module: "../lib/barlig.js",
    classificationsExport: "BARLIG_CLASSIFICATIONS",
    slugFnExport: "slugForBarligName",
  },
  tadian: {
    module: "../lib/tadian.js",
    classificationsExport: "TADIAN_CLASSIFICATIONS",
    slugFnExport: "slugForTadianName",
  },
  sagada: {
    module: "../lib/sagada.js",
    classificationsExport: "SAGADA_CLASSIFICATIONS",
    slugFnExport: "slugForSagadaName",
  },
  bontoc: {
    module: "../lib/bontoc.js",
    classificationsExport: "BONTOC_CLASSIFICATIONS",
    slugFnExport: "slugForBontocName",
  },
  sabangan: {
    module: "../lib/sabangan.js",
    classificationsExport: "SABANGAN_CLASSIFICATIONS",
    slugFnExport: "slugForSabanganName",
  },
  besao: {
    module: "../lib/besao.js",
    classificationsExport: "BESAO_CLASSIFICATIONS",
    slugFnExport: "slugForBesaoName",
  },
  sadanga: {
    module: "../lib/sadanga.js",
    classificationsExport: "SADANGA_CLASSIFICATIONS",
    slugFnExport: "slugForSadangaName",
  },
  natonin: {
    module: "../lib/natonin.js",
    classificationsExport: "NATONIN_CLASSIFICATIONS",
    slugFnExport: "slugForNatoninName",
  },
  paracelis: {
    module: "../lib/paracelis.js",
    classificationsExport: "PARACELIS_CLASSIFICATIONS",
    slugFnExport: "slugForParacelisName",
  },
};

// OSM highway-tag → schedule tier kind.
//   "primary" matches Provincial/National corridors.
//   "any" matches all-weather/barangay corridors (the catch-all tier).
// PH OSM tags Provincial as "secondary" sometimes, so we treat
// secondary as primary-tier too.
const OSM_TIER_KIND = {
  trunk: "primary",
  primary: "primary",
  secondary: "primary",
  tertiary: "any",
  unclassified: "any",
  residential: "any",
  track: "any",
};

// Buffer half-widths in meters. Higher tiers get wider strips. Used as
// a fallback when a class isn't in HALF_WIDTH_BY_CLASS.
const DEFAULT_HALF_WIDTH_M = 10;
const HALF_WIDTH_BY_CLASS = {
  "C-1": 15, "C-2": 12, "C-3": 10, "C-4": 8,
  "R-1": 15, "R-2": 12, "R-3": 10, "R-4": 8, "R-5": 8,
  "R-6": 7, "R-7": 7, "R-8": 6,
};

// OSM tags lots of driveways/dead-end stubs as `highway=residential`.
// Drop anything below this length so the auto output doesn't pick up
// 20 m garage spurs. Adjust if a municipality has real barangay roads
// shorter than this.
const MIN_WAY_LENGTH_M = 40;

// Carriageway half-width to subtract from the corridor so the polygon
// renders as two parallel ribbons along the road instead of one strip
// over the road. Matches ROAD_INSET_METERS in components/EditableZones.js.
const ROAD_INSET_M = 4;

async function main() {
  const slug = (process.argv[2] || "").toLowerCase();
  const cfg = MUNICIPALITY_CONFIG[slug];
  if (!cfg) {
    console.error(
      `Unknown municipality slug: ${slug || "(missing)"}\n` +
        `Known: ${Object.keys(MUNICIPALITY_CONFIG).join(", ")}`
    );
    process.exit(1);
  }

  const lib = await import(cfg.module);
  const classifications = lib[cfg.classificationsExport];
  const slugForName = lib[cfg.slugFnExport];
  if (!Array.isArray(classifications) || typeof slugForName !== "function") {
    throw new Error(
      `lib module ${cfg.module} missing ${cfg.classificationsExport} or ${cfg.slugFnExport}.`
    );
  }

  const corridorByBarangay = invertSchedule(classifications);
  const totalCorridorBarangays = corridorByBarangay.size;
  console.log(
    `Schedule: ${classifications.length} classes, ${totalCorridorBarangays} barangays with corridor classes.`
  );

  const outlinePath = path.join(PUBLIC_DATA, `${slug}.geojson`);
  if (!fs.existsSync(outlinePath)) {
    console.error(
      `Missing ${outlinePath}.\nRun \`npm run boundaries:fetch:${slug}\` first.`
    );
    process.exit(1);
  }
  const outlineFeature = JSON.parse(fs.readFileSync(outlinePath, "utf8"))
    .features?.[0];
  if (!outlineFeature?.geometry) {
    throw new Error(`Outline ${outlinePath} has no usable geometry.`);
  }

  const barangaysPath = path.join(PUBLIC_DATA, `${slug}_barangays.geojson`);
  if (!fs.existsSync(barangaysPath)) {
    console.error(`Missing ${barangaysPath}.`);
    process.exit(1);
  }
  const barangaysFC = JSON.parse(fs.readFileSync(barangaysPath, "utf8"));

  // Pre-resolve slug for each barangay polygon so we don't re-run the
  // resolver for every OSM way.
  const barangaysWithSlugs = barangaysFC.features
    .map((feat) => {
      const name = feat.properties?.name;
      const slugForFeature = name ? slugForName(name) : null;
      return slugForFeature ? { feature: feat, slug: slugForFeature } : null;
    })
    .filter(Boolean);
  console.log(
    `Loaded ${barangaysWithSlugs.length}/${barangaysFC.features.length} barangay polygons with resolvable slugs.`
  );

  const [west, south, east, north] = turf.bbox(outlineFeature);
  console.log(
    `bbox: W=${west.toFixed(4)} S=${south.toFixed(4)} E=${east.toFixed(4)} N=${north.toFixed(4)}`
  );

  // Overpass: every drivable way in the bbox. We classify per-way after.
  const overpassQuery = `
    [out:json][timeout:60];
    (
      way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|track)$"](${south},${west},${north},${east});
    );
    out geom;
  `.trim();

  console.log("Querying Overpass…");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "data=" + encodeURIComponent(overpassQuery),
  });
  if (!res.ok) {
    throw new Error(`Overpass returned ${res.status} ${res.statusText}`);
  }
  const overpass = await res.json();
  const ways = (overpass.elements || []).filter(
    (el) => el.type === "way" && Array.isArray(el.geometry)
  );
  console.log(`Got ${ways.length} ways from Overpass.`);

  // Classify each way and bucket its buffer by SMV class.
  const buffersByClass = new Map();
  let skippedShort = 0;
  let skippedOutside = 0;
  let skippedUnclassed = 0;

  for (const way of ways) {
    const highway = way.tags?.highway;
    const osmKind = OSM_TIER_KIND[highway];
    if (!osmKind) {
      skippedUnclassed++;
      continue;
    }
    const coords = way.geometry.map((p) => [p.lon, p.lat]);
    if (coords.length < 2) {
      skippedShort++;
      continue;
    }
    let line;
    try {
      line = turf.lineString(coords);
    } catch {
      skippedShort++;
      continue;
    }
    const lengthM = turf.length(line, { units: "meters" });
    if (lengthM < MIN_WAY_LENGTH_M) {
      skippedShort++;
      continue;
    }

    // Find barangay via midpoint of the way. Using midpoint over end
    // points handles roads that briefly cross a neighbour barangay.
    const midpoint = turf.along(line, lengthM / 2 / 1000, { units: "kilometers" });
    const containing = barangaysWithSlugs.find((b) =>
      turf.booleanPointInPolygon(midpoint, b.feature)
    );
    if (!containing) {
      skippedOutside++;
      continue;
    }

    const candidates = corridorByBarangay.get(containing.slug);
    if (!candidates?.length) {
      skippedUnclassed++;
      continue;
    }

    // Match candidates by tier. If the OSM tier is "primary" and there
    // are both "primary" and "any" candidates for this barangay, prefer
    // primary (the schedule is more specific there). Otherwise emit
    // every matching candidate so commercial AND residential parallels
    // both get drawn.
    let matches = candidates.filter((c) => {
      if (c.tier === "primary") return osmKind === "primary";
      return true; // "any" matches any OSM tier
    });
    if (osmKind === "primary") {
      const primaryOnly = matches.filter((c) => c.tier === "primary");
      if (primaryOnly.length) matches = primaryOnly;
    } else {
      matches = matches.filter((c) => c.tier === "any");
    }
    if (!matches.length) {
      skippedUnclassed++;
      continue;
    }

    for (const match of matches) {
      const halfWidth = HALF_WIDTH_BY_CLASS[match.subClass] ?? DEFAULT_HALF_WIDTH_M;
      let buf;
      try {
        buf = bufferAlongsideRoad(line, halfWidth);
      } catch {
        continue;
      }
      if (!buf?.geometry) continue;
      if (!buffersByClass.has(match.subClass)) {
        buffersByClass.set(match.subClass, []);
      }
      buffersByClass.get(match.subClass).push(buf);
    }
  }

  const bucketSummary = [...buffersByClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v.length}`)
    .join(", ");
  console.log(
    `Buffered: ${bucketSummary || "none"} (skipped ${skippedShort} short, ${skippedOutside} outside-barangays, ${skippedUnclassed} no-class)`
  );

  // Union per class, clip to outline.
  const outFeatures = [];
  for (const [cls, bufs] of buffersByClass) {
    if (!bufs.length) continue;
    const merged = robustUnion(bufs, cls);
    if (!merged?.geometry) continue;

    let clipped = merged;
    try {
      const intersection = turf.intersect(
        turf.featureCollection([merged, outlineFeature])
      );
      if (intersection?.geometry) clipped = intersection;
    } catch (e) {
      console.warn(`Clip failed for ${cls}: ${e.message}. Keeping unclipped.`);
    }

    outFeatures.push({
      type: "Feature",
      properties: {
        classification: cls,
        source: "osm-auto",
        municipality: slug,
        generated_at: new Date().toISOString(),
        half_width_m: HALF_WIDTH_BY_CLASS[cls] ?? DEFAULT_HALF_WIDTH_M,
      },
      geometry: clipped.geometry,
    });
  }

  const outPath = path.join(PUBLIC_DATA, `${slug}_zones_auto.geojson`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ type: "FeatureCollection", features: outFeatures }) + "\n"
  );
  console.log(
    `Wrote ${outPath} (${outFeatures.length} corridor polygon${
      outFeatures.length === 1 ? "" : "s"
    })`
  );
  console.log(
    `\nClasses produced: ${outFeatures.map((f) => f.properties.classification).join(", ") || "(none)"}`
  );
}

// Parse a location-group label into corridor metadata. Returns null
// for inner-lot-only groups (those don't get auto-drawn — they would
// be the whole barangay minus the corridors, which the editor handles
// separately).
function classifyLabel(label) {
  if (!label) return null;
  const l = label.toLowerCase();

  // Inner-lots-only labels: skip.
  if (/^\s*(?:residential )?inner\b/.test(l) && !l.includes("along")) {
    return null;
  }

  // Highest-tier corridor: provincial/national roads.
  if (l.includes("provincial") && l.includes("national")) {
    return { tier: "primary" };
  }
  if (/\bnational road\b/.test(l)) {
    return { tier: "primary" };
  }

  // Generic corridor: all-weather, barangay roads, anything else
  // tagged with "along". For municipalities like Sagada/Barlig where
  // "all-weather" effectively means "any drivable road in this
  // barangay", "any" tier is the right match.
  if (
    l.includes("all-weather") ||
    l.includes("all weather") ||
    l.includes("barangay road") ||
    l.includes("barangay roads") ||
    l.includes("bauman's road") ||
    /\balong\b/.test(l)
  ) {
    return { tier: "any" };
  }

  // Unknown: treat as inner-only to be safe.
  return null;
}

function invertSchedule(classifications) {
  // barangay slug → [{ subClass, category, tier }]
  const out = new Map();
  for (const cls of classifications) {
    for (const group of cls.locationGroups || []) {
      const parsed = classifyLabel(group.label);
      if (!parsed) continue;
      for (const slug of group.barangays || []) {
        if (!out.has(slug)) out.set(slug, []);
        out.get(slug).push({
          subClass: cls.subClass,
          category: cls.category,
          tier: parsed.tier,
        });
      }
    }
  }
  return out;
}

// Pairwise tree-reduce union with pre-cleaning. Same approach as
// before — turf.union on many overlapping buffers is prone to
// topology errors; clean each input, try bulk, fall back to a
// balanced binary tree.
function robustUnion(bufs, cls) {
  if (bufs.length === 1) return bufs[0];

  const cleaned = bufs
    .map((b) => {
      try {
        const cc = turf.cleanCoords(b);
        return turf.simplify(cc, { tolerance: 0.00001, highQuality: false });
      } catch {
        return b;
      }
    })
    .filter((b) => b?.geometry);

  try {
    const u = turf.union(turf.featureCollection(cleaned));
    if (u?.geometry) return u;
  } catch {
    // Fall through.
  }

  console.warn(
    `Union for ${cls}: bulk failed, tree-reducing ${cleaned.length} inputs.`
  );
  return treeUnion(cleaned, cls);
}

// Flat-capped buffer of a (Multi)LineString. Same trick as the in-app
// version in components/EditableZones.js: turf.buffer always produces
// rounded end caps (the jsts CAP_FLAT option isn't exposed), so we
// instead lineOffset by ±r and stitch the two parallels into a single
// closed polygon with perpendicular caps at each end.
function flatCapBuffer(input, halfWidthM) {
  if (!input) return null;
  // Accept either a Feature wrapper or a raw geometry. turf.lineString /
  // turf.multiLineString return Features.
  const geom = input.type === "Feature" ? input.geometry : input;
  if (!geom) return null;
  const lines =
    geom.type === "MultiLineString"
      ? geom.coordinates
      : geom.type === "LineString"
        ? [geom.coordinates]
        : null;
  if (!lines || lines.length === 0) return null;

  const polys = [];
  for (const coords of lines) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    let polyForSegment = null;
    let leftRing;
    let rightRing;
    try {
      const ls = turf.lineString(coords);
      leftRing = turf.lineOffset(ls, halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
      rightRing = turf.lineOffset(ls, -halfWidthM, { units: "meters" })
        ?.geometry?.coordinates;
    } catch {}
    if (leftRing?.length && rightRing?.length) {
      const ring = [
        ...leftRing,
        ...rightRing.slice().reverse(),
        leftRing[0],
      ];
      try {
        const raw = turf.polygon([ring]);
        const rawArea = turf.area(raw);
        // See in-app comment in components/EditableZones.js — on very
        // curvy roads buffer(0) shaves one side; we detect that via
        // area loss (≥ 1%) and fall back to a rounded-cap buffer below.
        const cleaned = turf.buffer(raw, 0, { units: "meters" });
        if (cleaned && turf.area(cleaned) >= rawArea * 0.99) {
          polyForSegment = cleaned;
        }
      } catch {}
    }
    if (!polyForSegment) {
      try {
        const ls = turf.lineString(coords);
        const rounded = turf.buffer(ls, halfWidthM, { units: "meters" });
        if (rounded?.geometry) polyForSegment = rounded;
      } catch {}
    }
    if (polyForSegment) polys.push(polyForSegment);
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  try {
    return turf.union(turf.featureCollection(polys));
  } catch {
    return polys[0];
  }
}

// Buffer a line into a corridor with the road centerline cut out, so
// each segment renders as two parallel ribbons with flat (butt) end
// caps. Matches the click-to-tag and pencil flows in
// components/EditableZones.js.
function bufferAlongsideRoad(geom, outerHalfWidthM) {
  const outer = flatCapBuffer(geom, outerHalfWidthM);
  if (!outer?.geometry) return null;
  if (ROAD_INSET_M <= 0 || outerHalfWidthM <= ROAD_INSET_M + 1) return outer;
  const inner = flatCapBuffer(geom, ROAD_INSET_M);
  if (!inner?.geometry) return outer;
  try {
    const diff = turf.difference(turf.featureCollection([outer, inner]));
    if (diff?.geometry) return diff;
  } catch {
    // Difference can throw on tangent geometry; outer is a safe fallback.
  }
  return outer;
}

function treeUnion(items, cls) {
  if (items.length === 1) return items[0];
  const mid = items.length >> 1;
  const left = treeUnion(items.slice(0, mid), cls);
  const right = treeUnion(items.slice(mid), cls);
  try {
    const u = turf.union(turf.featureCollection([left, right]));
    if (u?.geometry) return u;
  } catch {
    // Swallow — return left subtree so we at least keep half.
  }
  return left;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
