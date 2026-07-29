import { buildPrintSvgResponse } from "../../_route-helpers.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request, context) {
  const params = await context.params;
  return buildPrintSvgResponse({
    request,
    slug: (params?.slug || "").toLowerCase(),
    orientation: "portrait",
  });
}
