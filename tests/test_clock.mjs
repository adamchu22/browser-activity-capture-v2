// Regression tests for the paused-aware recording clock (extension/src/clock.js).
//
// The bug this guards against: hitting Pause then Resume made the on-screen timer
// JUMP FORWARD by the pause length, and frames/events stamped after a pause
// drifted past the (pause-excluding) video. The clock must subtract all paused
// time so it tracks video.webm. This matters more now that the blocklist
// auto-pauses on every sensitive-tab visit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingElapsed } from "../extension/src/clock.js";

const t0 = 1_000_000;

test("before go-live (t0 unset) the clock reads 0", () => {
  assert.equal(recordingElapsed(5000, { t0: 0 }), 0);
});

test("live, never paused → plain wall-clock since t0", () => {
  assert.equal(recordingElapsed(t0 + 5000, { t0 }), 5000);
});

test("after a completed pause, banked time is subtracted", () => {
  // recorded 10s, paused for 4s (banked), now 6s of wall-clock later while live
  assert.equal(recordingElapsed(t0 + 20_000, { t0, pausedAccum: 4000, paused: false }), 16_000);
});

test("THE FIX: clock does NOT jump on resume", () => {
  // At the instant of resume, pausedAccum has just absorbed the pause; elapsed must
  // equal the value it held when the pause began — no forward jump.
  const atPause = recordingElapsed(t0 + 10_000, { t0, paused: true, pauseStartedAt: t0 + 10_000, pausedAccum: 0 });
  const atResume = recordingElapsed(t0 + 14_000, { t0, paused: false, pausedAccum: 4000 });
  assert.equal(atPause, 10_000);
  assert.equal(atResume, 10_000); // 4s of pause elapsed, but the clock held steady
});

test("while paused, the clock is frozen (ongoing pause excluded)", () => {
  const start = { t0, paused: true, pauseStartedAt: t0 + 8000, pausedAccum: 0 };
  assert.equal(recordingElapsed(t0 + 8000, start), 8000); // moment of pause
  assert.equal(recordingElapsed(t0 + 11_000, start), 8000); // 3s into the pause — still 8s
  assert.equal(recordingElapsed(t0 + 20_000, start), 8000); // 12s into the pause — still 8s
});

test("never negative", () => {
  assert.equal(recordingElapsed(t0, { t0, pausedAccum: 9999 }), 0);
});
