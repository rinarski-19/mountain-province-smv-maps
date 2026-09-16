// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Page fit. The legend block is never shorter than ~97 mm (its ten
// landmark rows alone are 52 mm), and barangay sheets reserve a footer
// for it. That reserve used to be a hardcoded 62 mm on landscape, so the
// legend covered the map by 39–47 mm on every landscape barangay sheet.
// These pin the reserve to the legend's real height.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  PAGE_MARGIN_MM,
  infoLabelColumnMm,
  legendBlockHeightMm,
  legendBlockWidthMm,
  paperSizeForOrientation,
  printMapFitFrame,
} = await mod("lib/print-svg-builder.js");
const { LANDMARK_KIND_OPTIONS } = await mod("lib/landmark-icons.js");

// The floor: no SMV classes at all, but the road and landmark columns are
// always drawn.
const floorHeight = (hasBarangayTarget) =>
  legendBlockHeightMm({ landmarkCount: LANDMARK_KIND_OPTIONS.length, hasBarangayTarget });

describe("legendBlockHeightMm", () => {
  test("has a floor set by the fixed road and landmark columns", () => {
    assert.ok(floorHeight(false) > 90, `floor was ${floorHeight(false)}mm`);
  });

  test("grows with the class ladder", () => {
    const short = legendBlockHeightMm({ commercialCount: 1, residentialCount: 1, landmarkCount: 10 });
    const long = legendBlockHeightMm({ commercialCount: 12, residentialCount: 15, landmarkCount: 10 });
    assert.ok(long > short, "a deeper ladder must reserve more height");
  });

  test("a barangay sheet is taller than a whole-LGU one (extra BARANGAY row)", () => {
    assert.ok(floorHeight(true) > floorHeight(false));
  });
});

describe("printMapFitFrame", () => {
  test("whole-municipality sheets get no forced frame", () => {
    assert.equal(printMapFitFrame(297, 420, "portrait", false, 100), null);
  });

  test("landscape puts the legend beside the map, not under it", () => {
    // A3 landscape is 297mm tall and the legend is never under ~97mm, so a
    // full-width footer cost a third of the sheet while leaving the
    // bottom-left empty.
    const h = legendBlockHeightMm({ commercialCount: 12, residentialCount: 12, landmarkCount: 10, hasBarangayTarget: true });
    const w = legendBlockWidthMm();
    const frame = printMapFitFrame(420, 297, "landscape", true, h, w);
    assert.ok(frame.height > 250, `map frame only ${frame.height.toFixed(0)}mm tall`);
    assert.ok(frame.x + frame.width <= 420 - w, "map frame runs into the legend column");
  });

  for (const orientation of ["portrait", "landscape"]) {
    test(`${orientation}: the map frame never overlaps the legend`, () => {
      const { widthMm: W, heightMm: H } = paperSizeForOrientation(orientation);
      // Sweep the whole plausible range of legend heights, including the
      // deepest ladder in the province (Tadian, C-1..C-12 + R-1..R-12).
      for (let commercial = 0; commercial <= 12; commercial++) {
        for (const residential of [0, 7, 15]) {
          const legendH = legendBlockHeightMm({
            commercialCount: commercial,
            residentialCount: residential,
            institutionalCount: 1,
            landmarkCount: LANDMARK_KIND_OPTIONS.length,
            hasBarangayTarget: true,
          });
          const legendW = legendBlockWidthMm();
          const frame = printMapFitFrame(W, H, orientation, true, legendH, legendW);
          // The legend sits bottom-right; the frame must clear it either
          // vertically (portrait) or horizontally (landscape).
          const legendTop = H - PAGE_MARGIN_MM - legendH;
          const legendLeft = W - PAGE_MARGIN_MM - legendW;
          const clearsVertically = frame.y + frame.height <= legendTop + 0.01;
          const clearsHorizontally = frame.x + frame.width <= legendLeft + 0.01;
          assert.ok(
            clearsVertically || clearsHorizontally,
            `${orientation} c${commercial}/r${residential}: frame ` +
              `${frame.width.toFixed(0)}x${frame.height.toFixed(0)} at ${frame.x.toFixed(0)},${frame.y.toFixed(0)} ` +
              `overlaps legend at ${legendLeft.toFixed(0)},${legendTop.toFixed(0)}`
          );
          assert.ok(frame.height > 100, `${orientation}: map frame collapsed to ${frame.height}mm`);
          assert.ok(frame.x >= 0 && frame.x + frame.width <= W + 0.01);
        }
      }
    });
  }

  test("portrait reserve tracks the legend rather than a constant", () => {
    const small = printMapFitFrame(297, 420, "portrait", true, 80);
    const large = printMapFitFrame(297, 420, "portrait", true, 120);
    assert.ok(
      small.height > large.height,
      "a taller legend must leave the map less room, not the same room"
    );
  });

  test("the title-block label column widens for long captions", () => {
    // Every caption there is user-editable, so a fixed column clipped.
    const stock = infoLabelColumnMm(["MUNICIPALITY:", "PROVINCE OF:"]);
    const long = infoLabelColumnMm(["BOUNDARY SHOWN:", "MUNICIPALITY:"]);
    assert.ok(long > stock, "a longer caption must widen the column");
    assert.ok(stock >= 28, "must never go below the original width");
    assert.ok(
      legendBlockWidthMm(["A VERY LONG EDITABLE CAPTION INDEED:"]) > legendBlockWidthMm([]),
      "the legend box must grow to hold a long caption"
    );
  });
});
