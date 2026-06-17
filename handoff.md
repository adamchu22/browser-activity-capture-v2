# Handoff (v2)

_Last updated: 2026-06-17 (v2 capture rework built, not yet live-verified)_

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

## Exact next step — RE-RUN LIVE TEST (picker fix needs verifying)

**▶ NEXT ACTION: re-run `LIVE-TEST.md` in real Chrome.** Run 1 (2026-06-17) confirmed
multi-tab capture works but the screen picker failed and a URL token leaked. Both are
now fixed in code (recorder-page picker + `redactUrl`). The re-run must confirm:
1. Chrome's "Choose what to share" dialog opens after **Start in the popup** (via
   getDisplayMedia in the offscreen doc) and a `video.webm` lands in the bundle;
2. `validate_bundle.py` returns **PASS** (run 1 failed on the leaked `?jwt=` token);
3. the rest still holds — `## Tabs` + `━━━ tab #N ━━━` markers, narrated `## Steps`,
   semantic click labels, and `frames-annotated.html` markers on the right elements.

**Record the outcome in `learnings.md`** — especially whether the recorder-page picker
worked, and anything else that broke.

After it passes: build the **on-screen control overlay** (Pause/Cancel/Restart/Finish).

After the live test passes: build the **on-screen control overlay**
(Pause/Cancel/Restart/Finish) — in v2 a single overlay visible regardless of which tab
is focused. (Deferred until now because its cross-tab design depends on confirming the
live multi-tab behavior first.)

## Known caveats

- The screen picker may steal focus and close the popup — by design; the worker
  runs `start()` independently, so recording still proceeds.
- Restricted pages (`chrome://`, web store, etc.) are skipped, not instrumented.
- v1's mic-grant flow is unchanged and still required for narration.
