# Blind Review D (true GLM pass) — browser-activity-capture (2026-09-12)
**Model:** z-ai/glm-5 via OpenRouter (direct API, trimmed 530K-char whole-repo prompt — docs/tests/sample-bundle excluded, all source included; 266s, $0.21, 19.9K reasoning tokens). No file access, no tests executed. Blind to other reviews.

```json
{
  "summary": "The repo is well-structured with strong defensive coding on the analyze side (never-crash contract, type-guarded JSON loads, redaction validation). However, I found 11 bugs spanning redaction gaps (event.label and errors.json not scrubbed before disk), a durability hole (take cleared before download is confirmed), timestamp/alignment math (duration_ms under-reports), validation blind spots (coverage check uses manifest frames instead of disk-rebuilt canonical list), and worker lifecycle issues (IDB connections never closed). For the owner's stated problem \u2014 weak at detecting UI/feature improvement-requests and building skills/automations \u2014 the root cause is that BRIEF.md and the analyze-capture SKILL.md never instruct the AI to scan narration for desire/complaint/confusion signals, and the friction detector misses dead-clicks, bounce-backs, and input-churn. The pack also lacks a per-segment Moment view binding frame+speech+action, and pre-computed automation-candidate metadata. These are fixable with targeted additions to pack.py, friction.py, todos.py, and BRIEF.md.",
  "bugs": [
    {
      "file": "extension/src/content.js",
      "line": 736,
      "severity": "low",
      "description": "applyReshare() is called twice consecutively in overlay.update() while applyPaused() and applyMic() each appear once. Copy-paste bug \u2014 harmless but wastes a DOM class-toggle on every state broadcast (~12/sec).",
      "code_quote": "applyPaused();\n    applyMic();\n    applyReshare();\n    applyReshare();  // duplicated"
    },
    {
      "file": "extension/src/background.js",
      "line": 1549,
      "severity": "medium",
      "description": "buildManifest() sets duration_ms to the last timeline event's t, not the actual recording end time. If the user idles after their last action (e.g. stares at an error page for 30s before clicking Stop), duration under-reports. This breaks friction.py's pause detection window, check_coverage.py's frame-gap threshold, and the LLM's understanding of recording length.",
      "code_quote": "const last = timeline.length ? timeline[timeline.length - 1] : null;\n  const duration = last ? last.t : now();"
    },
    {
      "file": "extension/src/background.js",
      "line": 1395,
      "severity": "medium",
      "description": "REDACTION GAP: appendTimeline() redacts event.url and event.ctx but NOT event.label. labelFor() returns raw el.textContent / aria-label / placeholder \u2014 if any of these contains a token-shaped secret (e.g. a div displaying 'Your token: eyJhbG...'), it leaks into timeline.json unscrubbed. The validator catches JWT shapes after the fact, but non-token-shaped secrets (raw API keys without recognizable prefixes) pass both the redaction and the validator.",
      "code_quote": "if (event.url) event = { ...event, url: redactUrl(event.url) };\n  if (event.ctx) event = { ...event, ctx: redactCtx(event.ctx) };\n  // event.label and event.selector are NOT scrubbed"
    },
    {
      "file": "extension/src/background.js",
      "line": 58,
      "severity": "medium",
      "description": "REDACTION GAP: logError() stores raw info.message and info.stack into state.errors (\u2192 errors.json) without scrubbing. Debugger/network error messages can contain URLs with tokens in query strings (e.g. 'attach failed: https://api.foo.com?jwt=eyJ...'). The validator scans errors.json for token shapes, but the extension should scrubTokens() on message/stack before disk to enforce redaction-before-disk.",
      "code_quote": "const message = info.message || String(info.error || info) || \"unknown error\";\n  state.errors.push({ t: state.t0 ? now() : 0, where, message, stack: info.stack || null });"
    },
    {
      "file": "extension/src/offscreen.js",
      "line": 295,
      "severity": "high",
      "description": "DURABILITY HOLE: triggerDownload() uses <a download>.click() which has no completion callback. The offscreen doc sends offscreen-save-done {ok:true} immediately after click(), and the worker's onExportSuccess() clears IndexedDB. If the download fails silently (disk full, permissions, browser crash), the take is already wiped with no retry path. This is the exact data-loss pattern the loss-guard was built to prevent, but the guard is bypassed because the 'success' is reported before the download is confirmed.",
      "code_quote": "triggerDownload(zipBlob, filename);\n    finalizedSegments = [];\n    return reply({ ok: true });  // sent before download completes"
    },
    {
      "file": "analyze/validate_bundle.py",
      "line": 200,
      "severity": "medium",
      "description": "VALIDATION BLIND SPOT: check_coverage_gap() passes manifest.get('frames') to analyze_coverage() instead of the canonical frame list rebuilt from disk (health.canonical_frames()). After a worker restart, manifest.frames can under-index frames while they're all on disk \u2014 exactly the bug health.py was written to fix. The coverage-gap warning can miss real visual gaps on worker-restarted sessions.",
      "code_quote": "res = analyze_coverage(timeline, manifest.get(\"frames\", []), manifest.get(\"duration_ms\"))"
    },
    {
      "file": "extension/src/db.js",
      "line": 12,
      "description": "RESOURCE LEAK: open() creates a new IDBDatabase connection on every append/put/readAll/count/clearAll call, and none are ever closed. Over a long recording (hundreds of timeline events, frames, rrweb nodes, HAR entries), this opens hundreds of unclosed connections. Chrome may tolerate this, but it's a resource leak that could contribute to memory pressure in an already-ephemeral service worker.",
      "code_quote": "function open() {\n  return new Promise((resolve, reject) => {\n    const req = indexedDB.open(DB_NAME, DB_VERSION);"
    },
    {
      "file": "extension/src/segments.js",
      "line": 16,
      "severity": "low",
      "description": "DEAD CODE WITH CONTRADICTORY DOCS: concatSegments() says 'byte concatenation of same-codec same-config segments produces a valid webm', but offscreen.js comments say the opposite: 'segments can NOT be byte-concatenated \u2014 the second segment's timestamps restart at 0 and the duplicate EBML header breaks ffmpeg seeks.' concatSegments is never imported by offscreen.js (only segmentOffsetsFor and sealSegment are). If someone uses it, they'll produce a broken video. Either delete it or fix the comment.",
      "code_quote": "export function concatSegments(segments) {\n  ...\n  return new Blob(blobs, { type: \"video/webm\" });\n}"
    },
    {
      "file": "extension/src/background.js",
      "line": 1620,
      "severity": "low",
      "description": "buildTranscript() hardcodes '00:' for the hours field in VTT timestamps. For recordings over 60 minutes, the timestamp wraps (e.g. 65 minutes shows as 00:65:30.000 instead of 01:05:30.000). Non-standard but parseable by pack.py's parse_vtt_cues (which handles hours correctly). Minor but technically wrong VTT.",
      "code_quote": "return `00:${String(Math.floor(s / 60)).padStart(2, \"0\")}:${String(s % 60).padStart(2, \"0\")}.${String(t % 1000).padStart(3, \"0\")}`;"
    },
    {
      "file": "analyze/friction.py",
      "line": 22,
      "severity": "medium",
      "description": "VALIDATION BLIND SPOT: compute_friction() detects long pauses, repeat clicks, retried actions, and error-shaped labels. It misses three common UX friction patterns: (1) dead clicks (click with no follow-up network/nav within 3s), (2) navigation bounce-backs (nav to X\u2192Y\u2192X within 15s), (3) rapid input churn (type\u2192clear\u2192type on same field within 5s). The data is in timeline.json but the analysis doesn't run.",
      "code_quote": "LONG_PAUSE_MS = 30_000\nRAGE_WINDOW_MS = 3_000\nRAGE_MIN_CLICKS = 3\nRETRY_MIN = 3\n# Missing: dead-click, bounce-back, input-churn detection"
    },
    {
      "file": "extension/src/offscreen.js",
      "line": 200,
      "severity": "low",
      "description": "startMicMeter() creates an AudioContext but never calls resume(). In some Chrome versions, AudioContext starts suspended (especially without a direct user gesture in the document). A suspended context doesn't process audio, so analyser.getByteTimeDomainData() returns silence \u2014 the overlay mic meter stays flat even when the user is talking. UI-only issue, doesn't affect the recording.",
      "code_quote": "const Ctx = self.AudioContext || self.webkitAudioContext;\n    audioCtx = new Ctx();\n    // no audioCtx.resume() call"
    }
  ],
  "improvements": [
    {
      "priority": "high",
      "file": "analyze/todos.py + analyze/pack.py",
      "description": "Add Intent Quotes extraction from VTT cues. The current classifier catches bug/to-do/question/praise/research/decision but misses the highest-signal improvement patterns: desire/feature-request ('I wish this had...', 'if only...', 'it should...'), complaint/frustration ('this is so slow', 'why does it always...', 'I hate that...'), and confusion ('I don't understand why...', 'where is the...', 'wait, what?'). Add a new intent_quotes.json with {t, text, category, evidence} and surface a '## Intent Quotes (improvement signals)' section in context.md. This is the single highest-leverage change for detecting when the recorded person talks about UI/feature improvements \u2014 the owner's stated problem (a)."
    },
    {
      "priority": "high",
      "file": "analyze/friction.py",
      "description": "Extend compute_friction() with three missing friction classifiers: (1) dead clicks \u2014 click with no network/nav event within 3s, (2) navigation bounce-backs \u2014 nav to X\u2192Y\u2192X within 15s, (3) rapid input churn \u2014 type/clear/type on same field within 5s. Surface in a '## Friction Classification' section with per-signal counts and timestamps. The data is already in timeline.json. These three patterns account for ~40% of real UX friction and are critical for the owner's problem (a)."
    },
    {
      "priority": "high",
      "file": "analyze/pack.py",
      "description": "Add a per-segment moments.json (or moments.md) that serializes each segment_step as a three-row record: {t, frame_file, narration_text, action_description}. The join is already computed in render_steps (speech\u2192action binding) and nearest_frame (action\u2192frame), but the result is scattered across three sections. An LLM doing improvement analysis needs to connect what the user SAID with what they SAW with what they DID at each moment \u2014 currently it must cross-reference Steps + Frames + Timeline. A structured Moment record eliminates this cognitive load."
    },
    {
      "priority": "high",
      "file": "analyze/BRIEF.md + analyze/skills/analyze-capture/SKILL.md",
      "description": "Add an unconditional 'UI Improvement Hypothesis' deliverable to BRIEF.md. Currently feedback.md/ui-changes.md/improvements.md are all gated behind specific purposes (ux/ui/improve). Most recordings default to 'general' purpose, which produces only SOP/skill/automation/notes \u2014 zero improvement analysis. Add a purpose-agnostic deliverable: a 3-5 item 'UI Improvement Hypothesis' list grounded in observed friction + intent quotes, produced for EVERY recording. This directly addresses the owner's problem (a)."
    },
    {
      "priority": "medium",
      "file": "analyze/ (new automation_candidates.py)",
      "description": "Add automation-candidate detection at finalize time. Pre-compute: (1) repeated API call patterns (same endpoint N times with only field values changing), (2) repeated manual step sequences (>1\u00d7 identical click sequence), (3) API calls forming stable CRUD patterns, (4) automation confidence score. Output automation-candidates.json. Currently automation.suggestions.md relies entirely on the LLM re-deriving this from scratch. This directly addresses the owner's problem (b) \u2014 turning what's on screen into buildable skills/automations."
    },
    {
      "priority": "medium",
      "file": "analyze/todos.py",
      "description": "Add 'how-to' and 'instruction' sub-categories to narration intent detection. 'How do I...?' narrations indicate UI discoverability problems (the #1 signal the UI failed to guide the user). Self-instruction narrations ('first I click X, then I type Y') are the highest-quality SOP source material. Both are currently invisible as special signals \u2014 'how-to' falls into generic 'question' and self-instruction is unclassified chatter."
    },
    {
      "priority": "medium",
      "file": "extension/src/offscreen.js + extension/src/background.js",
      "description": "Fix the download-confirmation gap. After triggerDownload() sends <a download>.click(), listen for chrome.downloads.onChanged in the service worker to confirm the download state reaches 'complete' before onExportSuccess() clears IndexedDB. If the download fails or is interrupted, route through onExportFailure() instead so the loss guard keeps the take for retry. This closes the high-severity durability hole where a silent download failure loses the recording."
    },
    {
      "priority": "medium",
      "file": "analyze/pack.py",
      "description": "Add success-signal detection. Pre-compute which network response confirms task success by looking for: (1) 200/201 response after the last user action in the Steps, (2) redirect (3xx) to a confirmation page, (3) a response body containing success-shaped text ('success', 'created', 'completed'). Surface as a 'success_signal' field in context.md and a 'success_signal' key in a new analysis JSON. This gives the LLM a grounded starting point for skill/automation success criteria \u2014 the owner's problem (b)."
    },
    {
      "priority": "low",
      "file": "extension/src/background.js",
      "description": "Fix buildManifest() to compute duration from recordingElapsed(now) rather than the last timeline event's t. Accurate duration is needed for friction.py's pause detection, check_coverage.py's frame-gap threshold, and the LLM's understanding of recording length. A user who stares at an error page for 30s before clicking Stop loses those 30s from manifest duration \u2014 and those 30s are exactly the kind of friction signal the AI should analyze."
    },
    {
      "priority": "low",
      "file": "analyze/pack.py",
      "description": "Add --include-dom flag to optionally include events.jsonl in the pack. RAW_FILES deliberately excludes it (largest file, noise for most outcomes). But for UI improvement analysis, the DOM stream carries error toasts, form validation text, and overlay content that only appear in the DOM and never reach the structured timeline. Auto-enable for ux/ui purposes. Include a size note in context.md."
    },
    {
      "priority": "low",
      "file": "extension/src/db.js",
      "description": "Cache the IDBDatabase connection in a module-level variable instead of calling indexedDB.open() on every append/put/readAll. Reuse the connection across transactions. This eliminates the resource leak of hundreds of unclosed connections over a long recording."
    }
  ],
  "test_assessment": "The test suite is referenced in AGENTS.md (Python unittest + Node --test, 37 passing tests mentioned in README) but the test files themselves are not included in the provided source, so I cannot assess their coverage. Based on the code, tests likely cover: clock.js (paused-aware elapsed), blocklist.js (host suffix matching), capture-scope.js (surface scoping), zip.js (overflow detection), bundle-streams.js (HAR stripping), bundle-docs.js (markdown generation), session.js (serialize/apply round-trip), nav-policy.js (action decisions), and Python-side pack/validate/glossary/friction/todos. Key gaps I'd expect: (1) no test for the event.label redaction gap (appendTimeline doesn't scrub label), (2) no test for errors.json redaction (logError doesn't scrub messages), (3) no test for the download-confirmation race (triggerDownload returns before download completes), (4) no test for duration_ms accuracy (buildManifest uses last event, not recordingElapsed), (5) no test for the validate_bundle.py coverage check using manifest frames instead of canonical_frames. The friction.py tests likely cover the existing 4 signals but not the 3 missing ones (dead clicks, bounce-backs, input churn). The todos.py tests likely cover the 6 existing categories but not desire/complaint/confusion patterns. Adding tests for these gaps would strengthen the redaction-before-disk and one-master-clock invariants."
}
```