# Blind Review C — browser-activity-capture (2026-09-12)
**Disclosed caveat:** intended as "GLM" but the delegation layer pinned the model — this review ran on deepseek-v4-flash:0731-cloud in an isolated context, blind to other reviews. A true GLM pass follows separately via direct API.

```json
{
  "summary": "Independent deep review: 8 bugs/defects across extension source, 15 prioritized improvements (4 critical for AI consumption). 132/132 Node tests pass, 267/270 Python pass (3 failures Windows-only POSIX-path assertions — non-logic). Master-clock invariant correctly enforced in all event paths (appendTimeline stamps t: now() for every source). Redaction invariant holds with known design gaps (rrweb JSON.stringify fallback, visual streams not redacted).",
  "bugs": [
    {
      "file": "extension/src/background.js", "line": 1252, "severity": "medium",
      "description": "Wasted redactBody() on bodies under RESP_BODY_HARD_MAX (1 MiB): full body redacted (JSON.parse → scrub → stringify), then truncated to 32 KiB by capResponseBody. Swap the two calls (cap first, redact inside the kept slice).",
      "code_quote": "entry.response.content.text = body.length > RESP_BODY_HARD_MAX ? `‹response body omitted: ${body.length} bytes›` : capResponseBody(redactBody(body), RESP_BODY_CAP);"
    },
    {
      "file": "extension/src/content.js", "line": 736, "severity": "low",
      "description": "applyReshare() called twice consecutively in overlay.update() — dead code."
    },
    {
      "file": "extension/src/background.js", "line": 1318, "severity": "low",
      "description": "Duplicate URL redaction in nav handler: appendTimeline() already calls redactUrl() on any event with a url field; handler redacts again (idempotent, harmless)."
    },
    {
      "file": "analyze/validate_bundle.py", "line": 33, "severity": "medium",
      "description": "KNOWN_KINDS does not include 'speech'. pack.py merges transcript.vtt cues into the timeline with kind='speech'; validation of a merged timeline flags 'speech' as unknown.",
      "code_quote": "KNOWN_KINDS = {\"nav\", \"click\", \"hover\", \"input\", \"key\", \"network\", \"annotation:select\", \"annotation:draw\"}"
    },
    {
      "file": "extension/src/background.js", "line": 1268, "severity": "high",
      "description": "scrubNode() falls back to the RAW unscrubbed rrweb node when JSON.stringify throws (circular reference in mutated DOM) — silently lands a full unredacted DOM event into events.jsonl.",
      "code_quote": "function scrubNode(node) { try { return JSON.parse(scrubTokens(JSON.stringify(node))); } catch { return node;  // SECURITY: raw node with potential secrets"
    },
    {
      "file": "tests/test_install_pointer.py", "line": 21, "severity": "medium",
      "description": "3 Python test failures on Windows: tests assert POSIX paths ('/x/analyze') but install_pointer.py writes native Windows paths ('C:\\x\\analyze'). Cannot pass on Windows."
    },
    {
      "file": "extension/src/content.js", "line": 397, "severity": "low",
      "description": "onKey handler only emits Enter/Tab/Escape — keyboard-driven workflows (Cmd+S, Ctrl+Z, arrow-key dropdown nav) invisible in the timeline. Intentional for privacy but keyboard-heavy workflows leave no trace.",
      "code_quote": "if ([\"Enter\", \"Tab\", \"Escape\"].includes(e.key)) emit(\"key\", { key: e.key });"
    },
    {
      "file": "analyze/pack.py", "line": 989, "severity": "medium",
      "description": "STUB_TRANSCRIPT_MARK ('No narration captured') matched as substring — real ASR output containing this text would be falsely detected as a stub."
    }
  ],
  "improvements": [
    { "priority": "P0 — critical", "file": "analyze/todos.py", "line": 25, "description": "Add 'ui-improvement' and 'feature-request' categories to todos.py _CATEGORIES: patterns like 'this should (do|show|be)', 'would be (better|nice|helpful) if', 'i wish (this|it) would', 'can we change this to', 'what if this was', 'make it easier to'. Single highest-leverage fix for stated problem #1." },
    { "priority": "P0 — critical", "file": "analyze/pack.py", "line": 760, "description": "Add 'Automation candidates' section to context.md: stable selectors (id + test-id attrs), API endpoints from HAR, form field requirements, success signals (confirming response/redirect), deterministic required inputs. Data already in timeline + HAR; surfaces stated problem #2." },
    { "priority": "P0 — critical", "file": "analyze/friction.py", "line": 171, "description": "Add scroll/resize/focus signals to friction.py: repeated up-down scrolling (hunting), window resize (comparing layouts), focus-away-then-back (distraction/context loss). Detectable from rrweb scroll events, viewport changes in frames, tab-activation patterns. Without these, UX analysis is blind to half the frustration patterns." },
    { "priority": "P0 — critical", "file": "analyze/pack.py", "line": 895, "description": "Add 'intent density scoring' — sliding window over timeline, count unique event kinds, weight narration (high), click/input (mid), network (low); surface top-5 'hot zone' timestamps so an LLM focuses on the richest segments of long recordings." },
    { "priority": "P1 — high", "file": "analyze/pack.py", "line": 447, "description": "Decision-point extraction: pauses >5s between two different kinds of actions indicates a choice was made." },
    { "priority": "P1 — high", "file": "analyze/friction.py", "line": 171, "description": "Element-role co-occurrence tracking: action sequences by role type ('button click → error toast → different button → success') — high-signal for UI improvement detection." },
    { "priority": "P1 — high", "file": "analyze/todos.py", "line": 64, "description": "Narration sentiment via simple bag-of-words lexicon per utterance ('that's annoying' vs 'that's nice') — no LLM needed." },
    { "priority": "P1 — high", "file": "analyze/pack.py", "line": 481, "description": "Add 'Rewrites' column to Steps section: type→delete→retype in same field = 'field rework' friction signal." },
    { "priority": "P2 — medium", "file": "analyze/pack.py", "line": 960, "description": "Separate 'UI improvement signals' section (user wanted something the interface didn't provide) distinct from 'Friction signals' (user struggled): wish-patterns, dwell on non-interactive elements, input-delete sequences, repeated tab/arrow navigation." },
    { "priority": "P2 — medium", "file": "analyze/pack.py", "line": 1170, "description": "Extract icon/button screenshots from frames using click-event rect bounding boxes — visual grounding for skills." },
    { "priority": "P2 — medium", "file": "analyze/friction.py", "line": 145, "description": "Network-timing waterfall friction: request >3s while user idle = 'wait-on-network' friction event." },
    { "priority": "P2 — medium", "file": "extension/src/content.js", "line": 736, "description": "Fix applyReshare() duplicate + add linting to catch the pattern." },
    { "priority": "P3 — low", "file": "extension/src/offscreen.js", "line": 96, "description": "Emit 'speech' timeline events from the worker, not pack.py, so speech rides the exact master clock instead of transcriber timestamp accuracy (~1s)." },
    { "priority": "P3 — low", "file": "analyze/validate_bundle.py", "line": 33, "description": "Add 'speech' to KNOWN_KINDS so merged timelines pass validation." },
    { "priority": "P3 — low", "file": "tests/", "line": 1, "description": "Test scrubNode circular-reference fallback: verify it degrades with a warning instead of silently accepting raw data." }
  ],
  "test_results": "Python: 270 run, 267 pass, 3 fail (all test_install_pointer.py Windows path issues). Node: 132/132 pass."
}
```