import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSession, applySession } from "../extension/src/session.js";

// A representative live-recording state, the way background.js holds it.
function liveState() {
  return {
    recording: true,
    arming: false,
    t0: 1_700_000_000_000,
    paused: true,
    manualPaused: false,
    autoPaused: true,
    pauseReason: "blocklist",
    pausedAccum: 4200,
    pauseStartedAt: 1_700_000_050_000,
    task: "test a checkout flow",
    purposes: ["ux", "improve"],
    blocklist: ["1password.com"],
    micActive: true,
    videoEndedEarly: false,
    captureSurface: "window",
    captureTabId: 7,
    captureWindowId: 3,
    activeTabId: 7,
    tabIds: new Set([7, 9]),
    tabs: new Map([
      [7, { id: 7, url: "https://shop.example/cart", title: "Cart" }],
      [9, { id: 9, url: "https://shop.example/pay", title: "Pay" }],
    ]),
    urls: new Set(["https://shop.example/cart", "https://shop.example/pay"]),
    errors: [{ t: 10, where: "debugger", message: "x", stack: null }],
  };
}

test("serializeSession returns null when no live recording", () => {
  assert.equal(serializeSession(null), null);
  assert.equal(serializeSession({ recording: false }), null);
  assert.equal(serializeSession({ recording: false, t0: 123 }), null);
});

test("serialize → JSON round-trip → apply restores an equivalent state", () => {
  const src = liveState();
  const record = serializeSession(src);
  // Must survive storage (JSON), i.e. no Set/Map leaked into the record.
  const reparsed = JSON.parse(JSON.stringify(record));

  const restored = applySession({}, reparsed);

  // Scalars
  assert.equal(restored.recording, true);
  assert.equal(restored.arming, false);
  assert.equal(restored.t0, src.t0);
  assert.equal(restored.paused, true);
  assert.equal(restored.autoPaused, true);
  assert.equal(restored.pauseReason, "blocklist");
  assert.equal(restored.pausedAccum, 4200);
  assert.equal(restored.pauseStartedAt, src.pauseStartedAt);
  assert.equal(restored.task, "test a checkout flow");
  assert.deepEqual(restored.purposes, ["ux", "improve"]);
  assert.deepEqual(restored.blocklist, ["1password.com"]);
  assert.equal(restored.micActive, true);
  assert.equal(restored.captureSurface, "window");
  assert.equal(restored.captureTabId, 7);
  assert.equal(restored.captureWindowId, 3);
  assert.equal(restored.activeTabId, 7);

  // Collections come back as Set/Map with the right contents
  assert.ok(restored.tabIds instanceof Set);
  assert.deepEqual([...restored.tabIds].sort(), [7, 9]);
  assert.ok(restored.tabs instanceof Map);
  assert.equal(restored.tabs.get(9).url, "https://shop.example/pay");
  assert.ok(restored.urls instanceof Set);
  assert.equal(restored.urls.size, 2);
  assert.equal(restored.errors.length, 1);
});

test("the persisted record is JSON-safe (no Set/Map values)", () => {
  const record = serializeSession(liveState());
  assert.ok(Array.isArray(record.tabIds));
  assert.ok(Array.isArray(record.tabs));
  assert.ok(Array.isArray(record.urls));
  // A clean JSON clone must equal the original record (would throw/diverge on a Set).
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test("applySession tolerates a partial/empty record", () => {
  const restored = applySession({}, { recording: true });
  assert.equal(restored.recording, true);
  assert.equal(restored.t0, 0);
  assert.ok(restored.tabIds instanceof Set);
  assert.equal(restored.tabIds.size, 0);
  assert.ok(restored.tabs instanceof Map);
  assert.deepEqual(restored.purposes, []);
});

test("the snapshot caps errors + urls so a long session can't overflow storage quota", () => {
  const src = liveState();
  // A pathological session: an error storm + thousands of navigations.
  src.errors = Array.from({ length: 5000 }, (_, i) => ({ t: i, where: "x", message: "e" + i, stack: null }));
  src.urls = new Set(Array.from({ length: 5000 }, (_, i) => `https://e/${i}`));
  const rec = serializeSession(src);
  assert.equal(rec.errors.length, 50, "errors capped to the most-recent 50");
  assert.equal(rec.urls.length, 1000, "urls capped to the most-recent 1000");
  // Capped to the MOST RECENT, not the oldest.
  assert.equal(rec.errors[rec.errors.length - 1].message, "e4999");
  assert.equal(rec.urls[rec.urls.length - 1], "https://e/4999");
});

test("storageFull round-trips so a recovered recording stays flagged as truncated", () => {
  const src = liveState();
  src.storageFull = true;
  const restored = applySession({}, JSON.parse(JSON.stringify(serializeSession(src))));
  assert.equal(restored.storageFull, true);
});

test("a paused recording round-trips its pause accounting (clock stays aligned)", () => {
  const src = liveState();
  const restored = applySession({}, serializeSession(src));
  // These four drive clock.js recordingElapsed — they must survive verbatim.
  assert.equal(restored.t0, src.t0);
  assert.equal(restored.pausedAccum, src.pausedAccum);
  assert.equal(restored.pauseStartedAt, src.pauseStartedAt);
  assert.equal(restored.paused, src.paused);
});
