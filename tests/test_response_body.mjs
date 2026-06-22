// Tests for the D1 response-body capture helpers (extension/src/response-body.js).
// Run: node --test tests/test_response_body.mjs
//
// These decide WHICH responses get their body captured (same-site JSON only) and how
// they're bounded. The scoping is the privacy-relevant part: a cross-site body must
// never qualify, and an unparseable/IP host must default to "not same-site".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registrableDomain,
  isSameSite,
  isJsonMime,
  capResponseBody,
} from "../extension/src/response-body.js";

test("registrableDomain collapses subdomains to eTLD+1", () => {
  assert.equal(registrableDomain("https://app.foo.com/x"), "foo.com");
  assert.equal(registrableDomain("https://api.foo.com/y?z=1"), "foo.com");
  assert.equal(registrableDomain("https://foo.com"), "foo.com");
  assert.equal(registrableDomain("https://a.b.c.foo.com"), "foo.com");
});

test("registrableDomain handles two-level public suffixes (co.uk)", () => {
  assert.equal(registrableDomain("https://app.foo.co.uk/x"), "foo.co.uk");
  assert.equal(registrableDomain("https://foo.co.uk"), "foo.co.uk");
  assert.equal(registrableDomain("https://api.shop.com.au"), "shop.com.au");
});

test("registrableDomain returns '' for hosts with no registrable domain", () => {
  assert.equal(registrableDomain("chrome://extensions"), "");
  assert.equal(registrableDomain("https://192.168.1.10/x"), ""); // IPv4 literal
  assert.equal(registrableDomain("not a url"), "");
  assert.equal(registrableDomain(""), "");
});

test("registrableDomain keeps single-label hosts whole (localhost)", () => {
  assert.equal(registrableDomain("http://localhost:3000/api"), "localhost");
});

test("isSameSite matches app<->api subdomains, rejects third parties", () => {
  assert.equal(isSameSite("https://app.foo.com/page", "https://api.foo.com/data"), true);
  assert.equal(isSameSite("https://foo.com/page", "https://foo.com/data"), true);
  assert.equal(isSameSite("https://app.foo.com/page", "https://analytics.other.com/t"), false);
  assert.equal(isSameSite("https://app.foo.co.uk/p", "https://api.foo.co.uk/d"), true);
});

test("isSameSite is false when either side has no registrable domain", () => {
  assert.equal(isSameSite("chrome://x", "https://foo.com"), false);
  assert.equal(isSameSite("https://foo.com", "https://192.168.0.1/x"), false);
});

test("isJsonMime accepts REST/vendor/graphql JSON, rejects others", () => {
  assert.equal(isJsonMime("application/json"), true);
  assert.equal(isJsonMime("application/json; charset=utf-8"), true);
  assert.equal(isJsonMime("application/vnd.api+json"), true);
  assert.equal(isJsonMime("application/graphql-response+json"), true);
  assert.equal(isJsonMime("text/json"), true);
  assert.equal(isJsonMime("text/html"), false);
  assert.equal(isJsonMime("image/png"), false);
  assert.equal(isJsonMime(""), false);
  assert.equal(isJsonMime(undefined), false);
});

test("capResponseBody leaves a body under the cap unchanged", () => {
  const body = '{"id":1,"name":"x"}';
  assert.equal(capResponseBody(body, 1024), body);
});

test("capResponseBody truncates and marks an over-cap body", () => {
  const body = "a".repeat(100);
  const out = capResponseBody(body, 40);
  assert.ok(out.startsWith("a".repeat(40)), "keeps the capped prefix");
  assert.ok(out.includes("‹truncated 60 bytes›"), "names the dropped byte count");
  assert.ok(out.length < body.length + 30, "shorter than original + marker");
});
