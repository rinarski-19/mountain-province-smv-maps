// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Counting and reassigning the zones drawn in an SMV class. Removing a
// class that still has polygons is the failure these guard against:
// Paracelis has 148 zones in C-1, and stranding them would leave shapes
// on the printed sheet classified as something the legend no longer
// mentions.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mod } from "../helpers/paths.mjs";

const { reassignZones, zoneCountsByClass, zonesFileName } = await mod(
  "lib/zone-usage.js"
);

// A scratch data dir, so nothing here can touch public/data/.
let dir;
const SLUG = "testville";
const poly = (id, classification) => ({
  type: "Feature",
  properties: { classification, parcel: id },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "zone-usage-"));
  await fs.writeFile(
    path.join(dir, zonesFileName(SLUG)),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        poly(1, "C-1"),
        poly(2, "C-1"),
        poly(3, "R-2"),
        poly(4, "r-2"), // lowercase in the data
        poly(5, undefined), // unclassified junk
      ],
    })
  );
});
after(() => fs.rm(dir, { recursive: true, force: true }));

describe("zoneCountsByClass", () => {
  test("counts by class, case-insensitively, ignoring unclassified", () => {
    assert.deepEqual(zoneCountsByClass(SLUG, dir), { "C-1": 2, "R-2": 2 });
  });

  test("a municipality with no zones file counts as empty, not an error", () => {
    assert.deepEqual(zoneCountsByClass("nosuch", dir), {});
  });
});

describe("reassignZones", () => {
  test("moves every matching zone and reports how many", () => {
    const { moved, serialized } = reassignZones(SLUG, dir, "C-1", "R-2");
    assert.equal(moved, 2);
    const out = JSON.parse(serialized);
    const isClass = (f, c) =>
      String(f.properties.classification ?? "").toUpperCase() === c;
    assert.equal(out.features.filter((f) => isClass(f, "C-1")).length, 0);
    // Compared case-insensitively on purpose: the fixture has one zone
    // stored as lowercase "r-2", and reassignZones deliberately does not
    // rewrite features it was not asked to move.
    assert.equal(out.features.filter((f) => isClass(f, "R-2")).length, 4);
  });

  test("never drops or adds a feature, and leaves geometry alone", () => {
    const { serialized } = reassignZones(SLUG, dir, "C-1", "R-2");
    const out = JSON.parse(serialized);
    assert.equal(out.features.length, 5);
    assert.ok(out.features.every((f) => f.geometry?.coordinates?.length));
    // Other properties survive the rewrite.
    assert.deepEqual(
      out.features.map((f) => f.properties.parcel),
      [1, 2, 3, 4, 5]
    );
  });

  test("matches case-insensitively", () => {
    assert.equal(reassignZones(SLUG, dir, "r-2", "C-3").moved, 2);
  });

  test("moving a class with no zones is a no-op, not a failure", () => {
    assert.equal(reassignZones(SLUG, dir, "R-9", "R-1").moved, 0);
  });

  test("refuses a no-op or malformed request", () => {
    for (const [from, to] of [["R-2", "R-2"], ["", "R-2"], ["R-2", ""], [null, null]]) {
      assert.throws(() => reassignZones(SLUG, dir, from, to), /must be different/);
    }
  });

  test("a missing zones file is a 404, not a crash", () => {
    assert.throws(
      () => reassignZones("nosuch", dir, "C-1", "R-1"),
      (e) => e.status === 404
    );
  });
});

describe("reassignZones destination validation", () => {
  test("refuses a destination that is not a real class", () => {
    // Regression: the only guard was from !== to, so "Z-99" — and even
    // "  ", which is truthy after toUpperCase — rewrote real polygons to a
    // classification nothing in the app can select, show or undo.
    for (const to of ["Z-99", "nonsense", "  ", "\t"]) {
      assert.throws(
        () => reassignZones(SLUG, dir, "C-1", to),
        (e) => e.status === 400,
        `accepted destination ${JSON.stringify(to)}`
      );
    }
  });

  test("accepts every code the catalogue defines, including UNCLASSIFIED", () => {
    for (const to of ["R-2", "r-2 ", "INSTITUTIONAL", "UNCLASSIFIED"]) {
      if (to.trim().toUpperCase() === "C-1") continue;
      assert.doesNotThrow(() => reassignZones(SLUG, dir, "C-1", to), `rejected ${to}`);
    }
  });
});
