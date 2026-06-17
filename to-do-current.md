# To-do (current) — v2

v2 reworks capture to **full-screen video + all-tabs instrumentation** and adds an
**intent-capture layer** (stated task goal, semantic element context, narrated-step
segmentation, frame annotation / "draw on screen"). Code is built and unit-tested
(61 tests; DOM capture also harness-verified); the extension still needs a live-Chrome
run. Completed v2 work is in `to-do-completed.md`; inherited v1 work is in the v1 repo.

## Now (in order)

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

- [ ] **On-screen control overlay** (injected, visible during recording):
      **Pause, Cancel, Restart, Finish (stop & export)**. In v2 it must work
      regardless of which tab is focused — consider a single overlay the worker keeps
      in sync across tabs. Must stay separate from Chrome's "this tab is being
      debugged" bar (its "Cancel" detaches the debugger and kills network capture).

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
