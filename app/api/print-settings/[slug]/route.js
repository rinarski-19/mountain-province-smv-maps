// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// GET  /api/print-settings/<slug>  → the published print overrides
// POST /api/print-settings/<slug>  → publish new overrides (auth required)
//
// "Print overrides" are the two things an unlocked editor can change
// about the printed sheet without touching geometry:
//
//   classValues — the ₱/m² unit value shown beside each SMV class in
//                 the legend. Overlays what's in <slug>_valuations.json
//                 rather than editing it, so the transcribed official
//                 schedule stays intact as the source of truth and a
//                 correction is visible as a small diff.
//   labels      — the fixed wording on the sheet (title, MUNICIPALITY:/
//                 PROVINCE OF: captions, legend column headers, road
//                 tier names, prepared-by block). See lib/print-labels.js.
//
// Persisted to public/data/<slug>_print_settings.json through the same
// dual backend as every other save (local file in dev, GitHub commit in
// production). The print SVG builder reads that file on every request,
// so a publish is visible on the very next print.
//
// GET is public and unauthenticated — the file is served to browsers
// anyway as a static asset under /data/, and the print sheet it feeds
// is public. Only POST is gated.

import path from "node:path";
import { normalizePrintSettings } from "../../../../lib/print-labels.js";
import { printableBarangays } from "../../print/svg/_route-helpers.js";
import { KNOWN_PRINT_SLUGS } from "../../../../lib/print-slugs.js";
import {
  printSettingsFileName,
  readPrintSettings,
} from "../../../../lib/print-settings-store.js";
import { persistPublicDataFile } from "../../../../lib/save-backend.js";
import { writeGuard } from "../../../../lib/server-auth.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function badSlug(slug) {
  return Response.json(
    { ok: false, error: `Unknown municipality slug: ${slug}` },
    { status: 400 }
  );
}

export async function GET(request, context) {
  const params = await context.params;
  const slug = (params?.slug || "").toLowerCase();
  if (!KNOWN_PRINT_SLUGS.has(slug)) return badSlug(slug);

  const publicDataDir = path.join(process.cwd(), "public", "data");
  const settings = readPrintSettings(slug, publicDataDir);
  return Response.json(
    {
      ok: true,
      slug,
      ...settings,
      // Only the barangays with a resolvable boundary. The LGU schedule
      // lists a few sitios and name variants that the PSA boundary file
      // has no feature for; offering those in the print menu produced a
      // raw 500 in a new tab.
      printableBarangays: printableBarangays(slug, publicDataDir),
    },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}

export async function POST(request, context) {
  const denied = writeGuard(request);
  if (denied) return denied;

  const params = await context.params;
  const slug = (params?.slug || "").toLowerCase();
  if (!KNOWN_PRINT_SLUGS.has(slug)) return badSlug(slug);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body is not valid JSON." },
      { status: 400 }
    );
  }

  const publicDataDir = path.join(process.cwd(), "public", "data");
  const current = readPrintSettings(slug, publicDataDir);

  // Optimistic concurrency. The panel sends the `updatedAt` it loaded;
  // if the file moved on since then, someone else published in the
  // meantime and a blind write would drop their changes silently.
  // `force: true` is the caller saying "yes, overwrite anyway".
  if (
    body?.force !== true &&
    body?.baseUpdatedAt !== undefined &&
    (body.baseUpdatedAt ?? null) !== (current.updatedAt ?? null)
  ) {
    return Response.json(
      {
        ok: false,
        conflict: true,
        error:
          "Someone else published print settings for this municipality " +
          "since you opened the panel. Reopen the panel to pick up their " +
          "changes, then publish again.",
        current: {
          classValues: current.classValues,
          labels: current.labels,
          updatedAt: current.updatedAt,
        },
      },
      { status: 409 }
    );
  }

  // normalizePrintSettings drops unknown keys, non-numeric values, and
  // any override that just restates the default — so whatever a client
  // posts, what lands on disk is a small, well-formed diff.
  const settings = normalizePrintSettings(body);
  const fileName = printSettingsFileName(slug);
  const updatedAt = new Date().toISOString();
  const serialized =
    JSON.stringify(
      {
        _comment:
          "Print overrides for the A3 SMV sheet. Written by /api/print-settings/<slug>. " +
          "classValues overlay <slug>_valuations.json; labels overlay PRINT_LABEL_DEFAULTS in lib/print-labels.js.",
        slug,
        updated_at: updatedAt,
        ...settings,
      },
      null,
      2
    ) + "\n";

  const requested =
    Object.keys(body?.classValues ?? {}).length +
    Object.keys(body?.labels ?? {}).length;
  const changed =
    Object.keys(settings.classValues).length +
    Object.keys(settings.labels).length;
  // Which of the caller's entries normalization threw away, and why —
  // publishing used to report plain success for a value it had dropped.
  const rejected = [];
  for (const [klass, value] of Object.entries(body?.classValues ?? {})) {
    if (value === "" || value == null) continue;
    if (settings.classValues[String(klass).toUpperCase()] === undefined) {
      rejected.push(`${klass} (${JSON.stringify(value)}) is not a value between 0 and 100,000,000`);
    }
  }

  try {
    const result = await persistPublicDataFile({
      fileName,
      serialized,
      message: `Update ${fileName} via /api/print-settings (${changed} override${
        changed === 1 ? "" : "s"
      })`,
    });
    return Response.json({
      ok: true,
      slug,
      overrides: changed,
      requested,
      rejected,
      updatedAt,
      ...result,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: e.status ?? 500 }
    );
  }
}
