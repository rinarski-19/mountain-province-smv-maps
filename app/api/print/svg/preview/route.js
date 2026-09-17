// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// POST /api/print/svg/preview
//
// Renders a print sheet using overrides that have NOT been published
// yet — the Print panel's "Preview draft" button. The panel submits a
// real <form method="post" target="_blank">, which is the only way to
// land a POST response in a new browser tab; the draft JSON rides in a
// hidden field rather than the query string, so long label text and
// dozens of class values can't blow the URL length limit.
//
// Form fields:
//   slug         required, e.g. "bauko"
//   barangay     optional barangay slug; omit for the whole LGU
//   orientation  "portrait" | "landscape"
//   overrides    JSON: { classValues: {...}, labels: {...} }
//   smvBuffer / buildings / locations — same knobs as the GET routes
//
// Auth required: a draft preview is an editor feature, and rendering
// arbitrary label text is a write-shaped operation even though nothing
// is persisted.

import { sanitizeClassColors } from "../../../../../lib/classifications.js";
import { normalizePrintSettings } from "../../../../../lib/print-labels.js";
import { sanitizePrintTheme } from "../../../../../lib/print-theme.js";
import { writeGuard } from "../../../../../lib/server-auth.js";
import { buildPrintSvgResponse } from "../_route-helpers.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Everything downstream reads its knobs off request.url, so rebuild a
// GET-shaped request carrying the form's passthrough params.
function asGetRequest(request, fields) {
  const url = new URL(request.url);
  url.search = "";
  for (const key of ["smvBuffer", "buildings", "locations", "zoom", "landmarks", "panX", "panY"]) {
    const value = fields.get(key);
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return new Request(url, { headers: request.headers });
}

export async function POST(request) {
  const denied = writeGuard(request);
  if (denied) return denied;

  let fields;
  try {
    fields = await request.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Expected a form submission." },
      { status: 400 }
    );
  }

  let overrides = { classValues: {}, labels: {} };
  const raw = fields.get("overrides");
  if (raw) {
    try {
      overrides = normalizePrintSettings(JSON.parse(String(raw)));
    } catch {
      return Response.json(
        { ok: false, error: "`overrides` is not valid JSON." },
        { status: 400 }
      );
    }
  }

  const barangaySlug = String(fields.get("barangay") || "").toLowerCase();

  // Unpublished colours ride along with the draft. buildSvgForSlug sets
  // the palette from disk on entry, so stash these for it to merge.
  let draftColors = null;
  const rawColors = fields.get("colors");
  if (rawColors) {
    try {
      draftColors = sanitizeClassColors(JSON.parse(String(rawColors)));
    } catch {
      draftColors = null;
    }
  }

  let draftTheme = null;
  const rawTheme = fields.get("theme");
  if (rawTheme) {
    try {
      draftTheme = sanitizePrintTheme(JSON.parse(String(rawTheme)));
    } catch {
      draftTheme = null;
    }
  }

  return buildPrintSvgResponse({
    request: asGetRequest(request, fields),
    slug: String(fields.get("slug") || "").toLowerCase(),
    barangaySlug: barangaySlug || null,
    orientation: String(fields.get("orientation") || "portrait"),
    overrides,
    colors: draftColors,
    theme: draftTheme,
  });
}
