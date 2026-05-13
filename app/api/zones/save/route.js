// POST /api/zones/save
// Accepts a GeoJSON FeatureCollection and writes it to
// public/data/bauko_zones.geojson, replacing the existing file.
//
// SAFETY: this endpoint only runs in development. Production builds (or
// `next start`) refuse to write — exposing arbitrary file writes on a
// public deployment would be reckless. If you ever publish the app, the
// "Save to project" button silently no-ops on the client because this
// route returns 403.

import fs from "node:fs/promises";
import path from "node:path";

const TARGETS_BY_SLUG = {
  bauko: "bauko_zones.geojson",
  barlig: "barlig_zones.geojson",
  tadian: "tadian_zones.geojson",
  sagada: "sagada_zones.geojson",
};

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

export async function POST(request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { ok: false, error: "Save endpoint disabled outside development." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("slug") || "bauko").toLowerCase();
  const fileName = TARGETS_BY_SLUG[slug];
  if (!fileName) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }
  const target = path.join(process.cwd(), "public", "data", fileName);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json(
      { ok: false, error: "Body is not valid JSON." },
      { status: 400 }
    );
  }

  if (!isFeatureCollection(body)) {
    return Response.json(
      {
        ok: false,
        error:
          "Expected a GeoJSON FeatureCollection (`{ type, features: [] }`).",
      },
      { status: 400 }
    );
  }

  // Strip non-spec fields the editor might attach (Leaflet sometimes adds
  // numeric ids that break GADM / QGIS roundtripping).
  const cleaned = {
    type: "FeatureCollection",
    features: body.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    })),
  };

  try {
    await fs.writeFile(target, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
  } catch (e) {
    return Response.json(
      { ok: false, error: `Could not write file: ${e.message}` },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    path: `public/data/${fileName}`,
    features: cleaned.features.length,
  });
}
