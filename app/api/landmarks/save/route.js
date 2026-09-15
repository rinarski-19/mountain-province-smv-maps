// POST /api/landmarks/save?slug=<municipality>
//
// Persists the editor's custom landmarks to public/data/<slug>_custom_landmarks.geojson.
// Local development writes to disk; production commits through the same
// GitHub Contents API used by the zones save route.

import fs from "node:fs/promises";
import path from "node:path";
import { writeGuard } from "../../../../lib/server-auth.js";
import { commitToGithub } from "../../../../lib/save-backend.js";

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

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

export async function POST(request) {
  const denied = writeGuard(request);
  if (denied) return denied;

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
