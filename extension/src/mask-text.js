// Editable-text masking for the rrweb DOM stream (events.jsonl).
//
// rrweb's `maskAllInputs` masks <input>/<textarea> values, but it does NOT touch
// rich editors — contenteditable surfaces and ARIA textboxes (Gmail compose,
// Slack, Notion, the body of most modern web apps). Free-form text typed there is
// serialized VERBATIM into events.jsonl, including PII, drafts, and pasted
// secrets. We pass these two values to rrweb so any text inside an editable region
// is masked at serialization time — on the initial snapshot AND on every
// incremental typing mutation (rrweb re-tests the selector via `closest()` on each
// characterData change, and masking inherits to descendants).
//
// NOTE: content.js is a classic script and can't import this module, so it mirrors
// `EDITABLE_TEXT_SELECTOR` + `maskEditableText` verbatim. Keep the two in sync
// (same arrangement as the redact.js / annotate-geom.js helpers).

// Elements whose text content is user-entered free-form text. `closest()` on this
// selector decides masking, so a match anywhere up the tree masks the whole
// subtree. `contenteditable="false"` is excluded (it's a read-only island inside
// an editor, e.g. an @mention chip — not user text). role=textbox/searchbox cover
// custom editors that aren't real <input>s.
export const EDITABLE_TEXT_SELECTOR =
  '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"]';

// rrweb calls this for every text node it has decided to mask (i.e. inside an
// editable region). Preserve whitespace-only nodes (layout, not content) so the
// DOM structure still replays; replace any visible text with a single marker so
// the analyzing agent sees "the user typed something redacted here" rather than a
// run of asterisks that could be mistaken for a masked password.
export function maskEditableText(text) {
  if (typeof text !== "string" || !text.trim()) return text;
  return "‹redacted›";
}
