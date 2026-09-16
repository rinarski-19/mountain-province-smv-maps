// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Classes a municipality adds to, or withdraws from, its transcribed
// schedule. The transcription in lib/<slug>.js is never rewritten, so
// these tests pin down what the data layer over it is allowed to do.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  MAX_ADDED_CLASSES,
  addedClassValues,
  categoryForClass,
  mergeClassifications,
  sanitizeAddedClasses,
  sanitizeRemovedClasses,
} = await mod("lib/added-classes.js");

const CTX = {
  existingSubClasses: ["C-1", "R-1"],
  validBarangaySlugs: new Set(["saclit", "sadanga"]),
};

describe("sanitizeAddedClasses", () => {
  test("accepts a known code the LGU does not already have", () => {
    const [row] = sanitizeAddedClasses(
      [{ subClass: "c-2", marketValue2027: "1,800" }],
      CTX
    );
    assert.equal(row.subClass, "C-2");
    assert.equal(row.marketValue2027, 1800);
    assert.equal(row.category, "commercial");
    assert.equal(row.id, "c-2");
    assert.equal(row.added, true);
  });

  test("refuses a code already in the transcribed schedule", () => {
    // That would be editing the official record, which belongs in
    // lib/<slug>.js, not in a data overlay.
    assert.deepEqual(sanitizeAddedClasses([{ subClass: "C-1", marketValue2027: 1 }], CTX), []);
  });

  test("refuses codes the province-wide catalogue does not define", () => {
    const out = sanitizeAddedClasses(
      [{ subClass: "Z-9", marketValue2027: 1 }, { subClass: "UNCLASSIFIED", marketValue2027: 1 }],
      CTX
    );
    assert.deepEqual(out, []);
  });

  test("refuses an unusable value rather than printing junk", () => {
    for (const bad of [-5, "abc", 1e12, Infinity]) {
      assert.deepEqual(
        sanitizeAddedClasses([{ subClass: "C-2", marketValue2027: bad }], CTX),
        [],
        `accepted ${bad}`
      );
    }
  });

  test("drops duplicates within one payload", () => {
    const out = sanitizeAddedClasses(
      [
        { subClass: "C-2", marketValue2027: 1 },
        { subClass: "C-2", marketValue2027: 2 },
      ],
      CTX
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].marketValue2027, 1);
  });

  test("filters location groups down to real barangays", () => {
    const [row] = sanitizeAddedClasses(
      [
        {
          subClass: "C-2",
          marketValue2027: 100,
          locationGroups: [{ label: "Along the road", barangays: ["SACLIT", "nowhere"] }],
        },
      ],
      CTX
    );
    assert.deepEqual(row.locationGroups, [
      { label: "Along the road", barangays: ["saclit"] },
    ]);
  });

  test("caps how many can be added", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      subClass: `R-${i + 2}`,
      marketValue2027: 100,
    }));
    assert.equal(sanitizeAddedClasses(many, CTX).length, MAX_ADDED_CLASSES);
  });

  test("tolerates junk input", () => {
    for (const bad of [null, undefined, 42, "x", {}]) {
      assert.deepEqual(sanitizeAddedClasses(bad, CTX), []);
    }
  });
});

describe("sanitizeRemovedClasses", () => {
  test("keeps only codes actually in the transcription", () => {
    assert.deepEqual(sanitizeRemovedClasses(["C-1", "C-9", "bogus"], CTX), ["C-1"]);
  });

  test("normalizes case and drops duplicates", () => {
    assert.deepEqual(sanitizeRemovedClasses(["c-1", "C-1"], CTX), ["C-1"]);
  });
});

describe("mergeClassifications", () => {
  const base = [{ subClass: "C-1" }, { subClass: "C-3" }, { subClass: "R-1" }];

  test("inserts added rows in legend order, not at the end", () => {
    const added = sanitizeAddedClasses([{ subClass: "C-2", marketValue2027: 1 }], CTX);
    assert.deepEqual(
      mergeClassifications(base, added).map((r) => r.subClass),
      ["C-1", "C-2", "C-3", "R-1"]
    );
  });

  test("withdrawn classes disappear", () => {
    assert.deepEqual(
      mergeClassifications(base, [], ["C-3"]).map((r) => r.subClass),
      ["C-1", "R-1"]
    );
  });

  test("an added row never displaces an official one of the same code", () => {
    const added = [{ subClass: "C-1", marketValue2027: 99, added: true }];
    const merged = mergeClassifications(base, added);
    assert.equal(merged.filter((r) => r.subClass === "C-1").length, 1);
    assert.equal(merged.find((r) => r.subClass === "C-1").added, undefined);
  });

  test("returns the base untouched when there is nothing to do", () => {
    assert.equal(mergeClassifications(base, [], []), base);
  });
});

describe("addedClassValues", () => {
  test("contributes values to the printed legend, skipping valueless rows", () => {
    assert.deepEqual(
      addedClassValues([
        { subClass: "C-2", marketValue2027: 1800 },
        { subClass: "R-3", marketValue2027: null },
      ]),
      { "C-2": 1800 }
    );
  });
});

describe("categoryForClass", () => {
  test("maps codes to the legend column they belong in", () => {
    assert.equal(categoryForClass("C-4"), "commercial");
    assert.equal(categoryForClass("R-9"), "residential");
    assert.equal(categoryForClass("INSTITUTIONAL"), "institutional");
    assert.equal(categoryForClass("???"), "other");
  });
});
