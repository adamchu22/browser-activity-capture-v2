# To-do (completed) — v2

## 2026-06-17 — v2 capture rework (built, pending live verification)

- **Forked v1 as the v2 baseline.** Verbatim copy of the working v1 tool into this
  new repo; v1 stays intact in its own repo. Local `.venv/` and `outputs/` not
  copied (gitignored).

- **Reworked the capture model to full-screen video + all-tabs instrumentation.**
  - Video: replaced `chrome.tabCapture` (one tab) with
    `chrome.desktopCapture.chooseDesktopMedia(["screen","window","tab"])` → streamId
    consumed by the offscreen doc via `getUserMedia` `chromeMediaSource:"desktop"`.
    Mic stays a separate merged stream. Cancelling the picker records data-only.
  - Data: `state.tabId` → `state.tabIds`. At start, attach the CDP debugger +
    content script to every eligible tab across all windows; `tabs.onUpdated`
    instruments tabs opened mid-recording, `onRemoved` detaches closed ones. Events
    are tagged with their source tab; the manifest carries a tab legend (id →
    url/title). Bumped to `bundle_version` 0.2 / `capture_scope: all_tabs`.
  - Permissions: dropped `tabCapture`, added `desktopCapture`. Popup reflects the
    new start-response shape and warns the picker may close the popup.
  - Static-checked only (all files parse, manifest valid). **Live verification
    pending — see `LIVE-TEST.md`.**

- **Rendered multi-tab bundles in `pack.py`.** New `## Tabs (recorded in parallel)`
  section + `━━━ tab #N ━━━` switch markers in the timeline; v1 bundles unaffected.
  6 unit tests (`tests/test_multitab.py`). End-to-end checked on a synthetic v2
  bundle: validates PASS, context.md reads as a clean cross-tab narrative.

- **Updated docs for v2.** New `LIVE-TEST.md` (verification checklist), rewrote
  `extension/FIRST-CAPTURE.md` §2 for the screen-picker / all-tabs flow, and created
  the v2 tracking docs (handoff / to-do / learnings).

### Inherited from v1 (already done before the fork)
Glossary post-pass, network-noise collapse, finder-style unique selectors, and the
full record→transcribe→pack pipeline. See the v1 repo's `to-do-completed.md`.
