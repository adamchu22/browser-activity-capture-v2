# Blind Review B — browser-activity-capture (2026-09-12)
**Disclosed caveat:** intended as "Astra" but the delegation layer pinned the model — this review ran on deepseek-v4-flash:0731-cloud in an isolated context, blind to other reviews. A true Astra pass follows separately via direct API.

```json
{
  "bugs": [
    {
      "severity": "CRITICAL",
      "id": "redaction-leak-content-to-timeline",
      "file": "extension/src/content.js:28 vs redact.js:42-57",
      "description": "Content script's maskValue() uses a much narrower token regex (JWT + Bearer only) than canonical redact.js (also AWS AKIA, sk_, ghp_, github_pat_, AIza, ya29, xox, sk-ant-, sk-, PEM blocks). Input event values are redacted by content.js BEFORE reaching the worker; appendTimeline() does NOT re-scrub the value field. Typing an AWS key or GitHub PAT into a non-secret input lands in timeline.json in the clear. The two TOKEN_VALUE_RE definitions diverged; content.js never updated when redact.js expanded its pattern set."
    },
    {
      "severity": "MEDIUM", "id": "frame-manifest-overcount-on-idb-failure",
      "file": "extension/src/background.js:1126-1128",
      "description": "After db.append('frames', ...) fails (QuotaExceededError), noteWriteFailure() is called but does NOT prevent state.frames.push() on the next line — in-memory frame metadata diverges from IndexedDB; manifest claims a phantom frame that was never persisted."
    },
    {
      "severity": "MEDIUM", "id": "buildTranscript-hour-fixed-at-00",
      "file": "extension/src/background.js:1660-1668",
      "description": "buildTranscript() hardcodes the VTT hour field to '00:' — a recording over 1 hour produces wrong timestamps ('00:70:00' instead of '01:10:00'). transcribe.py's vtt_time() computes hour dynamically; stub and ASR transcripts diverge on long recordings."
    },
    {
      "severity": "MEDIUM", "id": "concatSegments-dead-code-contradictory-contracts",
      "file": "extension/src/segments.js:20-26 vs :35-37; offscreen.js never calls concatSegments",
      "description": "File comment says segments CAN be byte-concatenated; segmentOffsetsFor() comment says they CANNOT; concatSegments() is never called. Dead code with contradictory docs."
    },
    {
      "severity": "LOW", "id": "duplicate-applyReshare-call",
      "file": "extension/src/content.js:736-737",
      "description": "applyReshare() called twice in immediate succession — copy-paste/rebase artifact."
    },
    {
      "severity": "LOW", "id": "final-speech-cue-end-only-3s-from-start",
      "file": "extension/src/background.js:1666",
      "description": "Last speech cue's end time is only 3s after its start instead of recording duration."
    },
    {
      "severity": "LOW", "id": "safeSend-callback-dead-code",
      "file": "extension/src/content.js:45-65",
      "description": "safeSend() cb parameter never used by any caller — callback branch is dead code."
    },
    {
      "severity": "LOW", "id": "validate-bundle-no-har-structure-check",
      "file": "analyze/validate_bundle.py:265-266",
      "description": "Validator checks network.har parses as JSON but not that it's valid HAR structure (log.entries)."
    },
    {
      "severity": "LOW", "id": "arming-lock-before-unsavedtake-check",
      "file": "extension/src/background.js:414-428",
      "description": "Arming lock claimed BEFORE the unsavedTake guard check — a queued second Start could bail while the first is about to abort."
    },
    {
      "severity": "LOW", "id": "keepalive-swallows-worker-death",
      "file": "extension/src/offscreen.js:79",
      "description": "Keepalive timer silently swallows all errors — a genuinely dead worker looks alive (zombie recording)."
    },
    {
      "severity": "MEDIUM", "id": "windows-test-failures-posix-path-assumptions",
      "file": "tests/test_install_pointer.py:21,72,83; tests/test_autopack.py:218",
      "description": "4 Python test failures on Windows from hardcoded POSIX path assertions."
    }
  ],
  "improvements": [
    { "priority": "HIGH", "id": "structured-ui-element-registry", "description": "Add ui-elements.json to the pack: every unique CSS selector with accessible name, ARIA role, section context, event kinds. Pre-built registry directly enables automation-skill building. ~30 lines from existing timeline + frames." },
    { "priority": "HIGH", "id": "pre-inferred-data-model", "description": "Add datamodel.json pass inferring entity shapes from request/response body pairs (JSON keys, types, endpoint→entity mappings). Every analyzing agent currently re-derives the API data model from scratch." },
    { "priority": "HIGH", "id": "llm-intent-refinement-pass", "description": "todos.py classify() is keyword-only, misses implicit intent ('this would be easier if…', 'I keep having to…'). Optional LLM pass via --refine-intent flag (never breaking stdlib-first default) could catch 2-3x more intents." },
    { "priority": "MEDIUM", "id": "brief-fm-steer-for-improvements", "description": "BRIEF.md purpose blocks should explicitly say 'look for moments where the user says something could be better, faster, or different — those are the raw material for your output.' One-line fix for the stated problem." },
    { "priority": "MEDIUM", "id": "narration-boundary-step-segmentation", "description": "segment_steps() uses time-gap boundaries only; narration often marks step transitions ('next', 'now we need to'). Add speech-cue boundary detection so steps align with the user's mental model." },
    { "priority": "MEDIUM", "id": "annotation-to-narration-topic-binding", "description": "narration_near() uses fixed 5s/3s windows; add semantic matching by element name, not just time proximity." },
    { "priority": "MEDIUM", "id": "frame-coverage-summary-not-dump", "description": "context.md Frames section dumps every frame; select the most informative frame per step and summarize the rest — prevents context-window waste on 6000-frame dumps." },
    { "priority": "LOW", "id": "optional-compression-in-zip", "description": "zip.js STORE-only; manifest/timeline/events.jsonl compress 3-5x with DEFLATE (crc32 already computed)." },
    { "priority": "LOW", "id": "redact-token-sync-test", "description": "Test enforcing the two TOKEN_VALUE_RE definitions (content.js, redact.js) stay in lockstep — catches future silent drift." },
    { "priority": "LOW", "id": "configurable-frame-cap-in-manifest", "description": "FRAME_CAP 6000 hardcoded; make configurable via chrome.storage; log cap hits in manifest." }
  ],
  "test_results": "Python: 270 ran, 4 FAIL + 1 ERROR (all Windows path assumptions in test_install_pointer.py + test_autopack.py), 1 skipped. Node: 132/132 pass."
}
```