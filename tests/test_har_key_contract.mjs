// Regression test for the v2 HAR key-mismatch bug (review F001, confirmed real):
// background.js keys HAR entries by requestKey (a target/session-scoped composite:
// JSON.stringify([tabId, sessionId, requestId])) so debugger-target changes can't
// collide entries across tabs/sessions. loadingFinished MUST look the entry up by the
// same key — an earlier v2 revision looked it up by the raw CDP params.requestId,
// which never matched the composite key, so _wantBody was never seen and D1
// response-body capture was silently dead.
// background.js is a chrome.*-wired service worker we can't import headlessly, so we
// defend the source contract directly: every state.har.get()/set() call site must use
// requestKey (the composite), never raw params.requestId.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "src", "background.js"),
  "utf8",
);

test("HAR map is keyed consistently (requestKey) across set and every get", () => {
  const setMatches = [...src.matchAll(/state\.har\.set\(([^,)]+)/g)].map((m) => m[1].trim());
  const getMatches = [...src.matchAll(/state\.har\.get\(([^)]+)\)/g)].map((m) => m[1].trim());
  // The rehydrate path restores from IDB under the entry's stored requestId field —
  // that's the composite key persisted at capture time, so it stays consistent too.
  const sets = setMatches.filter((k) => k !== "e.requestId");
  assert.ok(sets.length >= 1, "expected at least one live state.har.set call site");
  assert.ok(getMatches.length >= 3, "expected the request/responseReceived/loadingFinished lookups");
  for (const key of [...sets, ...getMatches]) {
    assert.equal(key, "requestKey", `state.har call site must use requestKey, saw: ${key}`);
  }
  assert.match(src, /state\.har\.set\(e\.requestId, e\)/, "rehydrate restores under the stored composite key");
});