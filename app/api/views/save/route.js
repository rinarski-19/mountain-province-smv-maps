// POST /api/views/save?slug=<municipality>
//
// Accepts a saved-views payload and persists it to
// public/data/<slug>_saved_views.json. Mirrors /api/zones/save's
// behaviour so the static export (out/) carries the views the
// author set, not whatever happens to be in the next browser's
// localStorage.
//
// Payload shape:
//   {
//     "barangays": { "<barangaySlug>": { lat, lng, zoom } },
//     "stretches": { "<classId>|<barangaySlug>|<stretchIdx>": { lat, lng, zoom } }
//   }
//
// Two backends, picked by environment, same as /api/zones/save:
//   - Local dev: writes straight to the working tree
//   - Production: commits the file via the GitHub Contents API
//
// Auth: requires Authorization: Bearer <SAVE_PASSWORD>. The save
// view file is small but it's still a write to the canonical repo.

import fs from "node:fs/promises";
import path from "node:path";
import { writeGuard } from "../../../../lib/server-auth.js";
import { commitToGithub } from "../../../../lib/save-backend.js";

// Same slug set as /api/zones/save plus the DXF previews so the
// authoring views can publish their saved viewports.
const TARGETS_BY_SLUG = {
  bauko: "bauko_saved_views.json",
  "bauko-print": "bauko-print_saved_views.json",
  barlig: "barlig_saved_views.json",
  tadian: "tadian_saved_views.json",
  "tadian-dxf": "tadian-dxf_saved_views.json",
  sagada: "sagada_saved_views.json",
  "sagada-dxf": "sagada-dxf_saved_views.json",
  bontoc: "bontoc_saved_views.json",
  "bontoc-dxf": "bontoc-dxf_saved_views.json",
  sabangan: "sabangan_saved_views.json",
  "sabangan-dxf": "sabangan-dxf_saved_views.json",
  besao: "besao_saved_views.json",
  sadanga: "sadanga_saved_views.json",
  "sadanga-dxf": "sadanga-dxf_saved_views.json",
  natonin: "natonin_saved_views.json",
  "natonin-dxf": "natonin-dxf_saved_views.json",
  paracelis: "paracelis_saved_views.json",
  "paracelis-dxf": "paracelis-dxf_saved_views.json",
};

function isValidView(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Number.isFinite(value.zoom)
  );
}

function isValidPayload(value) {
  if (!value || typeof value !== "object") return false;
  const { barangays, stretches } = value;
  // A bare `{}` is rejected: it is indistinguishable from an empty or
  // malformed request, and accepting it truncates the saved-views file.
  // Clearing views is still possible, but has to be said explicitly —
  // `{ barangays: {}, stretches: {} }`.
  if (barangays === undefined && stretches === undefined) return false;
  if (barangays !== undefined && (!barangays || typeof barangays !== "object")) {
    return false;
  }
  if (stretches !== undefined && (!stretches || typeof stretches !== "object")) {
    return false;
  }
  // Each map may be empty, but every entry that IS present must be a
  // valid view.
  for (const key of Object.keys(barangays || {})) {
    if (!isValidView(barangays[key])) return false;
  }
  for (const key of Object.keys(stretches || {})) {
    if (!isValidView(stretches[key])) return false;
  }
  return true;
}

export async function POST(request) {
  const denied = writeGuard(request);
  if (denied) return denied;

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

  if (!isValidPayload(body)) {
    return Response.json(
      {
        ok: false,
        error:
          "Expected { barangays: {...}, stretches: {...} } — at least one key " +
          "must be present, and each entry must be { lat, lng, zoom }.",
      },
      { status: 400 }
    );
  }

  const cleaned = {
    barangays: body.barangays ?? {},
    stretches: body.stretches ?? {},
  };

  // Backstop against an automated publish wiping published views. The
  // client pushes on a debounce, so a bug there (or a browser with empty
  // localStorage that loaded nothing) can arrive as a legitimate-looking
  // empty payload. Clearing is still allowed — it just has to be said.
  const incomingCount =
    Object.keys(cleaned.barangays).length + Object.keys(cleaned.stretches).length;
  if (incomingCount === 0 && body?.force !== true) {
    try {
      const existing = JSON.parse(
        await fs.readFile(
          path.join(process.cwd(), "public", "data", fileName),
          "utf8"
        )
      );
      const existingCount =
        Object.keys(existing?.barangays ?? {}).length +
        Object.keys(existing?.stretches ?? {}).length;
      if (existingCount > 0) {
        return Response.json(
          {
            ok: false,
            error:
              `Refusing to replace ${existingCount} saved view(s) with an empty ` +
              `set. Send force: true if clearing them is intended.`,
          },
          { status: 409 }
        );
      }
    } catch {
      // No existing file, or unreadable — nothing to protect.
    }
  }

  const repoPath = `public/data/${fileName}`;
  const serialized = JSON.stringify(cleaned, null, 2) + "\n";

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
    const barangayCount = Object.keys(cleaned.barangays).length;
    const stretchCount = Object.keys(cleaned.stretches).length;
    return Response.json({
      ok: true,
      backend: "local-fs",
      path: repoPath,
      barangays: barangayCount,
      stretches: stretchCount,
    });
  }

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
    const barangayCount = Object.keys(cleaned.barangays).length;
    const stretchCount = Object.keys(cleaned.stretches).length;
    const result = await commitToGithub({
      token,
      owner,
      repo,
      branch,
      path: repoPath,
      content: serialized,
      message: `Update ${fileName} via /api/views/save (${barangayCount} barangay views, ${stretchCount} stretch views)`,
    });
    return Response.json({
      ok: true,
      backend: "github",
      path: repoPath,
      barangays: barangayCount,
      stretches: stretchCount,
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
