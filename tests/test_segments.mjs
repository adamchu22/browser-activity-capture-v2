// Tests for the pure video-segment logic (extension/src/segments.js).
//
// The re-share feature seals dead-recorder chunks into segments. Segments are
// never byte-concatenated (each MediaRecorder segment restarts its PTS at 0, so
// a byte-concat breaks ffmpeg seeks); each file keeps its own recording-clock
// offset via segmentOffsetsFor. These are the pure, DOM-free pieces; the
// offscreen doc supplies the real Blobs. Run: node --test tests/test_segments.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentOffsetsFor, sealSegment } from "../extension/src/segments.js";

// A stand-in for a MediaRecorder chunk (a Blob). Blob is available in Node 18+.
function chunk(size = 100, type = "video/webm") {
  return new Blob([new Uint8Array(size)], { type });
}

test("segmentOffsetsFor returns [] for an empty list (no video at all)", () => {
  assert.deepEqual(segmentOffsetsFor([]), []);
  assert.deepEqual(segmentOffsetsFor(null), []);
});

test("segmentOffsetsFor names the first segment video.webm and the rest video-N.webm", () => {
  const segs = [
    { blob: new Blob([new Uint8Array(50)], { type: "video/webm" }), offsetMs: 0 },
    { blob: new Blob([new Uint8Array(30)], { type: "video/webm" }), offsetMs: 2000 },
    { blob: new Blob([new Uint8Array(10)], { type: "video/webm" }), offsetMs: 5000 },
  ];
  const out = segmentOffsetsFor(segs);
  assert.equal(out.length, 3);
  assert.equal(out[0].file, "video.webm");
  assert.equal(out[0].offset_ms, 0);
  assert.equal(out[1].file, "video-3.webm".replace("3", "2"), "second file is video-2.webm");
  assert.equal(out[1].file, "video-2.webm");
  assert.equal(out[2].file, "video-3.webm");
  assert.equal(out[2].offset_ms, 5000, "offset preserved from the segment");
});

test("segmentOffsetsFor defaults a missing offsetMs to 0", () => {
  const out = segmentOffsetsFor([{ blob: chunk(10) }]);
  assert.equal(out[0].offset_ms, 0);
});

test("sealSegment returns null for empty chunk lists (no zero-byte segments)", () => {
  assert.equal(sealSegment([], 1000), null);
  assert.equal(sealSegment(null, 1000), null);
});

test("sealSegment wraps chunks into a webm Blob with the given offset", () => {
  const seg = sealSegment([chunk(40), chunk(60)], 1500);
  assert.ok(seg.blob instanceof Blob);
  assert.equal(seg.blob.size, 100, "blob size = sum of chunk sizes");
  assert.equal(seg.blob.type, "video/webm");
  assert.equal(seg.offsetMs, 1500);
});

test("sealSegment defaults a missing offsetMs to 0", () => {
  const seg = sealSegment([chunk(20)], undefined);
  assert.equal(seg.offsetMs, 0);
});