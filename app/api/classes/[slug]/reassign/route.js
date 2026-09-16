// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// POST /api/classes/<slug>/reassign  { from, to }
//
// Moves every zone drawn in one SMV class to another, so a class can be
// withdrawn without stranding its polygons. Only the `classification`
// property changes; geometry is untouched.
//
// Separate from the class add/remove route on purpose: this rewrites the
// zones file, which is the most valuable data in the project, so it is
// one explicit action with its own confirmation rather than a side effect
// of editing a list.

import path from "node:path";
import { KNOWN_PRINT_SLUGS } from "../../../../../lib/print-slugs.js";
import { persistPublicDataFile } from "../../../../../lib/save-backend.js";
import { writeGuard } from "../../../../../lib/server-auth.js";
import { reassignZones, zonesFileName } from "../../../../../lib/zone-usage.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request, context) {
  const denied = writeGuard(request);
  if (denied) return denied;

  const params = await context.params;
  const slug = (params?.slug || "").toLowerCase();
  if (!KNOWN_PRINT_SLUGS.has(slug)) {
    return Response.json(
      { ok: false, error: `Unknown municipality slug: ${slug}` },
      { status: 400 }
    );
  }

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
  let result;
  try {
    result = reassignZones(slug, publicDataDir, body?.from, body?.to);
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: e.status ?? 400 }
    );
  }

  if (result.moved === 0) {
    return Response.json({
      ok: true,
      moved: 0,
      note: `No zones were classified ${String(body?.from).toUpperCase()}.`,
    });
  }

  const fileName = zonesFileName(slug);
  try {
    const saved = await persistPublicDataFile({
      fileName,
      serialized: result.serialized,
      message: `Reassign ${result.moved} zones from ${String(body.from).toUpperCase()} to ${String(body.to).toUpperCase()} in ${slug}`,
    });
    return Response.json({ ok: true, moved: result.moved, ...saved });
  } catch (e) {
    return Response.json(
      { ok: false, error: e.message ?? String(e) },
      { status: e.status ?? 500 }
    );
  }
}
