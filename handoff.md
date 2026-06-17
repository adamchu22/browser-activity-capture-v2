# Handoff (v2)

_Last updated: 2026-06-17 (P1 overlay + P1b capture-on-nav bug fix CODE DONE, tests green; next: one live run to verify both, then P2)_

## ⚠ P1b — capture died on navigation (FIXED in code; live-verify is the sign-off)

A real 6-min session lost ~4.5 min of DOM + visual capture: on a server-rendered app, the
first full-page navigation tore down the content script while the CDP debugger kept network
flowing — so clicks/rrweb/frames stopped at 1:43 but network ran to 5:53, and the bundle still
"validated." Root cause + fix in `learnings.md`. **Fix (done):** worker re-arms the content
script on every navigation (`reattachTab` via `tabs.onUpdated`; gating in pure `nav-policy.js`,
unit-tested); content-script self-attach now retries; frames moved to a 3s timer (decoupled
from DOM events). **Diagnostic:** `analyze/check_coverage.py` detects the signature on any
bundle (FAILs the original bad one). **Sign-off:** re-record the distru-freemium flow and run
`python3 analyze/check_coverage.py <bundle>` → must PASS. This shares the same live run as P1.

## ▶ NEXT — one live run verifies P1 + P1b, then start P2 (Selector + Draw annotations)

**P1 (on-screen recording overlay) is CODE-COMPLETE and unit-tests pass; it has NOT been
live-verified in Chrome yet.** A shadow-DOM pill (the `overlay` IIFE in `content.js`) shows
Finish / Pause / Restart / Cancel during recording, in every instrumented tab, kept in sync
by the worker (`broadcastOverlay()` pushes `{recording, paused, t0}`). Worker-side semantics
live in `background.js` (`pause/resume/restart/cancel`) and are mirrored onto the offscreen
MediaRecorder (`offscreen-pause/-resume/-restart/-cancel`). Restart reuses the live
getDisplayMedia tracks (no re-prompt) and re-inits rrweb per tab so the new take keeps a base
snapshot — see `learnings.md` for the two gotchas. Restart/Cancel take a 2-click confirm.

**▶ NEXT ACTION (do this first): one live run verifies BOTH P1 and P1b.** Load unpacked.
*For P1b (the important one):* record on the **server-rendered** distru-freemium app
(127.0.0.1:8765), click through several full-page navigations (the `/fixes?filter=…` views),
Stop, then `python3 analyze/check_coverage.py <bundle>` → must **PASS** (clicks + frames
present after the first navigation, content capture tracks network). *For P1 (the overlay):*
also record across ≥2 tabs and check the pill appears on each tab; Pause freezes the timer +
amber dot + stops the recorder; Restart resets to 00:00 and the bundle still validates +
replays (rrweb snapshot present); Cancel exports nothing; Finish exports a PASS bundle.
See the live-verify checkboxes in `to-do-current.md` (P1 + P1b blocks).

**Then P2** — the two annotation tools (Selector: snaps to DOM via the existing
`selectorFor()`+`describe()`, emits `annotation:select`; Draw: freeform region, emits
`annotation:draw`). Both mid-recording, both on the overlay. Then P3 popup→dropdown +
Settings, then P4 analyze-side rendering of the annotation events.

**P0 (self-driving zip + audio fix) remains DONE + live-verified.** Every export embeds
`CLAUDE.md` + `AGENTS.md` (from `extension/src/bundle-docs.js`) with the read order, analysis
procedure, and the audio-recovery fallback (stub transcript → Opus track in `video.webm`,
recover with ffmpeg + local ASR; the docs now also include the `uv pip install mlx-audio`
setup step). Tests (whole repo): node 29 (redact + bundle-docs + nav-policy) + python 78
(incl. the new `test_check_coverage.py`) all green.

