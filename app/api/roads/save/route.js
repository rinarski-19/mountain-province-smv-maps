// POST /api/roads/save?slug=<municipality>
//
// Appends one manually traced barangay road to a print-only road collection.
// The source OSM network is never modified, and these roads are consumed only
// by the editor while drawing and by the A3 SVG print builder.

import fs from "node:fs/promises";
import path from "node:path";

const BASE_SLUGS = new Set([
  "bauko",
  "barlig",
  "tadian",
  "sagada",
  "bontoc",
  "sabangan",
  "besao",
  "sadanga",
  "natonin",
  "paracelis",
]);

function baseSlug(value) {
  return String(value || "bauko")
    .toLowerCase()
    .replace(/-(?:dxf|print|hybrid)$/, "");
}

function authorize(request) {
  const expected = process.env.SAVE_PASSWORD;
  if (!expected) return process.env.NODE_ENV === "development";
  const match = (request.headers.get("authorization") || "").match(
    /^Bearer\s+(.+)$/i
  );
  return Boolean(match && match[1] === expected);
}

function cleanRoad(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !["LineString", "MultiLineString"].includes(geometry.type)) {
    return null;
  }
  const properties = feature?.properties || {};
  const manualId = String(
    properties.manual_id || `manual-road-${Date.now()}`
  ).slice(0, 120);
  return {
    type: "Feature",
    properties: {
      manual_id: manualId,
      osm_way_id: manualId,
      highway: "residential",
      name: properties.name ? String(properties.name).slice(0, 160) : null,
      barangay_slug: properties.barangay_slug
        ? String(properties.barangay_slug).slice(0, 120)
        : null,
      barangay_name: properties.barangay_name
        ? String(properties.barangay_name).slice(0, 160)
        : null,
      length_m: Number.isFinite(Number(properties.length_m))
        ? Math.round(Number(properties.length_m))
        : null,
      source: "manual-print",
    },
    geometry,
  };
}

function appendRoad(collection, road) {
  const features = Array.isArray(collection?.features)
    ? collection.features.filter((feature) => feature?.type === "Feature")
    : [];
  const duplicateIndex = features.findIndex(
    (feature) =>
      feature?.properties?.manual_id === road.properties.manual_id
  );
  if (duplicateIndex >= 0) features[duplicateIndex] = road;
  else features.push(road);
  return { type: "FeatureCollection", features };
}

function removeRoad(collection, manualId) {
  const features = Array.isArray(collection?.features)
    ? collection.features.filter((feature) => feature?.type === "Feature")
    : [];
  const nextFeatures = features.filter(
    (feature) => String(feature?.properties?.manual_id || "") !== manualId
  );
  return {
    collection: { type: "FeatureCollection", features: nextFeatures },
    removed: features.length - nextFeatures.length,
  };
}

