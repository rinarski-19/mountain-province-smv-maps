// POST /api/zones/save?slug=<municipality>
//
// Accepts a GeoJSON FeatureCollection and persists it to
// public/data/<slug>_zones.geojson. Two backends, picked by environment:
//
//   - Local dev (NODE_ENV=development)
//       Writes directly to the working-tree file. The same path the
//       runtime reads from, so the change is visible on a hot reload.
//
//   - Production / preview (Vercel, etc.)
//       Commits the file to the configured GitHub repo via the GitHub
//       Contents API. The push triggers Vercel's git-deploy hook, the
//       site rebuilds in ~90s, and every browser refreshing sees the
//       new zones. Coworkers running locally can `git pull` to sync.
//
// Auth: all writes require an Authorization: Bearer <SAVE_PASSWORD>
// header that matches the SAVE_PASSWORD env var. Without this, anyone
// hitting the deployed URL could nuke the canonical zones file.

import fs from "node:fs/promises";
import path from "node:path";

const TARGETS_BY_SLUG = {
  bauko: "bauko_zones.geojson",
  "bauko-dxf": "bauko_zones_dxf.geojson",
  barlig: "barlig_zones.geojson",
  tadian: "tadian_zones.geojson",
  "tadian-dxf": "tadian_zones_dxf.geojson",
  sagada: "sagada_zones.geojson",
  "sagada-dxf": "sagada_zones_dxf.geojson",
  bontoc: "bontoc_zones.geojson",
  "bontoc-dxf": "bontoc_zones_dxf.geojson",
  sabangan: "sabangan_zones.geojson",
  "sabangan-dxf": "sabangan_zones_dxf.geojson",
  besao: "besao_zones.geojson",
  "besao-dxf": "besao_zones_dxf.geojson",
  sadanga: "sadanga_zones.geojson",
  "sadanga-dxf": "sadanga_zones_dxf.geojson",
  natonin: "natonin_zones.geojson",
  "natonin-dxf": "natonin_zones_dxf.geojson",
  paracelis: "paracelis_zones.geojson",
  "paracelis-dxf": "paracelis_zones_dxf.geojson",
};

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

function authorize(request) {
  const expected = process.env.SAVE_PASSWORD;
  // No password configured at all → dev mode behaves as before (anyone
  // on localhost can save). Prod requires it explicitly; the absence
  // is itself a 403 there, so a misconfigured deploy doesn't silently
  // open up writes.
  if (!expected) {
    return process.env.NODE_ENV === "development";
  }
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1] === expected;
}

export async function POST(request) {
  if (!authorize(request)) {
    return Response.json(
      { ok: false, error: "Unauthorized — set Authorization: Bearer <password>." },
      { status: 401 }
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

  const repoPath = `public/data/${fileName}`;
  const serialized = JSON.stringify(cleaned, null, 2) + "\n";

  // Local dev → write straight to the working tree.
  if (process.env.NODE_ENV === "development") {
    const target = path.join(process.cwd(), "public", "data", fileName);
    try {
      await fs.writeFile(target, serialized, "utf8");
    } catch (e) {
      return Response.json(
        { ok: false, error: `Could not write file: ${e.message}` },
        { status: 500 }
      );
    }
    return Response.json({
      ok: true,
      backend: "local-fs",
      path: repoPath,
      features: cleaned.features.length,
    });
  }

  // Production → commit to GitHub.
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) {
    return Response.json(
      {
        ok: false,
        error:
          "Production save not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars.",
      },
      { status: 503 }
    );
  }

  try {
    const result = await commitToGithub({
      token,
      owner,
      repo,
      branch,
      path: repoPath,
      content: serialized,
      message: `Update ${fileName} via /api/zones/save (${cleaned.features.length} features)`,
    });
    return Response.json({
      ok: true,
      backend: "github",
      path: repoPath,
      features: cleaned.features.length,
      commit: result.commitSha,
      url: result.htmlUrl,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: `GitHub commit failed: ${e.message}` },
      { status: 502 }
    );
  }
}

// Fetch the current SHA (so the API treats this as an update, not a
// create-if-missing), then PUT the new content with that SHA.
async function commitToGithub({ token, owner, repo, branch, path, content, message }) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mountain-province-smv-maps",
  };

  // Look up the existing file's SHA. 404 means "doesn't exist yet" —
  // that's fine, we just create it.
  let existingSha;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
    headers,
    cache: "no-store",
  });
  if (getRes.ok) {
    const meta = await getRes.json();
    existingSha = meta.sha;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    throw new Error(`GET ${path} returned ${getRes.status}: ${text}`);
  }

  // Base64-encode the new content (GitHub requires it).
  const encoded = Buffer.from(content, "utf8").toString("base64");

  const putBody = {
    message,
    content: encoded,
    branch,
  };
  if (existingSha) putBody.sha = existingSha;

  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify(putBody),
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`PUT ${path} returned ${putRes.status}: ${text}`);
  }
  const result = await putRes.json();
  return {
    commitSha: result.commit?.sha,
    htmlUrl: result.content?.html_url,
  };
}
