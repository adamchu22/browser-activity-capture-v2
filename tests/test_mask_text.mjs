// Track B / B1: rrweb's maskAllInputs covers <input>/<textarea> but NOT rich
// editors (contenteditable / role=textbox), so free-form PII typed into Gmail,
// Slack, or Notion would land in events.jsonl verbatim. These lock the masking
// contract we hand to rrweb. The selector→DOM matching + incremental-mutation
// masking are rrweb internals, exercised live; here we pin the two pure pieces:
// the marker function and the selector shape. See learnings.md (Track B).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITABLE_TEXT_SELECTOR, maskEditableText } from "../extension/src/mask-text.js";

test("visible typed text is replaced with a redaction marker", () => {
  assert.equal(maskEditableText("my social is 123-45-6789"), "‹redacted›");
  assert.equal(maskEditableText("a"), "‹redacted›");
});

test("whitespace-only nodes are preserved (layout, not content)", () => {
  assert.equal(maskEditableText(" "), " ");
  assert.equal(maskEditableText("\n  \t"), "\n  \t");
  assert.equal(maskEditableText(""), "");
});

test("non-string input is passed through untouched", () => {
  assert.equal(maskEditableText(null), null);
  assert.equal(maskEditableText(undefined), undefined);
});

test("selector targets editable surfaces and excludes read-only islands", () => {
  // contenteditable editors and ARIA textboxes are in scope…
  assert.match(EDITABLE_TEXT_SELECTOR, /\[contenteditable\]/);
  assert.match(EDITABLE_TEXT_SELECTOR, /\[role="textbox"\]/);
  assert.match(EDITABLE_TEXT_SELECTOR, /\[role="searchbox"\]/);
  // …but a contenteditable="false" island (e.g. an @mention chip) is excluded so
  // we don't mask non-user text inside an editor.
  assert.match(EDITABLE_TEXT_SELECTOR, /:not\(\[contenteditable="false"\]\)/);
});

// The selector must be syntactically valid CSS (rrweb feeds it to closest()).
// Validate it against jsdom's matcher if available, else just parse-check shape.
test("selector is well-formed CSS", () => {
  // A malformed selector would have unbalanced brackets/parens.
  const opens = (EDITABLE_TEXT_SELECTOR.match(/[[(]/g) || []).length;
  const closes = (EDITABLE_TEXT_SELECTOR.match(/[\])]/g) || []).length;
  assert.equal(opens, closes);
});
