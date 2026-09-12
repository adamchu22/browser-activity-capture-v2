// Tests for the shared bulk-stream assembly (extension/src/bundle-streams.js).
// Contract: raw IndexedDB records (timeline / rrweb / frames) → bundle file entries
// identical to what the old in-worker assembleBundle produced, with the autoincrement
// `seq` key stripped and frame data URLs turned into real PNG bytes. The worker
// (salvage) and the offscreen doc (normal export) both rely on this, so it must be
// exact — this is the seam that keeps a 17-min recording off the 64MiB message path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { streamFiles, frameMeta, dataUrlToBytes } from "../extension/src/bundle-streams.js";

// "AB" → base64 "QUI=" → data URL.
const AB = "data:image/png;base64,QUI=";

test("dataUrlToBytes decodes the base64 payload", () => {
  assert.deepEqual([...dataUrlToBytes(AB)], [0x41, 0x42]); // 'A','B'
});

test("dataUrlToBytes tolerates empty / malformed input", () => {
  assert.equal(dataUrlToBytes("").length, 0);
  assert.equal(dataUrlToBytes(null).length, 0);
  assert.equal(dataUrlToBytes("data:image/png;base64,").length, 0);
});

test("frameMeta drops the heavy dataUrl, keeps t + file", () => {
  const frames = [
    { seq: 1, t: 100, file: "frames/0000000100.png", dataUrl: AB },
    { seq: 2, t: 200, file: "frames/0000000200.png", dataUrl: AB },
  ];
  assert.deepEqual(frameMeta(frames), [
    { t: 100, file: "frames/0000000100.png" },
    { t: 200, file: "frames/0000000200.png" },
  ]);
});

test("streamFiles strips seq from timeline.json", () => {
  const files = streamFiles([{ seq: 5, t: 1, kind: "click" }], [], []);
  const tl = files.find((f) => f.name === "timeline.json");
  const parsed = JSON.parse(tl.data);
  assert.deepEqual(parsed, [{ t: 1, kind: "click" }]);
  assert.ok(!("seq" in parsed[0]));
});

test("streamFiles writes events.jsonl as one JSON object per line, seq stripped", () => {
  const rrweb = [
    { seq: 1, type: 2, t: 0 },
    { seq: 2, type: 3, t: 10 },
  ];
  const files = streamFiles([], rrweb, []);
  const ev = files.find((f) => f.name === "events.jsonl");
  const lines = ev.data.split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { type: 2, t: 0 });
  assert.deepEqual(JSON.parse(lines[1]), { type: 3, t: 10 });
});

test("streamFiles emits each frame as PNG bytes under its stored file name", () => {
  const frames = [{ seq: 1, t: 100, file: "frames/0000000100.png", dataUrl: AB }];
  const files = streamFiles([], [], frames);
  const png = files.find((f) => f.name === "frames/0000000100.png");
  assert.ok(png, "frame file present");
  assert.ok(png.data instanceof Uint8Array);
  assert.deepEqual([...png.data], [0x41, 0x42]);
});

test("streamFiles always includes the three text streams, even when empty", () => {
  const files = streamFiles([], [], []);
  const names = files.map((f) => f.name);
  assert.deepEqual(names, ["timeline.json", "events.jsonl", "network.har"]);
  assert.equal(files.find((f) => f.name === "events.jsonl").data, "");
});

// network.har moved OFF the sendMessage path and in here: per-entry body caps bound
// each request, nothing bounds the request count, and a long take blew the 64MiB cap
// and killed the whole export. Same shape the worker used to emit.
test("streamFiles builds network.har, stripping worker bookkeeping fields", () => {
  const har = [
    {
      seq: 3,
      requestId: "1000.4",
      _t: 12,
      _start: 0.5,
      _tab: 7,
      _sameSite: true,
      _wantBody: true,
      startedDateTime: "2026-09-03T00:00:00.000Z",
      request: { method: "GET", url: "https://app.example.com/api/x" },
      response: { status: 200 },
    },
  ];
  const files = streamFiles([], [], [], har, 1756857600000);
  const { log } = JSON.parse(files.find((f) => f.name === "network.har").data);
  assert.equal(log.version, "1.2");
  assert.match(log.comment, /t0_wall=1756857600000/);
  assert.equal(log.entries.length, 1);
  const e = log.entries[0];
  assert.deepEqual(Object.keys(e).sort(), ["_t", "_tab", "request", "response", "startedDateTime"]);
  assert.equal(e._t, 12);
  assert.equal(e._tab, 7);
  assert.equal(e.request.url, "https://app.example.com/api/x");
});

test("streamFiles emits a valid empty HAR when nothing was captured", () => {
  const { log } = JSON.parse(streamFiles([], [], []).find((f) => f.name === "network.har").data);
  assert.deepEqual(log.entries, []);
  assert.equal(log.version, "1.2");
});
