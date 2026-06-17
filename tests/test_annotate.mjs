// Tests for the Draw annotation geometry (extension/src/annotate-geom.js).
// Contract: viewport-pixel stroke points → resolution-independent %-coords + bbox,
// so pack.py can place the highlight on a frame of any size. content.js keeps a
// verbatim copy of drawGeom — if these change, update content.js too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { drawGeom } from "../extension/src/annotate-geom.js";

const VP = { w: 1000, h: 500 };

test("empty stroke → no points, null bbox, viewport preserved", () => {
  const g = drawGeom([], VP);
  assert.deepEqual(g.points, []);
  assert.equal(g.bbox, null);
  assert.deepEqual(g.viewport, VP);
});

test("points convert to percent of the viewport", () => {
  const g = drawGeom([{ x: 250, y: 250 }, { x: 500, y: 100 }], VP);
  assert.deepEqual(g.points, [
    { xpct: 25, ypct: 50 },
    { xpct: 50, ypct: 20 },
  ]);
});

test("bbox spans the min/max of the stroke", () => {
  const g = drawGeom(
    [{ x: 100, y: 50 }, { x: 300, y: 250 }, { x: 200, y: 150 }],
    VP
  );
  // x: 10%..30%, y: 10%..50%
  assert.deepEqual(g.bbox, { xpct: 10, ypct: 10, wpct: 20, hpct: 40 });
});

test("a single point → zero-size bbox at that point", () => {
  const g = drawGeom([{ x: 500, y: 250 }], VP);
  assert.deepEqual(g.bbox, { xpct: 50, ypct: 50, wpct: 0, hpct: 0 });
  assert.deepEqual(g.points, [{ xpct: 50, ypct: 50 }]);
});

test("percentages round to 0.1% (small payloads, sub-pixel on 1080p)", () => {
  const g = drawGeom([{ x: 333, y: 167 }], VP);
  // 333/1000 = 33.3%, 167/500 = 33.4%
  assert.deepEqual(g.points, [{ xpct: 33.3, ypct: 33.4 }]);
});

test("zero-size viewport → 0% (no divide-by-zero), bbox still emitted", () => {
  const g = drawGeom([{ x: 10, y: 10 }, { x: 20, y: 20 }], { w: 0, h: 0 });
  assert.deepEqual(g.points, [{ xpct: 0, ypct: 0 }, { xpct: 0, ypct: 0 }]);
  assert.deepEqual(g.bbox, { xpct: 0, ypct: 0, wpct: 0, hpct: 0 });
});

test("missing viewport defaults to 0×0 without throwing", () => {
  const g = drawGeom([{ x: 10, y: 10 }]);
  assert.deepEqual(g.viewport, { w: 0, h: 0 });
  assert.deepEqual(g.points, [{ xpct: 0, ypct: 0 }]);
});
