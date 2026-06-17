// Regression tests for the tab-navigation re-attach contract.
//
// The bug these lock down: on a server-rendered app every click is a full-page
// navigation that destroys the content script while the CDP debugger stays
// attached — so without a "reattach" on navigation, network keeps recording but
// clicks/rrweb/frames silently die after the first nav. See learnings.md 2026-06-17.

import { test } from "node:test";
import assert from "node:assert/strict";
import { navActions } from "../extension/src/nav-policy.js";

const REC = { recording: true, eligible: true, tracked: true };

test("not recording → do nothing, ever", () => {
  assert.deepEqual(navActions({ status: "loading" }, { ...REC, recording: false }), []);
  assert.deepEqual(navActions({ status: "complete" }, { ...REC, recording: false }), []);
  assert.deepEqual(navActions({ url: "https://x" }, { ...REC, recording: false }), []);
});

test("ineligible tab (chrome://, web store) → do nothing", () => {
  assert.deepEqual(navActions({ status: "loading" }, { ...REC, eligible: false }), []);
  assert.deepEqual(navActions({ status: "complete" }, { ...REC, eligible: false }), []);
});

test("first sight of an eligible tab (loading) → instrument", () => {
  // A brand-new tab isn't tracked yet — still instrument it.
  assert.deepEqual(navActions({ status: "loading" }, { ...REC, tracked: false }), ["instrument"]);
});

test("THE FIX: a tracked tab finishing a navigation → reattach", () => {
  assert.deepEqual(navActions({ status: "complete" }, REC), ["reattach"]);
});

test("THE FIX: an in-place URL change (SPA pushState) on a tracked tab → reattach", () => {
  assert.deepEqual(navActions({ url: "https://app/x" }, REC), ["reattach"]);
});

test("complete on an UNtracked tab → no reattach (nothing to re-arm yet)", () => {
  assert.deepEqual(navActions({ status: "complete" }, { ...REC, tracked: false }), []);
});

test("a 'complete' event that is also first sight does both", () => {
  // Chrome can deliver loading and complete; if a single event ever carried
  // both signals for a tracked tab, we'd instrument and reattach — harmless,
  // both are idempotent. (status can't be two values, so this is the url case.)
  const actions = navActions({ status: "loading", url: "https://app/x" }, REC);
  assert.ok(actions.includes("instrument"));
  assert.ok(actions.includes("reattach"));
});
