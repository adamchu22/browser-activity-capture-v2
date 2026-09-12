# v2 post-merge review — findings & disposition (2026-09-12)

Independent reviewer: isolated subagent (deepseek-v4-flash via delegation), read-only,
final committed tree 2ba7919. Verdict returned: FIX-FIRST. Parent verified every
claim against the actual tree before acting — see disposition per finding.

## Confirmed real — FIXED

- **F001 (P0) — loadingFinished looked up the HAR by raw `params.requestId`.**
  The reviewer's *stated evidence* was partly fabricated (no `accumulatedResponseBodies`
  exists), but the conclusion was right, and it was a genuine v2 regression: Astra's
  diff introduced the composite `requestKey` for `state.har.set` (:1302) and the
  responseReceived/get lookups (:1307, :1348) but left `loadingFinished` (:1340) on the
  raw CDP requestId, which never matches the composite key. Result: `_wantBody` was
  never seen, `Network.getResponseBody` never fired — **D1 same-site JSON response-body
  capture was silently dead in v2**.
  - Fix: `e078a67` — `state.har.get(requestKey)` at loadingFinished.
  - Regression test: `tests/test_har_key_contract.mjs` (every `state.har` set/get call
    site must use `requestKey`; the rehydrate-from-IDB path is whitelisted since it
    restores under the stored composite key). Mutation-probed: reintroducing the bug
    fails the test.

## Verified against the tree — NOT real (fabricated or already handled)

- **F002 (claimed P0)** — stop()/rehydrate crash recovery. Claim's mechanism is real
  (unsavedTake set in stop() before export; rehydrate requires `unsavedTake &&
  pendingExport` together), but the failure window is: worker dies *between* stop() and
  export completion → next rehydrate sees `rec.recording=true` (serialized while
  recording) with no pendingExport → attempts resume. Mitigated: `mediaClock`/offscreen
  liveness gate (`media?.live && media.t0 === state.t0`) and the recording's own
  teardown make a silent "resume of a torn-down recording" recoverable — the offscreen
  doc is either live (resume is then CORRECT) or not (falls to salvage export at
  :236-240). Data is never lost: the IDB mirror survives. Residual: a stale REC badge
  until the user acts. Disposition: P3 UX wart, not P0. Not fixed this pass.
- **F003 (claimed P0)** — `reshareRecording` "overwrites freshClock() result". No
  object destructuring/abandonment exists in the code; `freshClock()` sets the module
  `mediaClock` from the worker's message and returns elapsed; the second
  `recordingElapsed` call re-derives `segmentOffsetMs` after the await against the
  fresh `mediaClock`. Fabricated.
- **F004 (P1)** — validator `inspect()` recursion "could blow stack". Already capped:
  `validate_bundle.py:235` `if depth > 100: return`. Fabricated.
- **F005 (P2)** — `test_friction.py test_empty` "weakened assertion". Actual test
  (lines 92-97) asserts all summary values are 0, `schema_version == 2`, and the
  presence of `dead_clicks`/`focus_returns` keys. Misread.
- **F007 (P2)** — "validate_issue recursive without cycle detection". No
  `validate_issue` function exists anywhere in `validate_bundle.py`. Fabricated.
- **F008 (P2)** — IDB "no versionchange handling". `db.js:37-38` sets both
  `onversionchange` and `onclose` handlers resetting the connection. Fabricated.
- **F009 (P3)** — "segmentOffset creation doesn't validate segment range".
  `sealSegment(chunks, offsetMs)` takes chunk blobs + a validated offset; the "raw
  segment range" the reviewer describes does not exist. Fabricated.
- **F010 (P3)** — "test_content.mjs only asserts function existence".
  `tests/test_content.mjs` does not exist. Fabricated.
- **F006 (P2)** — transcribe segment offsets "don't account for leading silence".
  Each segment's audio is extracted to its own wav; ASR timestamps are relative to that
  wav; `offset_cues` adds the segment's recording-clock offset. The claimed
  double-count of leading silence would require the model to timestamp against the
  full recording rather than the per-segment wav — it doesn't. Not reproduced; the
  offset math is unit-tested (`test_segment_offsets_preserve_gap_and_hours`).

## Standing test-coverage gaps (parent-found, pre-dating this review)

- `extension/src/download.js` `downloadComplete()` — the critical durability fix has no
  test (mutation probe: removing the `exists` check fails zero tests). It will be
  exercised first thing by the live-capture roundtrip (NEXT-STEPS step 2).
- `analyze/adapters/run_claude.py` kebab-case traversal guard — no direct test
  (mutation probe passes silently). Low risk; adapter is optional/off by default.

## Verdict after verification

The one real defect (F001) is fixed, regression-tested, committed, and pushed
(`e078a67`). Suites: node 129/129, python 279 OK (1 skipped). The reviewer's
FIX-FIRST is satisfied → the tree is back to SHIP pending the live-capture
roundtrip, which remains the real gate (see notes/NEXT-STEPS.md step 2).