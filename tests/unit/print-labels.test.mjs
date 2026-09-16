// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  MAX_CLASS_VALUE,
  MAX_LABEL_LENGTH,
  PRINT_LABEL_DEFAULTS,
  PRINT_LABEL_FIELDS,
  OPTIONAL_LABEL_KEYS,
  compactClassValues,
  compactPrintLabels,
  normalizePrintSettings,
  printLabelGroups,
  resolvePrintLabels,
} = await mod("lib/print-labels.js");

describe("print label schema", () => {
  test("every field has a unique key, a group and a non-empty default", () => {
    const keys = new Set();
    for (const field of PRINT_LABEL_FIELDS) {
      assert.ok(field.key, "field is missing a key");
      assert.ok(!keys.has(field.key), `duplicate key ${field.key}`);
      keys.add(field.key);
      assert.ok(field.group, `${field.key} has no group`);
      assert.ok(field.label, `${field.key} has no form label`);
      assert.equal(typeof field.default, "string");
      // Signature columns 2 and 3 are off unless filled in, so an empty
      // default is meaningful for them.
      if (!OPTIONAL_LABEL_KEYS.has(field.key)) {
        assert.ok(field.default.length > 0, `${field.key} default is empty`);
      }
    }
  });

  test("groups preserve declaration order and cover every field", () => {
    const groups = printLabelGroups();
    const flattened = groups.flatMap((g) => g.fields.map((f) => f.key));
    assert.equal(flattened.length, PRINT_LABEL_FIELDS.length);
    assert.deepEqual(new Set(flattened), new Set(Object.keys(PRINT_LABEL_DEFAULTS)));
  });
});

describe("resolvePrintLabels", () => {
  test("returns defaults when given nothing", () => {
    assert.deepEqual(resolvePrintLabels(null), { ...PRINT_LABEL_DEFAULTS });
    assert.deepEqual(resolvePrintLabels(undefined), { ...PRINT_LABEL_DEFAULTS });
    assert.deepEqual(resolvePrintLabels({}), { ...PRINT_LABEL_DEFAULTS });
  });

  test("blank and whitespace-only overrides fall back to the default", () => {
    // Regression: clearing a field must restore the stock wording rather
    // than printing an empty caption on the sheet.
    const out = resolvePrintLabels({ title: "   ", legendLabel: "" });
    assert.equal(out.title, PRINT_LABEL_DEFAULTS.title);
    assert.equal(out.legendLabel, PRINT_LABEL_DEFAULTS.legendLabel);
  });

  test("unknown keys are ignored", () => {
    const out = resolvePrintLabels({ nope: "x", __proto__: "y" });
    assert.equal(out.nope, undefined);
    assert.equal(out.title, PRINT_LABEL_DEFAULTS.title);
  });

  test("over-long captions are clamped", () => {
    // Regression: a 400-character title rendered ~1465 mm wide on a
    // 297 mm sheet, spilling off both edges.
    const out = resolvePrintLabels({ title: "X".repeat(400) });
    assert.equal(out.title.length, MAX_LABEL_LENGTH);
  });
});

describe("compactPrintLabels", () => {
  test("drops overrides that merely restate the default", () => {
    const out = compactPrintLabels({
      title: PRINT_LABEL_DEFAULTS.title,
      legendLabel: "SCHEDULE:",
    });
    assert.deepEqual(out, { legendLabel: "SCHEDULE:" });
  });

  test("trims and clamps what it keeps", () => {
    const out = compactPrintLabels({ title: `  ${"Y".repeat(200)}  ` });
    assert.equal(out.title.length, MAX_LABEL_LENGTH);
  });
});

describe("compactClassValues", () => {
  test("keeps plain numbers and numeric strings, upper-casing the class", () => {
    assert.deepEqual(compactClassValues({ "c-1": 5170, "R-2": "4210" }), {
      "C-1": 5170,
      "R-2": 4210,
    });
  });

  test("accepts thousands separators", () => {
    assert.deepEqual(compactClassValues({ "C-1": "5,170" }), { "C-1": 5170 });
  });

  test("rejects negatives, NaN, infinities and over-large values", () => {
    // Regression: a 24-digit value overprinted the neighbouring legend
    // column; a negative one was silently discarded while publish still
    // reported success.
    const out = compactClassValues({
      "C-1": -99,
      "C-2": "abc",
      "C-3": Infinity,
      "C-4": MAX_CLASS_VALUE + 1,
      "C-5": MAX_CLASS_VALUE,
      "C-6": 0,
    });
    assert.deepEqual(out, { "C-5": MAX_CLASS_VALUE, "C-6": 0 });
  });

  test("rejects class keys that are not simple identifiers", () => {
    const out = compactClassValues({ "../../etc/passwd": 1, "C 1": 2, "C-1": 3 });
    assert.deepEqual(out, { "C 1": 2, "C-1": 3 });
  });

  test("skips empty and null entries rather than coercing them to 0", () => {
    assert.deepEqual(compactClassValues({ "C-1": "", "C-2": null, "C-3": undefined }), {});
  });
});

describe("normalizePrintSettings", () => {
  test("always returns both maps, even for junk input", () => {
    for (const input of [null, undefined, 42, "x", [], { classValues: 1 }]) {
      const out = normalizePrintSettings(input);
      assert.deepEqual(Object.keys(out).sort(), ["classValues", "labels"]);
      assert.equal(typeof out.classValues, "object");
      assert.equal(typeof out.labels, "object");
    }
  });

  test("strips extraneous top-level keys", () => {
    const out = normalizePrintSettings({
      classValues: { "C-1": 1 },
      labels: { title: "T" },
      force: true,
      baseUpdatedAt: "x",
      evil: "y",
    });
    assert.deepEqual(out, { classValues: { "C-1": 1 }, labels: { title: "T" } });
  });
});
