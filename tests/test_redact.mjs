// Regression tests for the extension's value-shape redaction (extension/src/redact.js).
// Run: node --test tests/test_redact.mjs
//
// The live test on 2026-06-17 leaked a GitHub JWT that rode in a URL query string
// (…png?jwt=eyJ…) — URLs were never passed through the token scrubber. These tests
// lock that gap closed and guard against false positives on benign query params.

import { test } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, scrubTokens, redactBody } from "../extension/src/redact.js";

const JWT = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIn0.abc-def_123";
const hasToken = (s) => /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/.test(s) || /Bearer\s/.test(s);

test("redactUrl masks a JWT in a query string (the real leak)", () => {
  const url = `https://private-user-images.githubusercontent.com/x/y.gif?jwt=${JWT}`;
  const out = redactUrl(url);
  assert.ok(!hasToken(out), "JWT must not survive in the URL");
  assert.ok(out.startsWith("https://private-user-images.githubusercontent.com/x/y.gif"), "host/path kept");
});

test("redactUrl masks secret-keyed params by name", () => {
  assert.ok(redactUrl("https://a.com/x?api_key=sk_live_abc123&page=2").includes("page=2"));
  assert.ok(!redactUrl("https://a.com/x?api_key=sk_live_abc123&page=2").includes("sk_live_abc123"));
  assert.ok(!redactUrl("https://a.com/cb?access_token=plain_value").includes("plain_value"));
});

test("redactUrl leaves benign URLs untouched (no false positives)", () => {
  const benign = "https://www.google.com/search?q=fox+in+sock&oq=fox&sourceid=chrome&ie=UTF-8";
  assert.equal(redactUrl(benign), benign);
  const local = "http://127.0.0.1:8765/jobs/caviar-gold-papaya/fixes?filter=price";
  assert.equal(redactUrl(local), local);
});

test("redactUrl is idempotent and null-safe", () => {
  const once = redactUrl(`https://a.com/x?jwt=${JWT}`);
  assert.equal(redactUrl(once), once);
  assert.equal(redactUrl(""), "");
  assert.equal(redactUrl(undefined), undefined);
});

test("scrubTokens still catches bare JWT/bearer (unchanged contract)", () => {
  assert.ok(!hasToken(scrubTokens(`token is ${JWT} ok`)));
  assert.ok(!hasToken(scrubTokens("Bearer abcdef0123456789")));
});

test("redactBody still redacts JSON + form bodies (unchanged contract)", () => {
  assert.ok(!hasToken(redactBody(JSON.stringify({ software_statement: JWT }))));
  assert.ok(redactBody("user=bob&token=secretvalue").includes("‹redacted:secret›"));
});

test("scrubbing a serialized rrweb node clears a token in a DOM attribute", () => {
  // The 2026-06-17 run 2 leak: a JWT rode in an <img src> inside the rrweb DOM
  // stream (events.jsonl). The worker's scrubNode = JSON.parse(scrubTokens(JSON
  // .stringify(node))); this mirrors that and must clear it while staying valid JSON.
  const node = {
    type: 2,
    tagName: "img",
    attributes: { src: `https://private-user-images.githubusercontent.com/x.gif?jwt=${JWT}` },
    childNodes: [{ type: 3, textContent: `also here: ${JWT}` }],
  };
  const scrubbed = JSON.parse(scrubTokens(JSON.stringify(node)));
  assert.ok(!hasToken(JSON.stringify(scrubbed)), "no token anywhere in the node");
  assert.equal(scrubbed.tagName, "img", "structure preserved");
});