Why P0 was needed (verified): the raw zip's README pointed at `../analyze/pack.py` (a path a
recipient won't have); the self-driving layer only existed in the *pack*, not the zip; and
`pack.py` doesn't copy `video.webm` into the pack (`RAW_FILES`, line 35), so a pack built from
a stub-transcript bundle lost the narration entirely. See `learnings.md` and P4b.

## ✅ Done — entire-screen + app-switch run verified, feedback captured

The entire-screen + app-switch test is **done and confirmed**: `outputs/capture-2026-06-17T14-36-28-587Z.zip`
**validates PASS** (263 events, `video.webm` 48 MB with an Opus mic-narration audio track,
`errors.json` empty). Frames confirm the video captured the **whole screen across both
Chrome and Comet** (a second browser without the extension). The app-switch is visible
in the video only — structured DOM/click/network capture covers instrumented browser
tabs, as designed.

**Adam's feedback on the tool is now captured** in `to-do-current.md` (the "🎯 ADAM'S
FEEDBACK" block) — transcribed from his narration. Headline asks: compact dropdown popup;
move blocklist + download-folder into Settings; countdown; face-cam bubble; an on-screen
overlay (Finish/Pause/Restart/Cancel, no rewind/trim); and — the big one — **two separate
annotation tools, Selector (element-snapping, for user↔agent alignment) and Draw (freeform
region highlight)**, plus an element-aware Blur. Reference UI he likes: the Loom extension.

_Transcription note: the v2 `.venv` was absent on this machine, so the narration was read
with a throwaway faster-whisper env. The product's `transcribe.py` (parakeet/qwen default)
is unchanged; it reuses model weights already on disk and does not depend on TypeWhisper running._

## What this is

v2 of `browser-activity-capture`, forked from the working v1 tool (which lives in
its own repo, untouched). Two things changed in v2:

**Capture model** — from **one pinned tab** to **full-screen video + all-tabs
instrumentation**: records the whole screen (follows you across tabs/windows) and
attaches the CDP debugger + content script to every eligible tab, including tabs
opened mid-recording. Events are tagged with their source tab; `pack.py` renders a
tab legend + tab-switch markers.

**Self-driving pack** — the analysis pack now ships the skills a receiving agent
uses, in `agent-skills/`: `analyze-capture` (the consumption procedure — read it
first) always, plus activity skills mapped to the recording's purpose. Seed skills: `ui-improvement` (friction → concrete UI changes, *implemented* when the
app's source is present) and `competitive-research` (teardown of another product — UX
patterns + architecture from the network → `research.md`). Extend by adding a skill to
`analyze/skills/<name>/` and a `SKILLS_FOR_PURPOSE` mapping in `pack.py`.

Purposes available: skill, docs, ux, ui, improve, research, general.

