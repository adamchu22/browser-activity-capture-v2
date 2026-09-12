# Cross-Review Synthesis — browser-activity-capture (2026-09-12)

Five independent reviews, all blind to each other:
- **hermes** (review-2026-09-11-hermes.md) — deepseek child (Hermes delegation)
- **blind_b** (review-2026-09-12-blind-b.md) — deepseek child, isolated (intended Astra; delegation pinned model)
- **blind_c** (review-2026-09-12-blind-c.md) — deepseek child, isolated (intended GLM; delegation pinned model)
- **astra** (review-2026-09-12-astra.md) — **true Astra** (openai/gpt-6-astra, direct OpenRouter API, 739K-char whole-repo prompt, $2.96)
- **glm** (review-2026-09-12-glm.md) — **true GLM** (z-ai/glm-5, direct OpenRouter API, 530K-char trimmed prompt, $0.21)

Totals: hermes 5 bugs/8 improvements · blind_b 11/10 · blind_c 8/15 · astra 51/17 · glm 11/11

## Consensus bugs (found by 3+ reviewers = high confidence)

| # | Bug | Found by |
|---|-----|----------|
| 1 | applyReshare() duplicated (content.js:736) | all 5 |
| 2 | HAR time reconstruction includes paused wall-time → breaks one-clock invariant (bundle-streams.js:62) | blind_b, blind_c, astra, glm |
| 3 | Frame coverage check uses manifest (under-indexed) instead of disk truth (validate_bundle.py:200) | blind_b, astra, glm, hermes |
| 4 | duration_ms uses last event, not stop time (background.js) | astra, glm, hermes |
| 5 | Friction detector missing dead-clicks/bounce-backs/input-churn/scroll (friction.py) | blind_c, astra, glm, hermes |
| 6 | BRIEF.md gates improvement-signal extraction behind declared purpose | blind_b, astra, glm, hermes |
| 7 | ASR transcript written to pack with NO secret redaction (transcribe.py) | blind_b, blind_c, astra |

## Two-reviewer (2 found = likely real)

| # | Bug | Found by | Severity |
|---|-----|----------|----------|
| 8 | **CRITICAL** — content.js TOKEN_VALUE_RE drifted from redact.js (JWT+Bearer only vs full token set); AWS/Stripe/GitHub/Slack keys typed into non-secret inputs land in timeline.json in the clear | blind_b, astra | CRITICAL |
| 9 | scrubNode() falls back to RAW unredacted rrweb node on JSON.stringify failure (background.js:1268) | blind_c, astra | HIGH |
| 10 | event.label not redacted before timeline persist (background.js:1395) | astra, glm | MEDIUM |
| 11 | logError() writes raw error messages/stacks unredacted to errors.json (background.js:58) | astra, glm | MEDIUM |
| 12 | PEM redaction only strips BEGIN marker; key material survives (redact.js:49) | blind_b, astra | HIGH |
| 13 | Visual streams (captureVisibleTab/getDisplayMedia pixels) explicitly unredacted — revealed secrets in view leak | blind_c, astra | HIGH (design gap) |
| 14 | Download success reported before download completes → can wipe only recording (offscreen.js triggerDownload) | astra, glm | CRITICAL |
| 15 | VTT hour field hardcoded '00:' — breaks >60min recordings (background.js:1660) | blind_b, glm | LOW/MEDIUM |
| 16 | concatSegments dead code, contradictory docs (segments.js) | blind_b, glm | LOW |
| 17 | Windows POSIX-path test failures (test_install_pointer.py ×3, test_autopack ×1) | blind_b, blind_c | MEDIUM (test-only) |

## Unique finds (single reviewer, need verification but plausible)

