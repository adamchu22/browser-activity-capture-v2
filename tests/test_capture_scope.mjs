import { test } from "node:test";
import assert from "node:assert/strict";
import { inCaptureScope } from "../extension/src/capture-scope.js";

const tab = (id, windowId) => ({ id, windowId });

test("browser (tab share): only the start tab is in scope", () => {
  const ctx = { surface: "browser", captureTabId: 5, captureWindowId: 1 };
  assert.equal(inCaptureScope(tab(5, 1), ctx), true);
  assert.equal(inCaptureScope(tab(6, 1), ctx), false); // another tab, same window → out
  assert.equal(inCaptureScope(tab(5, 9), ctx), true); // same tab even if window id differs
});

test("window share: only tabs in the start window are in scope", () => {
  const ctx = { surface: "window", captureTabId: 5, captureWindowId: 1 };
  assert.equal(inCaptureScope(tab(5, 1), ctx), true); // start tab
  assert.equal(inCaptureScope(tab(7, 1), ctx), true); // sibling tab in the same window
  assert.equal(inCaptureScope(tab(8, 2), ctx), false); // a tab in another window → out
});

test("monitor (screen share): not display-scoped in v1 — everywhere is in scope", () => {
  const ctx = { surface: "monitor", captureTabId: 5, captureWindowId: 1 };
  assert.equal(inCaptureScope(tab(8, 2), ctx), true);
  assert.equal(inCaptureScope(tab(99, 99), ctx), true);
});

test("unknown/null surface defaults to in-scope (never under-captures)", () => {
  assert.equal(inCaptureScope(tab(8, 2), { surface: null, captureTabId: 5, captureWindowId: 1 }), true);
  assert.equal(inCaptureScope(tab(8, 2), {}), true);
});

test("a null tab is never in scope", () => {
  assert.equal(inCaptureScope(null, { surface: "window", captureWindowId: 1 }), false);
});