export async function POST(request) {
  if (!authorize(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const slug = baseSlug(new URL(request.url).searchParams.get("slug"));
  if (!BASE_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

  let road;
  try {
    road = cleanRoad(await request.json());
  } catch {
    road = null;
  }
  if (!road) {
    return Response.json(
      { ok: false, error: "Expected a GeoJSON LineString road feature." },
      { status: 400 }
    );
  }

  const fileName = `${slug}_print_roads.geojson`;
  const repoPath = `public/data/${fileName}`;

  if (process.env.NODE_ENV === "development") {
    const target = path.join(process.cwd(), "public", "data", fileName);
    let current = { type: "FeatureCollection", features: [] };
    try {
      current = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return Response.json(
          { ok: false, error: `Could not read road file: ${error.message}` },
          { status: 500 }
        );
      }
    }
    const next = appendRoad(current, road);
    await fs.writeFile(target, JSON.stringify(next) + "\n", "utf8");
    return Response.json({
      ok: true,
      backend: "local-fs",
      path: repoPath,
      feature: road,
      features: next.features.length,
    });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) {
    return Response.json(
      { ok: false, error: "Production road save is not configured." },
      { status: 503 }
    );
  }

  try {
    const result = await appendRoadOnGithub({
      token,
      owner,
      repo,
      branch,
      repoPath,
      road,
    });
    return Response.json({
      ok: true,
      backend: "github",
      path: repoPath,
      feature: road,
      features: result.features,
      commit: result.commit,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: `GitHub commit failed: ${error.message}` },
      { status: 502 }
    );
  }
}

export async function DELETE(request) {
  if (!authorize(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const slug = baseSlug(url.searchParams.get("slug"));
  const manualId = String(url.searchParams.get("id") || "").slice(0, 120);
  if (!BASE_SLUGS.has(slug) || !manualId) {
    return Response.json(
      { ok: false, error: "A valid municipality and manual road id are required." },
      { status: 400 }
    );
  }

  const fileName = `${slug}_print_roads.geojson`;
  const repoPath = `public/data/${fileName}`;

  if (process.env.NODE_ENV === "development") {
    const target = path.join(process.cwd(), "public", "data", fileName);
    let current = { type: "FeatureCollection", features: [] };
    try {
      current = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return Response.json(
          { ok: false, error: `Could not read road file: ${error.message}` },
          { status: 500 }
        );
      }
    }
    const next = removeRoad(current, manualId);
    if (!next.removed) {
      return Response.json(
        { ok: false, error: "Print road was not found." },
        { status: 404 }
      );
    }
    await fs.writeFile(target, JSON.stringify(next.collection) + "\n", "utf8");
    return Response.json({
      ok: true,
      backend: "local-fs",
      path: repoPath,
      removed: next.removed,
      features: next.collection.features.length,
    });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) {
    return Response.json(
      { ok: false, error: "Production road save is not configured." },
      { status: 503 }
    );
  }

  try {
    const result = await removeRoadOnGithub({
      token,
      owner,
      repo,
      branch,
      repoPath,
      manualId,
    });
    return Response.json({ ok: true, backend: "github", path: repoPath, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: `GitHub commit failed: ${error.message}` },
      { status: 502 }
    );
  }
}

async function appendRoadOnGithub({
  token,
  owner,
  repo,
  branch,
  repoPath,
  road,
}) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mountain-province-smv-maps",
  };
  const getResponse = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
    headers,
    cache: "no-store",
  });
  let sha;
  let current = { type: "FeatureCollection", features: [] };
  if (getResponse.ok) {
    const existing = await getResponse.json();
    sha = existing.sha;
    current = JSON.parse(
      Buffer.from(String(existing.content || "").replace(/\n/g, ""), "base64").toString(
        "utf8"
      )
    );
  } else if (getResponse.status !== 404) {
    throw new Error(`Could not read existing road file (HTTP ${getResponse.status}).`);
  }

  const next = appendRoad(current, road);
  const payload = {
    message: `Add barangay road to ${path.basename(repoPath)}`,
    content: Buffer.from(JSON.stringify(next) + "\n", "utf8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };
  const putResponse = await fetch(base, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!putResponse.ok) {
    throw new Error(`Could not write road file (HTTP ${putResponse.status}).`);
  }
  const saved = await putResponse.json();
  return { features: next.features.length, commit: saved.commit?.sha ?? null };
}

async function removeRoadOnGithub({
  token,
  owner,
  repo,
  branch,
  repoPath,
  manualId,
}) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mountain-province-smv-maps",
  };
  const getResponse = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
    headers,
    cache: "no-store",
  });
  if (!getResponse.ok) {
    throw new Error(`Could not read existing road file (HTTP ${getResponse.status}).`);
  }
  const existing = await getResponse.json();
  const current = JSON.parse(
    Buffer.from(String(existing.content || "").replace(/\n/g, ""), "base64").toString(
      "utf8"
    )
  );
  const next = removeRoad(current, manualId);
  if (!next.removed) throw new Error("Print road was not found.");

  const putResponse = await fetch(base, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Delete barangay road from ${path.basename(repoPath)}`,
      content: Buffer.from(
        JSON.stringify(next.collection) + "\n",
        "utf8"
      ).toString("base64"),
      branch,
      sha: existing.sha,
    }),
  });
  if (!putResponse.ok) {
    throw new Error(`Could not write road file (HTTP ${putResponse.status}).`);
  }
  const saved = await putResponse.json();
  return {
    removed: next.removed,
    features: next.collection.features.length,
    commit: saved.commit?.sha ?? null,
  };
}
