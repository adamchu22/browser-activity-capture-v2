// Regression tests for the extension's value-shape redaction (extension/src/redact.js).
// Run: node --test tests/test_redact.mjs
//
// The live test on 2026-06-17 leaked a GitHub JWT that rode in a URL query string
// (…png?jwt=eyJ…) — URLs were never passed through the token scrubber. These tests
// lock that gap closed and guard against false positives on benign query params.

import { test } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, scrubTokens, redactBody, redactCtx } from "../extension/src/redact.js";

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

test("response bodies (D1): secrets/emails masked, data model shape kept", () => {
  // D1 reuses redactBody for captured response bodies. The migration outcome needs the
  // field names + value shapes legible, so non-secret data must survive while tokens and
  // emails are masked.
  const respBody = JSON.stringify({
    id: 42,
    name: "Acme Corp",
    owner_email: "jane@acme.com",
    api_token: JWT,
    items: [{ sku: "A-1", qty: 3 }],
  });
  const out = redactBody(respBody);
  assert.ok(!hasToken(out), "token in a response body must not survive");
  assert.ok(!out.includes("jane@acme.com"), "email value must be masked");
  assert.ok(out.includes("‹redacted:secret›"), "secret-keyed field masked");
  assert.ok(out.includes("‹redacted:email›"), "email-shaped value masked");
  // The data model (field names + non-secret values + nesting) stays intact.
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, 42);
  assert.equal(parsed.name, "Acme Corp");
  assert.equal(parsed.items[0].sku, "A-1");
  assert.equal(parsed.items[0].qty, 3);
});

test("form bodies: card/cvv/ssn/jwt/sig are redacted (was a leak)", () => {
  // The non-JSON branch once used a narrower key set than the URL/JSON sinks, so a
  // card number / SSN in a form POST leaked into network.har.
  for (const pair of ["card=4111111111111111", "cvv=123", "ssn=123-45-6789", "sig=deadbeef", "jwt=abc.def"]) {
    const out = redactBody(pair);
    assert.ok(out.includes("‹redacted:secret›"), `${pair} must be redacted, got ${out}`);
    assert.ok(!out.includes(pair.split("=")[1]), `${pair} value must not survive`);
  }
  // Multi-pair form body keeps the benign field, redacts the secret one.
  const body = redactBody("name=bob&card=4111111111111111&page=2");
  assert.ok(body.includes("page=2") && body.includes("name=bob"));
  assert.ok(!body.includes("4111111111111111"));
});

test("bare `key` no longer over-redacts innocent names (monkey, turnkey)", () => {
  assert.ok(redactBody("monkey=banana").includes("monkey=banana"));
  assert.ok(redactBody("turnkey=yes").includes("turnkey=yes"));
});

test("lowercase + url-encoded bearer tokens are scrubbed (case/encoding gaps)", () => {
  assert.ok(!hasToken(scrubTokens("authorization: bearer abcdef0123456789")));
  assert.ok(!/abcdef0123456789/.test(scrubTokens("bearer abcdef0123456789")));
  assert.ok(!/abcdef0123456789/.test(redactUrl("https://x.com/cb?state=Bearer%20abcdef0123456789")));
  assert.ok(!/abcdef0123456789/.test(redactUrl("https://x.com/cb?next=Bearer+abcdef0123456789")));
});

test("value-shape backstop catches provider keys under innocuous keys", () => {
  // These leak today if they sit under a non-secret field name — the backstop must
  // catch them by shape. Each is a high-confidence provider prefix.
  const secrets = {
    aws: "AKIAIOSFODNN7EXAMPLE",
    stripe: "sk_live_ABCDEFGHIJKLMNOP1234",
    github: "ghp_" + "A".repeat(36),
    githubPat: "github_pat_" + "B".repeat(40),
    google: "AIza" + "C".repeat(35),
    googleOauth: "ya29." + "D".repeat(25),
    slack: "xoxb-1234567890-abcdefghij",
    openai: "sk-" + "E".repeat(40),
    anthropic: "sk-ant-" + "F".repeat(30),
  };
  for (const [name, val] of Object.entries(secrets)) {
    // Under an innocent JSON key, and as a bare body value.
    assert.ok(!redactBody(JSON.stringify({ data: val })).includes(val), `${name} in JSON leaked`);
    assert.ok(!scrubTokens(`value is ${val} here`).includes(val), `${name} via scrubTokens leaked`);
  }
  assert.ok(scrubTokens("-----BEGIN RSA PRIVATE KEY-----").includes("‹redacted"));
});

test("redactUrl masks secrets in the #fragment and strips user:pass@ credentials", () => {
  assert.ok(!redactUrl("https://app/cb#access_token=ya29." + "x".repeat(30)).includes("ya29"));
  assert.ok(!redactUrl("https://app/cb#token=" + "y".repeat(30)).includes("y".repeat(30)));
  const creds = redactUrl("https://admin:Hunter2Secret@host.com/x");
  assert.ok(!creds.includes("Hunter2Secret"), "userinfo password must be stripped");
  assert.ok(creds.startsWith("https://‹redacted") && creds.includes("@host.com/x"));
});

test("provider-key redaction doesn't over-redact benign hyphenated prose", () => {
  // The sk- shape requires 32 pure-alnum chars, so normal hyphenated text is safe.
  const prose = "task-oriented-approach to problem-solving";
  assert.equal(redactBody(prose), prose);
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

// --- Track B / B2: redactCtx — the describe() semantic-context object ---------
// accessibleName() follows aria-labelledby to a referenced node's textContent, and
// sectionFor() reads a landmark's label / nearest heading — either can pull a
// token-shaped secret into ctx.name / ctx.section. ctx.href can hold a token in a
// link's query. redactCtx is the worker-side canonical scrub for all three.

test("redactCtx scrubs a token pulled into the accessible name", () => {
  const out = redactCtx({ role: "textbox", name: `Your code: ${JWT}` });
  assert.ok(!hasToken(JSON.stringify(out)), "no token in ctx.name");
  assert.equal(out.role, "textbox", "non-secret fields untouched");
});

test("redactCtx scrubs a token in the section label", () => {
  const out = redactCtx({ section: `Bearer ${"a".repeat(20)}` });
  assert.ok(!hasToken(JSON.stringify(out)), "no token in ctx.section");
});

test("redactCtx masks a secret in a link href", () => {
  const out = redactCtx({ href: `/r?access_token=${JWT}` });
  assert.ok(!hasToken(JSON.stringify(out)), "no token in ctx.href");
});

test("redactCtx leaves benign context alone and tolerates non-objects", () => {
  const benign = { role: "button", name: "Issue refund", section: "Order actions" };
  assert.deepEqual(redactCtx(benign), benign);
  assert.equal(redactCtx(null), null);
  assert.equal(redactCtx(undefined), undefined);
});
