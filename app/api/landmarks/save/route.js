// POST /api/landmarks/save?slug=<municipality>
//
// Persists the editor's custom landmarks to public/data/<slug>_custom_landmarks.geojson.
// Local development writes to disk; production commits through the same
// GitHub Contents API used by the zones save route.

import fs from "node:fs/promises";
import path from "node:path";

const KNOWN_SLUGS = new Set([
  "bauko",
  "barlig",
  "besao",
  "bontoc",
  "natonin",
  "paracelis",
  "sabangan",
  "sadanga",
  "sagada",
  "tadian",
]);

function authorize(request) {
  const expected = process.env.SAVE_PASSWORD;
  if (!expected) return process.env.NODE_ENV === "development";
  const match = (request.headers.get("authorization") || "").match(
    /^Bearer\s+(.+)$/i
  );
  return Boolean(match && match[1] === expected);
}

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

export async function POST(request) {
  if (process.env.NEXT_PUBLIC_READ_ONLY === "true") {
    return Response.json({ ok: false, error: "Read-only deployment." }, { status: 403 });
  }
  if (!authorize(request)) {
    return Response.json({ ok: false, error: "Unauthorized — set Authorization: Bearer <password>." }, { status: 401 });
  }

  const slug = (new URL(request.url).searchParams.get("slug") || "").toLowerCase();
  if (!KNOWN_SLUGS.has(slug)) {
    return Response.json({ ok: false, error: `Unknown municipality slug: ${slug}` }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body is not valid JSON." }, { status: 400 });
  }
  if (!isFeatureCollection(body)) {
    return Response.json({ ok: false, error: "Expected a GeoJSON FeatureCollection." }, { status: 400 });
  }

  const cleaned = {
    type: "FeatureCollection",
    features: body.features
      .filter((feature) => feature?.geometry?.type === "Point")
      .map((feature) => ({
        type: "Feature",
        properties: feature.properties ?? {},
        geometry: feature.geometry,
      })),
  };
  const fileName = `${slug}_custom_landmarks.geojson`;
  const repoPath = `public/data/${fileName}`;
  const serialized = JSON.stringify(cleaned, null, 2) + "\n";

  if (process.env.NODE_ENV === "development") {
    try {
      await fs.writeFile(path.join(process.cwd(), "public", "data", fileName), serialized, "utf8");
    } catch (e) {
      return Response.json({ ok: false, error: `Could not write file: ${e.message}` }, { status: 500 });
    }
    return Response.json({ ok: true, backend: "local-fs", path: repoPath, features: cleaned.features.length });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) {
    return Response.json({ ok: false, error: "Production save not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars." }, { status: 503 });
  }

  try {
    const result = await commitToGithub({
      token,
      owner,
      repo,
      branch,
      path: repoPath,
      content: serialized,
      message: `Update ${fileName} via /api/landmarks/save (${cleaned.features.length} features)`,
    });
    return Response.json({ ok: true, backend: "github", path: repoPath, features: cleaned.features.length, commit: result.commitSha, url: result.htmlUrl });
  } catch (e) {
    return Response.json({ ok: false, error: `GitHub commit failed: ${e.message}` }, { status: 502 });
  }
}

async function commitToGithub({ token, owner, repo, branch, path: filePath, content, message }) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mountain-province-smv-maps",
  };
  let sha;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store" });
  if (getRes.ok) sha = (await getRes.json()).sha;
  else if (getRes.status !== 404) throw new Error(`GET ${filePath} returned ${getRes.status}: ${await getRes.text()}`);

  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) throw new Error(`PUT ${filePath} returned ${putRes.status}: ${await putRes.text()}`);
  const result = await putRes.json();
  return { commitSha: result.commit?.sha, htmlUrl: result.content?.html_url };
}
