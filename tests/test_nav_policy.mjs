// Regression tests for the tab-navigation policy. Two contracts (see nav-policy.js):
//   1. Re-attach on navigation — else capture dies after the first full-page nav
//      on a server-rendered app (network survives, clicks/rrweb/frames don't).
//   2. Capture only tabs the user enters — a background tab loading must NOT be
//      instrumented (that swept up password-manager / chat / calendar tabs).
// See learnings.md 2026-06-17.

import { test } from "node:test";
import assert from "node:assert/strict";
import { navActions } from "../extension/src/nav-policy.js";

// recording, eligible, tracked, active
const base = { recording: true, eligible: true, tracked: true, active: true };

test("not recording → do nothing, ever", () => {
  assert.deepEqual(navActions({ status: "complete" }, { ...base, recording: false }), []);
  assert.deepEqual(navActions({ url: "https://x" }, { ...base, recording: false }), []);
});

test("ineligible tab (chrome://, web store) → do nothing", () => {
  assert.deepEqual(navActions({ status: "complete" }, { ...base, eligible: false }), []);
});

test("THE FIX: a tracked tab finishing a navigation → reattach", () => {
  assert.deepEqual(navActions({ status: "complete" }, base), ["reattach"]);
});

test("THE FIX: an in-place URL change (SPA pushState) on a tracked tab → reattach", () => {
  assert.deepEqual(navActions({ url: "https://app/x" }, base), ["reattach"]);
});

test("PRIVACY: a background (inactive) untracked tab loading → do NOTHING", () => {
  // The whole point of the lazy model: a tab the user never entered must not be
  // instrumented just because it finished loading.
  assert.deepEqual(navActions({ status: "complete" }, { ...base, tracked: false, active: false }), []);
});

test("active untracked tab finishing a load → instrument (e.g. recording tab left chrome://)", () => {
  assert.deepEqual(navActions({ status: "complete" }, { ...base, tracked: false }), ["instrument"]);
});

test("active untracked tab still LOADING → wait (instrument on complete, not loading)", () => {
  assert.deepEqual(navActions({ status: "loading" }, { ...base, tracked: false }), []);
});

test("tracked tab still loading → no action yet (reattach happens on complete/url)", () => {
  assert.deepEqual(navActions({ status: "loading" }, base), []);
});
