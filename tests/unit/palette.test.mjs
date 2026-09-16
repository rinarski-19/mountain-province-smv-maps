// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// The editable SMV palette: sanitization, the shared resolver, and the
// three-way distinction the print builder has to make between "no palette
// supplied", "an explicit empty palette", and "a draft palette".
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  CLASSIFICATION_INFO,
  DEFAULT_CLASS_COLORS,
  colorForClass,
  getClassColorOverrides,
  sanitizeClassColors,
  setClassColorOverrides,
} = await mod("lib/classifications.js");

afterEach(() => setClassColorOverrides({}));

describe("sanitizeClassColors", () => {
  test("keeps well-formed hex for classes that exist, normalized to lowercase", () => {
    assert.deepEqual(sanitizeClassColors({ "c-1": "#FF00FF" }), { "C-1": "#ff00ff" });
  });

  test("rejects anything that is not a 6-digit hex", () => {
    const out = sanitizeClassColors({
      "C-1": "red",
      "C-2": "#ff",
      "C-3": "#GGGGGG",
      "C-4": "#ff00ff00",
      "R-1": 0xff00ff,
      "R-2": null,
      "R-3": "",
    });
    assert.deepEqual(out, {});
  });

  test("rejects classes that do not exist", () => {
    assert.deepEqual(sanitizeClassColors({ "Z-99": "#ff00ff", NOPE: "#000000" }), {});
  });

  test("drops a colour equal to the stock one, case-insensitively", () => {
    // Otherwise the file accumulates entries that change nothing, and the
    // UI shows a class as "edited" when it is not.
    const stock = CLASSIFICATION_INFO["C-1"].color;
    assert.deepEqual(sanitizeClassColors({ "C-1": stock }), {});
    assert.deepEqual(sanitizeClassColors({ "C-1": stock.toLowerCase() }), {});
    assert.deepEqual(sanitizeClassColors({ "C-1": stock.toUpperCase() }), {});
  });

  test("tolerates junk input", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      assert.deepEqual(sanitizeClassColors(bad), {});
    }
  });
});

describe("colorForClass", () => {
  test("returns the stock colour with no overrides set", () => {
    assert.equal(colorForClass("C-1"), DEFAULT_CLASS_COLORS["C-1"]);
  });

  test("an override wins, and is visible to every caller", () => {
    setClassColorOverrides({ "C-1": "#123456" });
    assert.equal(colorForClass("C-1"), "#123456");
    // Untouched classes keep their stock colour.
    assert.equal(colorForClass("R-1"), DEFAULT_CLASS_COLORS["R-1"]);
  });

  test("is case-insensitive about the class name", () => {
    setClassColorOverrides({ "C-1": "#123456" });
    assert.equal(colorForClass("c-1"), "#123456");
    assert.equal(colorForClass(" C-1 "), "#123456");
  });

  test("setting an empty map clears every override", () => {
    setClassColorOverrides({ "C-1": "#123456" });
    setClassColorOverrides({});
    assert.equal(colorForClass("C-1"), DEFAULT_CLASS_COLORS["C-1"]);
    assert.deepEqual(getClassColorOverrides(), {});
  });

  test("an unknown class falls through to UNCLASSIFIED", () => {
    assert.equal(colorForClass("Z-99"), CLASSIFICATION_INFO.UNCLASSIFIED.color);
    assert.equal(colorForClass(null), CLASSIFICATION_INFO.UNCLASSIFIED.color);
  });

  test("invalid overrides never reach the map", () => {
    setClassColorOverrides({ "C-1": "red" });
    assert.equal(colorForClass("C-1"), DEFAULT_CLASS_COLORS["C-1"]);
  });
});
