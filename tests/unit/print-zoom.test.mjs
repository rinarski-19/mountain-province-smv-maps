// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  MAX_PRINT_PAN,
  clampPrintPan,
  DEFAULT_PRINT_ZOOM,
  MAX_PRINT_ZOOM,
  MIN_PRINT_ZOOM,
  clampPrintZoom,
} = await mod("lib/print-zoom.js");

describe("clampPrintZoom", () => {
  test("passes sensible values through", () => {
    for (const z of [0.5, 0.75, 1, 1.5, 2, 3]) assert.equal(clampPrintZoom(z), z);
  });

  test("accepts numeric strings, as a query param arrives", () => {
    assert.equal(clampPrintZoom("1.5"), 1.5);
  });

  test("clamps beyond the bounds rather than rejecting", () => {
    assert.equal(clampPrintZoom(99), MAX_PRINT_ZOOM);
    assert.equal(clampPrintZoom(0.01), MIN_PRINT_ZOOM);
  });

  test("falls back to fit for anything unusable", () => {
    // A bad value must print a normal sheet, never a blank or absurd one.
    for (const bad of [0, -2, "abc", "", null, undefined, NaN, Infinity, {}]) {
      assert.equal(clampPrintZoom(bad), DEFAULT_PRINT_ZOOM, `bad input: ${String(bad)}`);
    }
  });
});

describe("clampPrintPan", () => {
  test("passes values within range through", () => {
    for (const v of [-1, -0.5, 0, 0.25, 1]) assert.equal(clampPrintPan(v), v);
  });

  test("clamps beyond the range rather than rejecting", () => {
    assert.equal(clampPrintPan(9), MAX_PRINT_PAN);
    assert.equal(clampPrintPan(-9), -MAX_PRINT_PAN);
  });

  test("anything unusable means centred, never a blank sheet", () => {
    for (const bad of ["abc", "", null, undefined, NaN, {}]) {
      assert.equal(clampPrintPan(bad), 0, `bad input: ${String(bad)}`);
    }
  });
});

describe("pan in the rendered sheet", () => {
  test("shifts the drawing by the requested fraction of the frame, and only that axis", async () => {
    const { buildSvgForSlug } = await mod("lib/print-svg-builder.js");
    const { PUBLIC_DATA } = await import("../helpers/paths.mjs");
    const centre = (svg) => {
      const i = svg.indexOf('<g id="municipal-boundary"');
      const b = svg.slice(i, svg.indexOf("</g>", i));
      const xs = [], ys = [];
      for (const m of b.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) { xs.push(+m[1]); ys.push(+m[2]); }
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    };
    const at = (panX, panY) =>
      centre(buildSvgForSlug("sadanga", PUBLIC_DATA, { zoom: 2, panX, panY }).svg);

    const [x0, y0] = at(0, 0);
    const [x1, y1] = at(0.25, 0);
    const [x2, y2] = at(0, 0.25);

    assert.ok(x1 > x0, "positive panX must move the map right");
    assert.ok(Math.abs(y1 - y0) < 0.01, "panX must not move the map vertically");
    assert.ok(y2 > y0, "positive panY must move the map down");
    assert.ok(Math.abs(x2 - x0) < 0.01, "panY must not move the map horizontally");

    // Symmetric, and recorded on the root for traceability.
    const [xm] = at(-0.25, 0);
    assert.ok(Math.abs((x1 - x0) - (x0 - xm)) < 0.01, "pan must be symmetric");
    assert.match(
      buildSvgForSlug("sadanga", PUBLIC_DATA, { panX: 0.3, panY: -0.2 }).svg,
      /data-pan="0\.3,-0\.2"/
    );
  });
});

