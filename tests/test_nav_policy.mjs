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

test("THE FIX: an in-place URL change (SPA pushState) on a tracked tab → reattach + emitnav", () => {
  // No status transition = the content script isn't torn down and won't emit a nav,
  // so the worker must log it (B3). reattach re-arms belt-and-suspenders.
  assert.deepEqual(navActions({ url: "https://app/x" }, base), ["reattach", "emitnav"]);
});

test("B3: a full-page nav (status:loading + url) → reattach only, NOT emitnav", () => {
  // The reloaded content script emits its own nav on startCapture, so emitting one
  // here too would double-log. Gate emitnav on the absence of a status field.
  assert.deepEqual(navActions({ status: "loading", url: "https://app/y" }, base), ["reattach"]);
});

test("B3: emitnav requires a tracked tab (an untracked SPA url change is ignored)", () => {
  assert.deepEqual(navActions({ url: "https://app/z" }, { ...base, tracked: false, active: false }), []);
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
