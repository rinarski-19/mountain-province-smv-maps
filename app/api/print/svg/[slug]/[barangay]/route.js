// GET /api/print/svg/<slug>/<barangay>
//
// Same idea as ../route.js (fresh, on-demand A3 SVG straight off the
// current public/data/*.geojson), but cropped to a single barangay
// instead of the whole municipality — legible road/zone detail for
// large LGUs where one whole-LGU sheet squeezes everything too small
// to read. The whole-municipality route stays available side by side.
//
// <barangay> is the same slug used everywhere else in the app (search,
// sidebar, saved views). Resolving that slug to the spelling used in
// the PSA boundary file (Besao's "Kin-iway" vs. "Kin-iway (Pob.)") is
// handled by resolvePrintBarangay() in ../../_route-helpers.js via the
// LGU's own alias-aware schedule.slugForName().

import { buildPrintSvgResponse } from "../../_route-helpers.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, context) {
  const params = await context.params;
  return buildPrintSvgResponse({
    request,
    slug: (params?.slug || "").toLowerCase(),
    barangaySlug: (params?.barangay || "").toLowerCase(),
  });
}
