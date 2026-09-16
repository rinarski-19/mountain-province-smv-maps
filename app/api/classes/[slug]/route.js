// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// GET  /api/classes/<slug>  → the classes this LGU added after transcription
// POST /api/classes/<slug>  → publish the list (auth required)
//
// See lib/added-classes.js for why these live in data rather than in the
// schedule source. The POST replaces the whole list, which is what the
// panel sends; removing a class is publishing a list without it.

import path from "node:path";
import {
  MAX_ADDED_CLASSES,
  sanitizeAddedClasses,
  sanitizeRemovedClasses,
} from "../../../../lib/added-classes.js";
import {
  addedClassesFileName,
  readAddedClasses,
} from "../../../../lib/added-classes-store.js";
import { getMunicipalityConfig } from "../../../../lib/municipalities.js";
import { KNOWN_PRINT_SLUGS } from "../../../../lib/print-slugs.js";
import { persistPublicDataFile } from "../../../../lib/save-backend.js";
import { writeGuard } from "../../../../lib/server-auth.js";
import { zoneCountsByClass } from "../../../../lib/zone-usage.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const publicDataDir = () => path.join(process.cwd(), "public", "data");

// The codes already in the transcribed schedule, and the barangay slugs a
// location group may legitimately reference.
function scheduleContext(slug) {
  const schedule = getMunicipalityConfig(slug)?.schedule;
  return {
    existingSubClasses: (schedule?.classifications ?? []).map((r) => r?.subClass),
    validBarangaySlugs: new Set((schedule?.barangays ?? []).map((b) => b.slug)),
  };
}

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

  const ctx = scheduleContext(slug);
  const { classes, removed, updatedAt } = readAddedClasses(
    slug,
    publicDataDir(),
    ctx
  );
  return Response.json(
    {
      ok: true,
      slug,
      classes,
      removed,
      updatedAt,
      // What the panel needs to offer a sensible "add" form.
      existingSubClasses: ctx.existingSubClasses,
      // How many drawn zones use each class, so the panel can refuse to
      // strand them.
      zoneCounts: zoneCountsByClass(slug, publicDataDir()),
      barangays: (getMunicipalityConfig(slug)?.schedule?.barangays ?? []).map(
        (b) => ({ slug: b.slug, name: b.name })
      ),
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

  const ctx = scheduleContext(slug);
  const current = readAddedClasses(slug, publicDataDir(), ctx);

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
          "Someone else changed this municipality's classes since you opened " +
          "the panel. Reopen the panel to pick up their changes, then publish again.",
        current,
      },
      { status: 409 }
    );
  }

  // The reassign-first flow lives in the panel, but the guard cannot: a
  // direct POST removing a class with zones drawn in it strands those
  // polygons — still painted and labelled, no longer selectable, absent
  // from the legend. Refuse unless the caller says it is intended.
  const counts = zoneCountsByClass(slug, publicDataDir());
  const strandedBy = (codes) =>
    (codes ?? [])
      .map((c) => String(c).toUpperCase())
      .filter((c) => (counts[c] ?? 0) > 0)
      .map((c) => `${c} (${counts[c]} zones)`);

  const droppedAdded = current.classes
    .map((c) => c.subClass)
    .filter((c) => !(body?.classes ?? []).some((n) => String(n?.subClass ?? "").toUpperCase() === c));
  const stranded = [
    ...strandedBy(body?.removed),
    ...strandedBy(droppedAdded),
  ];
  if (stranded.length && body?.allowStranded !== true) {
    return Response.json(
      {
        ok: false,
        stranded: true,
        error:
          `Zones are still drawn in ${stranded.join(", ")}. Reassign them ` +
          `first (POST /api/classes/${slug}/reassign), or send ` +
          `allowStranded: true to remove the class anyway.`,
      },
      { status: 409 }
    );
  }

  const requested = Array.isArray(body?.classes) ? body.classes.length : 0;
  const classes = sanitizeAddedClasses(body?.classes, ctx);
  const removed = sanitizeRemovedClasses(body?.removed, ctx);

  // Asking to add classes and having every one rejected is a failed
  // request, not a successful no-op. A pure removal sends no classes, so
  // only complain when some were actually offered.
  if (requested > 0 && classes.length === 0) {
    return Response.json(
      {
        ok: false,
        error:
          "No classes were added. Each needs a code from the catalog " +
          "(C-1…C-12, R-1…R-15, INSTITUTIONAL) that this municipality does " +
          "not already have, and a value between 0 and 100,000,000.",
        existingSubClasses: ctx.existingSubClasses,
      },
      { status: 400 }
    );
  }
  if (requested > MAX_ADDED_CLASSES) {
    return Response.json(
      {
        ok: false,
        error: `At most ${MAX_ADDED_CLASSES} added classes per municipality.`,
      },
      { status: 400 }
    );
  }

  const updatedAt = new Date().toISOString();
  const fileName = addedClassesFileName(slug);
  const serialized =
    JSON.stringify(
      {
        _comment:
          "Classes this municipality added after lib/<slug>.js was transcribed. " +
          "Written by /api/classes/<slug>; merged over the schedule at runtime. " +
          "The transcription itself is never rewritten.",
        slug,
        updated_at: updatedAt,
        classes,
        removed,
      },
      null,
      2
    ) + "\n";

  try {
    const result = await persistPublicDataFile({
      fileName,
      serialized,
      message: `Update ${fileName} via /api/classes (${classes.length} added, ${removed.length} removed)`,
    });
    // A 200 that silently dropped half the payload reads as success.
    const accepted = new Set(classes.map((c) => c.subClass));
    const rejected = (body?.classes ?? [])
      .map((c) => String(c?.subClass ?? "").toUpperCase())
      .filter((c) => c && !accepted.has(c));
    return Response.json({
      ok: true,
      slug,
      classes,
      removed,
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