- **Astra only** (the deepest pass): lifecycle commands not serialized → Start can clobber stop-in-progress export and destroy take (background.js:580, CRITICAL-adjacent); in-flight capture ops lack generation guard after worker restart (1100); recovery snapshot debounce race (132); debugger already-attached recovery hole (333); retryExport ignores finalized video (765); re-share narration loss during picker (466); re-share offset sampled before picker → ~20s clock skew (915); transcribe.py ignores segment offsets on multi-segment audio → misaligned timestamps (76); HAR keys not scoped per debugger target → cross-target collisions (1180); blocklist trailing-dot + Unicode host bypass (blocklist.js:31); data-capture-secret attribute never actually checked (content.js:81); JSON key masking uses narrow SECRET_KEY_RE vs broader form-value words (redact.js:175); rrweb nodes never URL/attribute-redacted, only token-scrubbed (background.js:1230); public-suffix list fails open (response-body.js:44); validator redaction gate searches text not parsed structures (validate_bundle.py:218); falsy timelines bypass check_timeline (270); pack copies data with no validator/redaction gate (pack.py:1270); background-tab events misread as tab switches (pack.py:437); evidence overstates proximity as causality (todos.py:103); **path traversal: model-generated skill name used unvalidated as filesystem path (adapters/run_claude.py:114)**.
- **blind_b only**: phantom frame metadata on IDB write failure (background.js:1126); safeSend dead callback branch; arming lock claimed before unsavedTake check; keepalive swallows worker death.
- **blind_c only**: 'speech' missing from KNOWN_KINDS; stub-transcript substring false positive (pack.py:989); duplicate redactUrl idempotent call; onKey only Enter/Tab/Escape (keyboard workflows invisible — intentional privacy trade-off).
- **glm only**: IDB connections opened per-call and never closed → resource leak on long recordings (db.js:12); AudioContext starts suspended in some Chrome versions (offscreen.js:200).

## Consensus improvements (AI-consumption)

| # | Improvement | Found by |
|---|------------|----------|
| 1 | Intent-quote extraction from narration (desire/complaint/confusion patterns) | 4 (blind_b, blind_c, astra, glm) |
| 2 | Moments/hot-zone view: frame + speech + action bound in one record, or intent-density scoring | 4 |
| 3 | Automation-candidate precomputation (repeated API calls w/ changing values, repeated click sequences, CRUD shapes) | 3 (blind_c, astra, glm) |
| 4 | Friction signals: scroll hunting, resize, focus-away, dead-click, network-wait | 3 |
| 5 | BRIEF steer: explicitly instruct scanning narration for improvement talk | 3 |
| 6 | ui-elements.json registry (selectors + accessible names + roles) | 2 (blind_b, blind_c) |
| 7 | datamodel.json: infer entity shapes from HAR request/response pairs | 2 (blind_b, astra) |
| 8 | Optional DOM stream (--include-dom flag) | 2 (blind_b, glm) |
| 9 | Field-rework/retype detection in Steps | 2 (blind_c, glm) |
| 10 | Unconditional purpose-agnostic improvement hypotheses in every pack | 1 (glm) — but cheap |
| 11 | Optional LLM intent-refinement pass (never breaking stdlib-first) | 1 (blind_b) |
| 12 | Narration sentiment lexicon | 1 (blind_c) |

## Suggested fix priority (synthesis view, NOT built — awaiting Adam)

**P0 — security/data loss (do first):**
1. #8 token regex drift (CRITICAL, clear leak path)
2. #14 download-before-confirmed durability hole (data loss of the only recording)
3. #9 scrubNode raw fallback
4. #10/#11/#12 redaction gaps (label, errors, PEM)
5. ASR transcript redaction pass (#13 partial)

**P1 — correctness:**
6. #2 HAR pause-time (breaks the core invariant)
7. #14→(dup) lifecycle serialization (Astra 580)
8. #3 coverage check + #4 duration_ms
9. #17 Windows test fixes

**P2 — AI-consumption (the owner's stated problem):**
- Intent quotes (consensus #1) + moments/hot-zones (#2) + automation candidates (#3) + friction additions (#4) + BRIEF steer (#5) — all analyze/-side, stdlib, testable against sample-bundle.

**P3 — cleanup:** dead code, duplicate calls, KNOWN_KINDS 'speech', stub false positive, IDB connection reuse, AudioContext resume.

---
*All five full reviews are in this notes/ directory. Review files: review-2026-09-11-hermes.md, review-2026-09-12-blind-b.md, review-2026-09-12-blind-c.md, review-2026-09-12-astra.md, review-2026-09-12-glm.md, this file.*