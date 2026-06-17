# To-do (completed) — v2

## 2026-06-17 — intent-capture upgrades (make the bundle 10x for the analyzing model)

Asked "what would make this 10x better at conveying user intent?", built the binding
+ structuring layer over the already-captured raw material:

- **Semantic element context.** `content.js describe()` attaches accessible name,
  ARIA role, enclosing section/landmark, and input/link/select specifics to
  click/hover/input events (never reads `el.value`, so safe on secret fields).
  `pack.py` renders `click button "Issue refund" in "Order actions"` instead of a
  bare selector. Verified in real Chromium via the extended selector harness.
- **Narrated procedure (step segmentation).** `pack.py` groups the flat timeline into
  steps at navigations / tab switches / >2.5s pauses and binds the narration spoken in
  each step to it. Narration forward-binds to the action it introduces. New
  `## Steps (narrated procedure)` section reads like a draft SOP.
- **Stated task goal.** Popup field → `manifest.task` → bold callout at the top of
  `context.md`. The single best intent anchor.
- **Capture purpose (steers the analysis).** Required popup selector (skill / docs /
  ux / improve / general; pick ≥1) → `manifest.purposes` → a `## Purpose of this
  recording` steer block at the top of `context.md` giving each purpose its reading
  lens + deliverable. Same recording → a skill, a doc, UX feedback, or an efficiency
  teardown depending on intent. BRIEF.md defers to it and documents `feedback.md` /
  `improvements.md`.
- **Frame linking + "draw on screen".** Each click links to its nearest frame
  (`→ frames/x.png @(x%,y%)`); `build_pack` writes `frames-annotated.html` drawing a
  ring at the click point + the element's box on each screenshot. Verified end-to-end
  on the real ESPN recording and visually in a browser.
- Updated `analyze/BRIEF.md` so the consuming agent uses the task/steps/tabs/annotated
  frames. 61 unit tests green (+ harness for the DOM capture).

## 2026-06-17 — self-driving pack: bundled skills + UI-change capability

- **Post-transfer consumption skill.** Each pack now ships
  `agent-skills/analyze-capture/SKILL.md` — the procedure a receiving agent follows
  (read purpose → narration → identify → analyze under the lens → produce outputs).
  The pack README tells a coding agent to read it first. The pack is now self-driving,
  not reliant on prose.
- **UI-change capability + preloaded-skills mechanism.** Seed skill
  `agent-skills/ui-improvement/SKILL.md` turns observed friction into concrete UI
  changes and — when the app's source is available — locates the element by the
  captured selector and implements the change, then verifies. New **"Propose UI
  changes"** purpose (distinct from UX feedback: prescribe/apply vs. diagnose) →
  `ui-changes.md`. `build_pack` bundles `analyze-capture` always + skills mapped to the
  purpose via `SKILLS_FOR_PURPOSE`. **Extend by dropping a skill into
  `analyze/skills/<name>/` and adding a purpose→skill mapping** — Adam can add more
  activity skills (UI or otherwise) and they travel with the pack.

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
