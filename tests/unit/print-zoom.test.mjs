// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
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
