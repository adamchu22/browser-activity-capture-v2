# To-do (current) — v2

v2 reworks capture to **full-screen video + all-tabs instrumentation** and adds an
**intent-capture layer** (stated task goal, semantic element context, narrated-step
segmentation, frame annotation / "draw on screen"). Code is built and unit-tested
(61 tests; DOM capture also harness-verified); the extension still needs a live-Chrome
run. Completed v2 work is in `to-do-completed.md`; inherited v1 work is in the v1 repo.

## Now (in order)

- [x] ~~Validate the entire-screen + app-switch bundle~~ — `outputs/capture-2026-06-17T14-36-28-587Z.zip`
      **`validate_bundle.py` PASS** (0 warnings, 263 events, `video.webm` 48 MB present,
      audio track = Opus mic narration, `errors.json` empty). Frames confirm the video
      captured the **whole screen across both Chrome AND Comet** (a second browser where
      the extension isn't installed). The narration transcribed cleanly. The app-switch
      to Comet is visible in the video, as expected.

- [ ] **🎯 ADAM'S FEEDBACK on the browser tool (captured 2026-06-17 from the run above).**
      Reference he's modeling on: the **Loom** extension ("much prettier"). Items, in his words:

      **Popup — too big / "a bit ugly" → make it a compact dropdown.**
      - Shrink the popup into a dropdown "so it doesn't take up so much space."
      - KEEP the purpose/"why are you recording" field up top — he likes that it seeds the
        agent's context ("the option will start off your chat explaining it… so it knows").
      - MOVE into a **Settings** panel (out of the main popup): the **"Never record on"**
        host blocklist, and a **preset download folder**. Add a Loom-style "More"/settings menu.
      - He does NOT need camera-on / mic-chooser UI (mic is already handled); storage
        settings are fine to have.
      - Add a **countdown** before recording starts ("I like the countdown… so it knows when to begin").
      - Add a **face-cam / webcam video bubble** ("you need to have the video for my face").

      **On-screen control overlay during recording (model on Loom's menu) — WANTED:**
      **Finish** (= stop, save & export), **Pause**, **Restart**, **Cancel**.
      NOT wanted: rewind, trim.

      **Two NEW, SEPARATE annotation tools (the headline ask):**
      1. **Selector** — element selection that **snaps to DOM elements** (the way Loom's
         blur tool "sticks and goes on the objects"). Purpose: make sure user + agent are
         "**aligned on the same elements**." Lets the user confirm exactly which element they mean.
      2. **Draw** — freehand highlight of an **area/region** (not element-bound). Purpose:
         "show you what I actually want" — e.g. circle clutter, or "just these things at the
         top of the page, inside a section."
      They MUST be separate: selector = precise element alignment; draw = freeform area.
      Both usable **mid-recording**.

      **Blur tool (reconsidered → yes):** first said no, then "blur content is an awesome
      idea" — useful even though usage is internal, so users "show exactly what they want."
      Element-aware blur (same snapping mechanism as the selector).

      **Observed (possible issue):** near the end a Chrome **"new meeting"** prompt appeared;
      he wondered if it "broke it." It did NOT — bundle validated PASS and recording
      continued — but worth investigating why Chrome intercepted.
- [x] ~~**Live test, run 1** (2026-06-17)~~ — multi-tab instrumentation (RISK 2)
      **passed**; screen picker (RISK 1) **failed** and a `?jwt=` URL token leaked.
      Both fixed in code (see below). See `learnings.md`.
- [x] ~~Picker/video fix~~ — switched video to **`getDisplayMedia()` in the offscreen
      doc** (reason `DISPLAY_MEDIA`), Chrome's recommended MV3 path. `desktopCapture`
      streamId→offscreen was a dead end ("Invalid state"). Start stays in the popup;
      dropped the `desktopCapture` permission. (A first recorder-page attempt was the
      wrong layer and was reverted.) Needs live re-verify.
- [x] ~~URL redaction~~ — `redactUrl()` in `redact.js` applied at every URL sink in
      `background.js`; locked by `tests/test_redact.mjs`.
- [x] ~~Re-run `LIVE-TEST.md`~~ — **run 3 (`outputs/v2-test-2-jwt-fix.zip`) PASSED**:
      getDisplayMedia opened the picker from the popup, `video.webm` landed,
      `validate_bundle.py` PASS, zero tokens in any sink. v2 capture is live-verified.
- [ ] **Re-run `pack.py` on the clean bundle** and eyeball the intent layer in
      `context.md` (`## Steps`, semantic click labels, `## Tabs` + `━━━ tab #N ━━━`)
      and `frames-annotated.html` — these rendered in earlier runs but haven't been
      re-checked on a video-bearing PASS bundle.

## Build plan

**Priority order set 2026-06-17: P0 (self-driving zip) FIRST**, then the UX work (P1→P3),
then analyze-side (P4). Reuse note: `content.js` already has `selectorFor()` (unique CSS
selector) and `describe()` (semantic name/role/section) — the Selector tool builds on those.

---

**P0 — Self-driving Capture Bundle zip (TOP PRIORITY)** 🎯
Goal (Adam): **any zip I record and hand to an agent for another process must work without
us** — no `pack.py`, no us in the loop. The zip carries its own instructions and the agent
can recover the narration itself. Two new files go *inside every exported zip*:

- [x] ~~**Add `CLAUDE.md` to the zip**~~ — done. Generated by `bundle-docs.js`
      (`bundleClaudeMd`), added to the export `files` array in `background.js`.
- [x] ~~**Add `AGENTS.md` to the zip**~~ — done (`bundleAgentsMd`). Both share one body
      (`agentGuideBody`) so they never drift; each adds a one-line audience header.
- [x] **Both files cover (done):**
  - What the bundle is + the single clock (all `t` are ms since `t0`).
  - File-by-file: `manifest.json`, `timeline.json`, `events.jsonl` (rrweb DOM),
    `network.har`, `frames/`, `video.webm`, `transcript.vtt`.
  - **AUDIO FALLBACK (the core fix):** `transcript.vtt` may be a stub ("No narration
    captured"). If so, the narration is an **Opus audio track inside `video.webm`** —
    extract it (`ffmpeg -i video.webm -ac 1 -ar 16000 audio.wav`) and transcribe locally
    (parakeet/whisper/any ASR), then align cues to t0. This is what lets the zip work
    without us, since the extension can't transcribe at export.
  - Redaction policy: secrets are already `‹redacted›`; never invent or bypass.
  - The **purpose/task steer** (from `manifest.json`) — what the recording was made to produce.
  - The **analysis procedure** — port the essentials of `analyze-capture/SKILL.md` +
    `BRIEF.md` (read purpose → narration → identify → analyze under the lens → produce),
    so the zip alone is enough.
- [x] ~~**Decide embed vs. ship skill files**~~ — **EMBED** (Adam's call). The procedure
      (analyze-capture + BRIEF essentials, purpose lens) is written directly into
      CLAUDE.md/AGENTS.md; no separate skill files in the zip. Truly self-contained.
- [x] ~~**Update the bundle `README.md`**~~ — done (`bundleReadme` in `bundle-docs.js`). Now
      says the zip is self-driving and points at CLAUDE.md/AGENTS.md; pack.py noted as optional.
- [x] ~~**Tests**~~ — `tests/test_bundle_docs.mjs` (13 tests): both files present + non-trivial,
      shared body, audio-in-`video.webm` fallback, self-driving claim, redaction rule, one-clock,
      purpose rendering, task surfacing, narration_error path, README no longer requires pack.py.
      All green; python (70) + redact (7) still green.
- [x] ~~**LIVE-VERIFIED** (2026-06-17, `~/Downloads/capture-2026-06-17T16-07-30-128Z`)~~ —
      exported zip contains `CLAUDE.md` + `AGENTS.md` (identical bodies, correct content);
      `validate_bundle.py` PASS. Proved the audio fallback end-to-end: transcript was a stub
      but, following the embedded instructions (`ffmpeg` extract → local ASR), the narration
      was recovered from `video.webm`. P0 contract works without us.
- [x] ~~**Refinement: default to Parakeet, not Whisper**~~ — the audio-recovery step now tells
      the agent to default to Parakeet (best accuracy here) with a runnable mlx-audio command;
      Whisper is framed only as a fallback.
- [x] ~~**Refinement: general capture = `notes.md` only + ask the user**~~ — for General
      capture (or no purpose), the docs now say produce only `notes.md` by default (no auto
      SOP/skill/suggestions) and **ask the user which other outputs they want**. A specific
      purpose still auto-produces its deliverable. Locked by `test_bundle_docs.mjs` (now 15). **P0 DONE.**
- [ ] **Convenience (not required, optional):** auto-run `transcribe.py` at pack/export so the
      transcript is usually already populated — but the zip MUST still work as a stub (it does now).

---

**P1 — On-screen recording overlay** (injected, visible during recording, worker-synced
across tabs so it shows regardless of which tab is focused) — **CODE DONE; needs live-Chrome verify.**
- [x] ~~Inject a single overlay via `content.js`~~ — shadow-DOM pill (`overlay` IIFE in
      `content.js`), mounted on capture start, removed on stop. Worker keeps every tab's
      overlay in sync via `broadcastOverlay()` (`{recording, paused, t0}`).
- [x] ~~Controls: **Finish** / **Pause** / **Restart** / **Cancel**~~ — wired to
      `overlay-command` → worker. Finish = stop+export; Pause/Resume toggles; Restart and
      Cancel are destructive so they take a 2-click confirm ("Sure?"). No rewind/trim.
- [x] ~~Visually + functionally distinct from Chrome's "is debugging this browser" bar~~ —
      separate shadow-DOM pill bottom-center; our Cancel discards via the worker (does NOT
      touch the debugger). Chrome's bar Cancel still detaches — left alone.
- [x] ~~Pause/Restart/Cancel semantics on the worker side~~ — `pause/resume/restart/cancel`
      in `background.js`, mirrored onto the offscreen MediaRecorder (`offscreen-pause/-resume/
      -restart/-cancel`). **Pause:** event+rrweb ingest drop (`state.paused`) and recorder
      `.pause()`. **Restart:** wipe DB + buffers, reset t0, reuse the LIVE screen/mic tracks
      (no re-prompt), and re-init rrweb per tab so a fresh full snapshot lands (see
      `learnings.md`). **Cancel:** stop+discard, detach debuggers, release streams, no export.
- [ ] **Live-Chrome verify** (no unit test — overlay is shadow-DOM + chrome.* dependent):
      load unpacked, record across ≥2 tabs, confirm the pill shows on each tab, Pause freezes
      the timer + amber dot, Restart resets the clock and yields a replayable bundle, Cancel
      exports nothing, Finish exports a PASS bundle.

**P1b — Capture-death-on-navigation bug (CODE DONE + unit-tested; needs live verify)** 🐞
Found in a real 6-min session (`distru-freemium/.../capture-…16-12-14-616Z`): clicks/rrweb/
frames stopped at 1:43 on the first full-page navigation while network ran to 5:53 — only the
CDP debugger survived. Most of the session's DOM + visual capture was lost. See `learnings.md`.
- [x] ~~Worker re-arms the content script on every navigation~~ — `tabs.onUpdated` complete /
      url change → `reattachTab()` (re-inject + re-send `start`); debugger left attached.
      Gating in pure `nav-policy.js` (`navActions`), unit-tested (`tests/test_nav_policy.mjs`).
- [x] ~~Content-script self-attach retries on transient failure~~ (was fire-and-forget).
- [x] ~~Periodic 3s frame timer~~ — frames no longer coupled to DOM events
      (`startFrameTimer`/`stopFrameTimer`, wired to all lifecycle verbs). Dropped per-hover frame.
- [x] ~~Coverage diagnostic~~ — `analyze/check_coverage.py` detects the signature on any bundle;
      FAILs the original bad bundle, unit-tested (`tests/test_check_coverage.py`, 8 tests).
- [ ] **Live verify (the sign-off):** re-record the same distru-freemium flow (several
      `/fixes?filter=…` full-page navigations), Stop, then run
      `python3 analyze/check_coverage.py <bundle>` → must PASS (content capture tracks network
      on the active tab; clicks + frames present after the first navigation). Needs the screen
      picker + mic, so it's an interactive run.

**P4c — Capture network response bodies (follow-up, not blocking):** `network.har` currently
has no response bodies (no `Network.getResponseBody` call), so rendered HTML / error text can't
be recovered from the HAR — only from `video.webm`. Adding bodies needs response-body redaction
(we don't scrub those yet). Scope separately.

**P2 — Annotation tools on the overlay** (the headline ask; Selector and Draw are SEPARATE):
- [ ] **Draw** — freeform canvas highlight of an area/region (not element-bound). Emit a
      timestamped, tab-tagged `annotation:draw` event so `pack.py` can show "user
      highlighted here" next to the narration.
- [ ] **Selector** — element pick that **snaps to DOM elements** (reuse `selectorFor()` +
      `describe()`). Emit `annotation:select` with the selector + semantic label so the
      agent and user are "aligned on the same element."

**P3 — Popup → compact dropdown + Settings** (current popup is "too big / a bit ugly"):
- [ ] Shrink the popup to a compact dropdown; KEEP the purpose/"why are you recording"
      field at top (it seeds the agent's context — Adam likes this).
- [ ] **Settings panel** — move the **"Never record on" host blocklist** here, and add a
      **preset download folder** (so export doesn't prompt each time). Loom-style "More" menu.
- [ ] **Countdown** before recording starts.

**P4 — Analyze side renders the new signals:**
- [ ] `pack.py` renders `annotation:draw` / `annotation:select` in `context.md` and marks
      them on `frames-annotated.html` (extend the existing click-point/element-box drawing).
- [ ] **Auto-transcribe**: have `pack.py` (or export) run `transcribe.py` when it sees the
      stub `transcript.vtt`, so narration isn't a manual step. (This is why this run's
      transcript was a stub — transcription was never wired to auto-run; it's a separate
      `analyze/` step the extension can't perform itself.)

**P4b — `pack.py`-path handoff gaps** (verified 2026-06-17; the *zip*-path equivalents are
now covered by **P0** — these are the analysis-pack path):
- [ ] **Audio never reaches the pack.** `pack.py` `RAW_FILES` (line 35) copies
      manifest/timeline/transcript/network/events/errors but **NOT `video.webm`**. So if a
      bundle is packed while its transcript is still the stub, the pack has neither narration
      text nor the audio to recover it — narration is lost. Fix: either always transcribe
      before/at pack time (P4 auto-transcribe), and/or carry the audio into the pack.
- [ ] **No audio-fallback instructions anywhere.** Neither the bundle README
      (`background.js:515`) nor the `analyze-capture` skill tells a model the narration is an
      Opus track in `video.webm` or how to transcribe it; the skill says read "the full
      transcript" with no stub fallback. Add: "if transcript.vtt is a stub, the audio is in
      video.webm — transcribe it" (and ship that instruction where the recipient will see it).
- [ ] **Raw zip is not self-driving.** The bundle README is a one-line file list that points
      at `../analyze/pack.py` (a path the recipient won't have). The self-driving layer
      (`agent-skills/analyze-capture`, `BRIEF.md`) is added by `pack.py` into the *pack*, not
      the zip. Decide: either (a) document that you must run `pack.py` and hand over the pack,
      or (b) make the raw bundle carry minimal consumption instructions too.

**P5 — Investigate:** near the end of the run a Chrome **"new meeting"** prompt appeared and
Adam wondered if it broke recording. It did NOT (bundle PASSed, recording continued) — find
why Chrome intercepted and whether it can disrupt a real capture.

### Decisions made (2026-06-17)
- **Build order:** **P0 (self-driving zip + audio fix) FIRST** — Adam's call. The zip must
  work when handed to any agent without us, including recovering narration from the audio
  when the transcript is a stub, via in-zip `CLAUDE.md` + `AGENTS.md`. THEN P1 overlay, etc.
- **Blur:** skipped for now → moved to "Future improvements" below.
- **Face-cam:** deferred → "Future improvements" below.

### Open question (default chosen, confirm if wrong)
- **Annotations — visible only, or also structured events?** This plan assumes BOTH:
  shown on-screen during recording AND emitted as timeline events (so the agent gets the
  selector/region, not just the video pixels). Flag if you only want them visible.

## Future improvements (out of scope for now)
- [ ] **Blur tool** — element-aware blur like Loom's (snaps to elements). Decide then:
      real video-pixel blur (real-time region mask on the getDisplayMedia stream) vs. a
      "blur this region" marker the agent respects. Useful even for internal bundles so the
      user shows exactly what they intend. (Note: the video is currently NOT redacted at all.)
- [ ] **Face-cam / webcam bubble** ("video for my face") — adds `getUserMedia` webcam
      capture; decide whether to composite into `video.webm` (Loom-style bubble) or a
      separate track.

## Optional / noticed (not blocking)

- [ ] Per-tab frames: `captureVisibleTab` grabs whichever tab is active at the
      moment; with full-screen video the frames are partly redundant. Decide whether
      to keep per-tab frames, rely on the video, or tag frames with their tab.
- [ ] System/tab audio: the desktop stream can include shared audio if the user
      checks "share audio" in the picker; today we take only its video track. Decide
      if page audio is worth capturing as a separate track.

## Housekeeping

- [ ] Push v2 / open a PR / create a GitHub repo — **only when Adam asks.** All work
      is committed locally in this new repo (`git log` from the repo root); nothing
      pushed, no remote set.
