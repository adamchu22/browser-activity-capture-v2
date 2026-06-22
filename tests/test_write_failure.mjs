// Regression tests for the storage-quota classifier (extension/src/write-failure.js).
//
// The bug this guards against: on a longer recording, Chrome's captureVisibleTab
// ~2/sec rate limit throws "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
// quota." — the word "quota" made the old /quota|storage/i classifier treat it as a
// full disk, so a healthy 17-min recording flipped the red `!` badge, wrote a false
// truncation error, and set manifest.storage_full = true. No data was lost. The
// classifier must say "storage full" ONLY for a real IndexedDB quota error, never for
// the screenshot throttle. See ISSUE-frame-ratelimit-misclassified-as-storage-full.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStorageQuotaError } from "../extension/src/write-failure.js";

// --- the false positive we're fixing -----------------------------------------

test("THE FIX: captureVisibleTab rate limit is NOT storage-full", () => {
  // The exact message Chrome throws (and the exact stack seen in the bad bundle).
  const e = new Error("This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.");
  assert.equal(isStorageQuotaError(e), false);
});

test("rate limit stays non-storage even if a name leaks in", () => {
  // Belt-and-suspenders: even if some layer mislabels the rate-limit error's name,
  // the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND text wins and excludes it.
  const e = new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded");
  e.name = "QuotaExceededError";
  assert.equal(isStorageQuotaError(e), false);
});

// --- the true positive that must keep working --------------------------------

test("a real IndexedDB QuotaExceededError IS storage-full (by name)", () => {
  const e = new Error("The quota has been exceeded.");
  e.name = "QuotaExceededError";
  assert.equal(isStorageQuotaError(e), true);
});

test("a storage error without the name is caught by message text", () => {
  assert.equal(isStorageQuotaError(new Error("IndexedDB write failed: storage is full")), true);
  assert.equal(isStorageQuotaError(new Error("not enough disk space to complete the operation")), true);
});

// --- boundaries ---------------------------------------------------------------

test("bare 'quota' in a message is NOT enough on its own", () => {
  // This is the crux: the old classifier matched bare /quota/ and that's exactly what
  // the rate limit (and other non-storage APIs) trip. Require a storage word instead.
  assert.equal(isStorageQuotaError(new Error("API quota exceeded for this request")), false);
});

test("unrelated errors are not storage-full", () => {
  assert.equal(isStorageQuotaError(new Error("Cannot access a chrome:// URL")), false);
  assert.equal(isStorageQuotaError(new TypeError("active is undefined")), false);
});

test("null / undefined / empty errors are safe", () => {
  assert.equal(isStorageQuotaError(null), false);
  assert.equal(isStorageQuotaError(undefined), false);
  assert.equal(isStorageQuotaError({}), false);
  assert.equal(isStorageQuotaError({ message: "" }), false);
});
