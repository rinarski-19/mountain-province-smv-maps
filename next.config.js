/** @type {import('next').NextConfig} */
//
// Two build modes:
//   - Default (dev + Node server prod): everything works including
//     API routes (/api/zones/save, /api/views/save, /api/zones/import-dxf).
//     This is what `pnpm dev` and `pnpm build` + `pnpm start` produce.
//
//   - Static export (STATIC_EXPORT=1): outputs a self-contained
//     `out/` folder that runs from file://. Used for USB-stick / venue
//     laptop delivery of the viewer. API routes are not supported in
//     this mode (Next.js requirement); they get tree-shaken and any
//     POST to /api/* from the static export will 404. The viewer side
//     of the app (read-only) works fully, including reading
//     <slug>_saved_views.json bundled under public/data/.
//
// To build a USB delivery: `STATIC_EXPORT=1 pnpm build`. Then copy
// `out/` to a USB stick and double-click `Open SMV (Mac).command` or
// `Open SMV (Windows).bat` on the target machine.

const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        // next/image can't run without the Next server in static mode.
        images: { unoptimized: true },
        // Trailing slash + index.html in each route folder so links work
        // when served from file://.
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
