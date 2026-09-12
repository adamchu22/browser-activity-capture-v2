import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (name) => readFileSync(new URL(`../extension/src/${name}`, import.meta.url), "utf8");
const content = read("content.js");
const canonical = read("redact.js");

function tokenRegex(source) {
  const declaration = source.match(/const TOKEN_VALUE_RE = new RegExp\([\s\S]*?\n\s*\);/);
  assert.ok(declaration, "token declaration must remain discoverable by the drift test");
  return vm.runInNewContext(`${declaration[0]}\nTOKEN_VALUE_RE`);
}

test("content and canonical token patterns have identical source and flags", () => {
  const a = tokenRegex(content), b = tokenRegex(canonical);
  assert.equal(a.source, b.source);
  assert.equal(a.flags, b.flags);
});

test("input masking removes complete PEM values without changing the HAR scrubber", () => {
  const prefix = content.slice(content.indexOf("  const SECRET_KEY_RE"), content.indexOf("  const DWELL_MS"));
  const fn = content.match(/  function maskValue\(fieldName, value\) \{[\s\S]*?\n  \}/)[0];
  const mask = vm.runInNewContext(`${prefix}\n${fn}\nmaskValue`);
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nprivate material\n-----END RSA PRIVATE KEY-----";
  assert.equal(mask("notes", pem), "‹redacted:secret›");
  assert.equal(mask("notes", "ordinary task notes"), "ordinary task notes");
  for (const value of [
    "eyJabcdef.ghijklmn.signature", "bearer abcdef0123456789",
    "AKIAIOSFODNN7EXAMPLE", "sk_live_" + "A".repeat(20),
    "ghp_" + "A".repeat(36), "github_pat_" + "A".repeat(40),
    "AIza" + "A".repeat(35), "ya29." + "A".repeat(25),
    "xoxb-1234567890-abcdefghij", "sk-ant-" + "A".repeat(30),
    "sk-" + "A".repeat(40),
  ]) {
    assert.ok(!mask("notes", value).includes(value), value);
  }
});
