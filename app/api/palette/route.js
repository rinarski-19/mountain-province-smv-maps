// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// GET  /api/palette  → the province-wide SMV class colors
// POST /api/palette  → publish new colors (auth required)
//
// One palette for all ten LGUs, stored in public/data/smv_palette.json.
// Per-municipality colors were deliberately not built: C-1 must mean the
// same red everywhere or sheets from different LGUs stop being
// comparable.
//
// GET is public — the colors are on every printed sheet and every map
// polygon anyway, and the client needs them before it can paint.

import path from "node:path";
import {
  DEFAULT_CLASS_COLORS,
  sanitizeClassColors,
} from "../../../lib/classifications.js";
import { PALETTE_FILE, readPalette } from "../../../lib/palette-store.js";
import {
  PRINT_THEME_DEFAULTS,
  sanitizePrintTheme,
} from "../../../lib/print-theme.js";
import { persistPublicDataFile } from "../../../lib/save-backend.js";
import { writeGuard } from "../../../lib/server-auth.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const publicDataDir = () => path.join(process.cwd(), "public", "data");

export async function GET() {
  const { colors, theme, updatedAt } = readPalette(publicDataDir());
  return Response.json(
    {
      ok: true,
      colors,
      theme,
      updatedAt,
      // The stock palette, so the editor can show what each class looks
      // like by default and offer a per-class reset.
      defaults: DEFAULT_CLASS_COLORS,
      themeDefaults: PRINT_THEME_DEFAULTS,
    },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}

export async function POST(request) {
  const denied = writeGuard(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body is not valid JSON." },
      { status: 400 }
    );
  }

  const current = readPalette(publicDataDir());

  // Same optimistic-concurrency contract as the print settings: a stale
  // publish is refused rather than silently dropping someone else's
  // recolour.
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
          "Someone else published a palette since you opened the panel. " +
          "Reopen the panel to pick up their changes, then publish again.",
        current,
      },
      { status: 409 }
    );
  }

  const colors = sanitizeClassColors(body?.colors);
  const theme = sanitizePrintTheme(body?.theme);
  const requested =
    Object.keys(body?.colors ?? {}).length + Object.keys(body?.theme ?? {}).length;
  // Asking for colours and getting none applied is a failed request, not a
  // successful no-op — writing a fresh file and returning ok:true hid the
  // fact that every value was rejected.
  if (
    requested > 0 &&
    Object.keys(colors).length === 0 &&
    Object.keys(theme).length === 0
  ) {
    return Response.json(
      {
        ok: false,
        error:
          "No colours were applied. Class colours need a #rrggbb hex for a " +
          "known SMV class; theme colours need a #rrggbb hex for a known " +
          "key (see lib/print-theme.js). Either way the value must differ " +
          "from the stock colour.",
        rejected: [
          ...Object.keys(body?.colors ?? {}),
          ...Object.keys(body?.theme ?? {}),
        ],
      },
      { status: 400 }
    );
  }
  // sanitizeClassColors drops unknown classes, non-hex values, and any
  // colour equal to the stock one. Report what it threw away instead of
  // claiming a clean success.
  const rejected = [
    ...Object.keys(body?.colors ?? {}).filter(
      (k) => colors[String(k).trim().toUpperCase()] === undefined
    ),
    ...Object.keys(body?.theme ?? {}).filter((k) => theme[k] === undefined),
  ];

  const updatedAt = new Date().toISOString();
  const serialized =
    JSON.stringify(
      {
        _comment:
          "Province-wide SMV class colors. Written by /api/palette. Overlays " +
          "CLASSIFICATION_INFO in lib/classifications.js; only classes that " +
          "differ from the stock palette are stored.",
        updated_at: updatedAt,
        colors,
        theme,
      },
      null,
      2
    ) + "\n";

  try {
    const result = await persistPublicDataFile({
      fileName: PALETTE_FILE,
      serialized,
      message: `Update ${PALETTE_FILE} via /api/palette (${
        Object.keys(colors).length
      } class colors, ${Object.keys(theme).length} theme colors)`,
    });
    return Response.json({
      ok: true,
      colors,
      theme,
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
