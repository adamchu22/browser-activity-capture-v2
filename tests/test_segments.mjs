// Tests for the pure video-segment logic (extension/src/segments.js).
//
// The re-share feature seals dead-recorder chunks into segments and concatenates
// them at finalize. These are the pure, DOM-free pieces; the offscreen doc
// supplies the real Blobs. Run from the project root:  node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { concatSegments, segmentOffsetsFor, sealSegment } from "../extension/src/segments.js";

// A stand-in for a MediaRecorder chunk (a Blob). Blob is available in Node 18+.
function chunk(size = 100, type = "video/webm") {
  return new Blob([new Uint8Array(size)], { type });
}

test("concatSegments returns null for an empty list (no video at all)", () => {
  assert.equal(concatSegments([]), null);
  assert.equal(concatSegments(null), null);
});

test("concatSegments drops zero-size segments but keeps the rest", () => {
  const segs = [
    { blob: new Blob([new Uint8Array(50)], { type: "video/webm" }), offsetMs: 0 },
    { blob: new Blob([], { type: "video/webm" }), offsetMs: 1000 }, // empty
    { blob: new Blob([new Uint8Array(30)], { type: "video/webm" }), offsetMs: 2000 },
  ];
  const out = concatSegments(segs);
  assert.ok(out instanceof Blob);
  assert.equal(out.size, 80, "concatenated size = sum of non-empty segments");
  assert.equal(out.type, "video/webm");
});

test("concatSegments returns a single Blob when one segment is present", () => {
  const segs = [{ blob: new Blob([new Uint8Array(40)], { type: "video/webm" }), offsetMs: 0 }];
  const out = concatSegments(segs);
  assert.equal(out.size, 40);
});

test("concatSegments concatenates multiple segments byte-accurate", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  const c = new Uint8Array([6, 7, 8, 9]);
  const segs = [
    { blob: new Blob([a], { type: "video/webm" }), offsetMs: 0 },
    { blob: new Blob([b], { type: "video/webm" }), offsetMs: 1000 },
    { blob: new Blob([c], { type: "video/webm" }), offsetMs: 2000 },
  ];
  const out = concatSegments(segs);
  assert.equal(out.size, 9);
  // Read the bytes back to confirm order + content.
  return out.arrayBuffer().then((buf) => {
    assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

test("concatSegments returns null when ALL segments are empty", () => {
  const segs = [
    { blob: new Blob([], { type: "video/webm" }), offsetMs: 0 },
    { blob: new Blob([], { type: "video/webm" }), offsetMs: 1000 },
  ];
  assert.equal(concatSegments(segs), null);
});

test("segmentOffsetsFor returns [] for no segments (normal single-take)", () => {
  assert.deepEqual(segmentOffsetsFor([]), []);
  assert.deepEqual(segmentOffsetsFor(null), []);
});

test("segmentOffsetsFor maps each segment to {offset_ms, file}", () => {
  const segs = [
    { blob: chunk(), offsetMs: 0 },
    { blob: chunk(), offsetMs: 12000 },
    { blob: chunk(), offsetMs: 45000 },
  ];
  assert.deepEqual(segmentOffsetsFor(segs), [
    { offset_ms: 0, file: "video.webm" },
    { offset_ms: 12000, file: "video-2.webm" },
    { offset_ms: 45000, file: "video-3.webm" },
  ]);
});

test("segmentOffsetsFor names the first segment video.webm always", () => {
  const segs = [{ blob: chunk(), offsetMs: 0 }];
  assert.deepEqual(segmentOffsetsFor(segs), [{ offset_ms: 0, file: "video.webm" }]);
});

test("segmentOffsetsFor defaults a missing offset to 0", () => {
  const segs = [{ blob: chunk() }, { blob: chunk(), offsetMs: null }];
  assert.deepEqual(segmentOffsetsFor(segs), [
    { offset_ms: 0, file: "video.webm" },
    { offset_ms: 0, file: "video-2.webm" },
  ]);
});

test("sealSegment returns null for empty chunks (recorder produced nothing)", () => {
  assert.equal(sealSegment([], 0), null);
  assert.equal(sealSegment(null, 0), null);
});

test("sealSegment returns a segment with a Blob + the offset", () => {
  const chunks = [chunk(50), chunk(30)];
  const seg = sealSegment(chunks, 12000);
  assert.ok(seg);
  assert.ok(seg.blob instanceof Blob);
  assert.equal(seg.blob.size, 80);
  assert.equal(seg.offsetMs, 12000);
});

test("sealSegment defaults a missing offset to 0", () => {
  const seg = sealSegment([chunk(10)], undefined);
  assert.ok(seg);
  assert.equal(seg.offsetMs, 0);
});