**Intent capture** — to make the bundle 10x more legible to the analyzing model:
a stated **task goal**; a required **purpose** (skill / docs / ux / improve / general)
that renders a steer block at the top of context.md so the *same* recording yields a
skill, a doc, UX feedback, or an efficiency teardown depending on why it was recorded;
**semantic element context** (accessible name / role / section, so "click button
'Issue refund' in 'Order actions'" not a selector); a **narrated procedure**
(`## Steps`, segmenting the timeline and binding narration to each step); and **frame
linking + a `frames-annotated.html`** drawing the click point + element box on each
screenshot.

The `analyze/` pipeline (validate → transcribe → glossary → pack) is inherited from
v1 and works the same; it now also renders the multi-tab data.

## Status — two live runs done (2026-06-17): capture + video work; redaction closed

Two real-Chrome runs in (Adam's machine). Results — see `learnings.md`:
1. **✅ Multi-tab / all-tabs instrumentation (RISK 2) works.** 3 tabs tagged +
   instrumented; a tab opened mid-recording got instrumented too.
2. **✅ Video works (RISK 1 fixed, confirmed run 2).** `desktopCapture`-from-worker
   was a dead end (no picker; streamId also not consumable in offscreen → "Invalid
   state"). Rebuilt on `getDisplayMedia()` inside the offscreen doc (reason
   `DISPLAY_MEDIA`) — Chrome's recommended MV3 path; **Start stays in the popup**,
   dropped the `desktopCapture` permission. Run 2: Start → "Choose what to share" →
   12 MB `video.webm`, `errors.json` empty. (A first recorder-page attempt was the
   wrong layer and was reverted.)
3. **✅ Redaction closed across all three URL sinks.** The same `?jwt=` token leaked
   in run 1 (`timeline.json`+`network.har`) and again in run 2 (`events.jsonl`, the
   rrweb DOM stream, via `<img src>`). Fixed: `redactUrl()` at the worker URL sinks +
   `scrubNode()` on every rrweb node. `validate_bundle.py` gated both. Locked by
   `tests/test_redact.mjs` (7 tests).

**✅ End-to-end PASS (run 3, `outputs/v2-test-2-jwt-fix.zip`).** First fully-clean
bundle: `validate_bundle.py` PASS (0 warnings), zero tokens in timeline/HAR/events.jsonl,
`video.webm` present, `errors.json` empty, 267 timeline events. v2 capture + video +
redaction are all live-verified. (Runs 1 & 2 were pre-fix and still fail, as expected.)

Analyze side: 70 python tests + 6 node redact tests, all green.

## How to run it

1. **Load**: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
   (Vendor rrweb first if missing — see `extension/FIRST-CAPTURE.md` §0.)
2. **Record**: open a few tabs → popup → set task/purpose → **Start** → **choose a
   screen** in Chrome's "Choose what to share" dialog → work across tabs, narrate →
   Stop & export → `capture-*.zip`.
3. **Validate**: `python3 analyze/validate_bundle.py <zip>`
4. **Transcribe** (local, needs the `.venv` — see `analyze/README.md`):
   `.venv/bin/python analyze/transcribe.py <bundle-dir>` (default parakeet; auto-runs
   the glossary post-pass).
5. **Pack**: `python3 analyze/pack.py <bundle-dir> --out <pack>` → read
   `<pack>/context.md` (look for the `## Tabs` section + `━━━ tab #N ━━━` markers).

## Tests

`python3 -m unittest discover -s tests` — 70 tests (glossary, network-noise collapse,
multi-tab rendering, semantic labels + step segmentation + frame annotation, purpose
steer, bundled skills incl. competitive-research). Stdlib only.
`node --test tests/test_redact.mjs` — 6 tests for the extension's URL/value redaction
(the 2026-06-17 leak fix). The content.js unique-selector AND semantic-context
(`describe()`) logic is verified in real Chromium via
`tests/browser/selector-harness.html` (browser, not unittest) — `allUnique`,
`allIdentify`, and `allCtxPass` all true.

## Exact next step — one live run verifies P1 + P1b, then build P2

Both are code-complete with unit tests; a single live Chrome run signs off both.
Files touched this session:
- **P1b (capture-on-nav fix):** `background.js` (`reattachTab`, rewritten `onUpdated`
  listener, 3s `startFrameTimer`/`stopFrameTimer`), `nav-policy.js` (new, pure gating),
  `content.js` (retrying `selfAttach`), `analyze/check_coverage.py` (new diagnostic).
- **P1 (overlay):** `content.js` (`overlay` IIFE + `restartCapture`/`startRrweb`),
  `background.js` (`broadcastOverlay` + `pause/resume/restart/cancel` + `overlay-command`),
  `offscreen.js` (MediaRecorder pause/resume/restart/cancel, retained `activeTracks`).

After the live run, build **P2** (Selector + Draw annotations on the overlay), then P3
popup→dropdown + Settings, then P4 analyze-side rendering.

## Known caveats

- The screen picker may steal focus and close the popup — by design; the worker
  runs `start()` independently, so recording still proceeds.
- Restricted pages (`chrome://`, web store, etc.) are skipped, not instrumented.
- v1's mic-grant flow is unchanged and still required for narration.
