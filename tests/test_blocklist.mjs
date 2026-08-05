// Regression tests for host-blocklist matching (extension/src/blocklist.js).
//
// The bug this guards against: a live run had `my.1password.com` fully captured
// (network auth flow + the vault visible in frames) even though 1Password was
// meant to be excluded — the old exact-string match never fired unless the entry
// equalled the host character-for-character. Suffix matching + input tolerance
// fixes that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHost, hostOnBlocklist } from "../extension/src/blocklist.js";

test("normalizeHost strips scheme/path/creds/port/www/wildcard/case", () => {
  assert.equal(normalizeHost("my.1password.com"), "my.1password.com");
  assert.equal(normalizeHost("https://my.1password.com/app#/x"), "my.1password.com");
  assert.equal(normalizeHost("HTTPS://My.1Password.com"), "my.1password.com");
  assert.equal(normalizeHost("*.1password.com"), "1password.com");
  assert.equal(normalizeHost("www.bank.example.com"), "bank.example.com");
  assert.equal(normalizeHost("user:pass@host.example.com:8443/path?q=1"), "host.example.com");
  assert.equal(normalizeHost("  mail.google.com  "), "mail.google.com");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost(null), "");
});

test("THE FIX: a parent-domain entry blocks its subdomains", () => {
  assert.equal(hostOnBlocklist("https://my.1password.com/app#/AllItems", ["1password.com"]), true);
  assert.equal(hostOnBlocklist("https://my.1password.com/signin", ["my.1password.com"]), true);
  assert.equal(hostOnBlocklist("https://a.b.1password.com/x", ["1password.com"]), true);
});

test("exact host matches", () => {
  assert.equal(hostOnBlocklist("https://mail.google.com/mail/u/0", ["mail.google.com"]), true);
  assert.equal(hostOnBlocklist("https://www.bank.example.com/", ["bank.example.com"]), true);
});

test("entry tolerance: full URL / scheme / casing pasted into the list", () => {
  assert.equal(hostOnBlocklist("https://my.1password.com/x", ["https://my.1password.com/app"]), true);
  assert.equal(hostOnBlocklist("https://my.1password.com/x", ["My.1Password.com"]), true);
  assert.equal(hostOnBlocklist("https://my.1password.com/x", ["*.1password.com"]), true);
});

test("does NOT over-match: a sibling/unrelated host stays recordable", () => {
  // suffix match must be on a dot boundary — "password.com" must not match "1password.com"
  assert.equal(hostOnBlocklist("https://1password.com/", ["password.com"]), false);
  assert.equal(hostOnBlocklist("https://notmail.google.com.evil.com/", ["mail.google.com"]), false);
  assert.equal(hostOnBlocklist("https://example.com/", ["bank.example.com"]), false);
  assert.equal(hostOnBlocklist("https://example.com/", []), false);
});

test("non-URLs and junk entries are ignored, never throw", () => {
  assert.equal(hostOnBlocklist("chrome://newtab", ["1password.com"]), false);
  assert.equal(hostOnBlocklist("", ["1password.com"]), false);
  assert.equal(hostOnBlocklist("https://my.1password.com/x", ["", "   ", null]), false);
});
