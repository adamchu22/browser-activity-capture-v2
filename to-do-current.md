# To-do (current) — v2

v2 reworks capture to **full-screen video + all-tabs instrumentation** and adds an
**intent-capture layer** (stated task goal, semantic element context, narrated-step
segmentation, frame annotation / "draw on screen"). Code is built and unit-tested
(61 tests; DOM capture also harness-verified); the extension still needs a live-Chrome
run. Completed v2 work is in `to-do-completed.md`; inherited v1 work is in the v1 repo.

## Now (in order)

- [ ] **Live-verify v2 in real Chrome** — run `LIVE-TEST.md` end to end. Risk items:
      (1) the `desktopCapture` screen picker opens from the popup→worker path; (2) tabs
      opened mid-recording get the CDP debugger via `tabs.onUpdated`. Also confirm the
      intent layer in `context.md`: the Task callout, the narrated `## Steps`, semantic
      click labels, the `## Tabs` legend + `━━━ tab #N ━━━` markers, and that
      `frames-annotated.html` draws markers on the right elements. Record the outcome
      (and which picker-trigger path worked) in `learnings.md`.

- [ ] **On-screen control overlay** (injected, visible during recording):
      **Pause, Cancel, Restart, Finish (stop & export)**. In v2 it must work
      regardless of which tab is focused — consider a single overlay the worker keeps
      in sync across tabs. Must stay separate from Chrome's "this tab is being
      debugged" bar (its "Cancel" detaches the debugger and kills network capture).

## After live-verify (depends on the picker outcome)

- [ ] If the picker does NOT open from the worker (RISK 1), move the
      `chooseDesktopMedia` call to a gesture context — `chrome.action.onClicked` or
      the popup's click handler passing `streamId` to the worker. See
      `LIVE-TEST.md` → "If the picker never shows".

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