describe("zoom in the rendered sheet", () => {
  test("scales the drawing linearly and records what was used", async () => {
    const { buildSvgForSlug } = await mod("lib/print-svg-builder.js");
    const { PUBLIC_DATA } = await mod("tests/helpers/paths.mjs").then(() => import("../helpers/paths.mjs"));
    const span = (svg) => {
      const i = svg.indexOf('<g id="municipal-boundary"');
      const block = svg.slice(i, svg.indexOf("</g>", i));
      const xs = [...block.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const at = (zoom) => buildSvgForSlug("sadanga", PUBLIC_DATA, { zoom }).svg;

    const one = at(1);
    const double = at(2);
    assert.match(one, /data-zoom="1"/);
    assert.match(double, /data-zoom="2"/);
    const ratio = span(double) / span(one);
    assert.ok(Math.abs(ratio - 2) < 0.01, `expected 2x, got ${ratio.toFixed(3)}x`);

    // An out-of-range request still produces a sheet, at the clamped zoom.
    assert.match(at(99), new RegExp(`data-zoom="${MAX_PRINT_ZOOM}"`));
  });
});

describe("print layer split", () => {
  test("the map layer drops the furniture and keeps the paper", async () => {
    // The drag-to-frame preview transforms only the map: the legend,
    // compass, signature and page border are fixed to the paper and do
    // not move when panning. Dragging the whole sheet showed the legend
    // sliding around, which never happens in print.
    const { buildSvgForSlug } = await mod("lib/print-svg-builder.js");
    const { extractPrintLayer, FURNITURE_GROUP_IDS } = await mod("lib/print-layers.js");
    const { PUBLIC_DATA } = await import("../helpers/paths.mjs");
    const svg = buildSvgForSlug("sadanga", PUBLIC_DATA, {}).svg;

    const map = extractPrintLayer(svg, "map");
    for (const id of FURNITURE_GROUP_IDS) {
      assert.ok(!map.includes(`<g id="${id}"`), `map layer still has ${id}`);
    }
    assert.ok(map.includes('<g id="municipal-boundary"'), "map layer lost the map");
    assert.match(map, /^<svg/);
    assert.match(map.trimEnd(), /<\/svg>$/);
    // Keeps the paper rect: it is the background the furniture sits over.
    assert.match(map, /<rect x="0" y="0"/);
  });

  test("the furniture layer keeps only furniture, on a transparent ground", async () => {
    const { buildSvgForSlug } = await mod("lib/print-svg-builder.js");
    const { extractPrintLayer } = await mod("lib/print-layers.js");
    const { PUBLIC_DATA } = await import("../helpers/paths.mjs");
    const svg = buildSvgForSlug("sadanga", PUBLIC_DATA, {}).svg;

    const furniture = extractPrintLayer(svg, "furniture");
    assert.ok(furniture.includes('<g id="legend"'));
    assert.ok(furniture.includes('<g id="prepared-by"'));
    assert.ok(!furniture.includes('<g id="municipal-boundary"'), "furniture layer carries map");
    assert.ok(!furniture.includes('<g id="water"'));
    // No paper rect, or it would hide the map layer beneath it.
    assert.ok(!/<rect x="0" y="0"/.test(furniture), "furniture layer is opaque");
    assert.match(furniture, /^<svg/);
    assert.match(furniture.trimEnd(), /<\/svg>$/);
    // Nested groups (the compass rose) must not truncate the block early.
    assert.ok(furniture.includes('<g id="compass-rose"'));
    assert.equal(
      (furniture.match(/<g/g) || []).length,
      (furniture.match(/<\/g>/g) || []).length,
      "unbalanced groups"
    );
  });

  test("an unknown layer returns the sheet unchanged", async () => {
    const { extractPrintLayer, isPrintLayer } = await mod("lib/print-layers.js");
    assert.equal(extractPrintLayer("<svg>x</svg>", "bogus"), "<svg>x</svg>");
    assert.equal(extractPrintLayer("<svg>x</svg>", null), "<svg>x</svg>");
    assert.equal(isPrintLayer("map"), true);
    assert.equal(isPrintLayer("furniture"), true);
    assert.equal(isPrintLayer("bogus"), false);
  });
});
