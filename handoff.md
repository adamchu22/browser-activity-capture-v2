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

## Status — built, static-checked, NOT live-verified

All v2 code is committed. Extension files parse, manifest is valid JSON, and the
analyze side has 70 passing unit tests. **But the extension has not run in a real
browser from this environment** — there's no Chrome runtime here. Before trusting
v2, run `LIVE-TEST.md`. Two highest-risk unknowns it checks:
1. the screen picker actually opening from the worker (`desktopCapture`), and
2. tabs opened mid-recording getting instrumented (`tabs.onUpdated`).

## How to run it

1. **Load**: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
   (Vendor rrweb first if missing — see `extension/FIRST-CAPTURE.md` §0.)
2. **Record**: open a few tabs → popup → Start → **pick a screen in the picker** →
   work across tabs, narrate → Stop & export → `capture-*.zip`.
3. **Validate**: `python3 analyze/validate_bundle.py <zip>`
4. **Transcribe** (local, needs the `.venv` — see `analyze/README.md`):
   `.venv/bin/python analyze/transcribe.py <bundle-dir>` (default parakeet; auto-runs
   the glossary post-pass).
5. **Pack**: `python3 analyze/pack.py <bundle-dir> --out <pack>` → read
   `<pack>/context.md` (look for the `## Tabs` section + `━━━ tab #N ━━━` markers).

## Tests

`python3 -m unittest discover -s tests` — 70 tests (glossary, network-noise collapse,
multi-tab rendering, semantic labels + step segmentation + frame annotation, purpose
steer, bundled skills incl. competitive-research). Stdlib only. The content.js unique-selector AND semantic-context (`describe()`) logic is
verified in real Chromium via `tests/browser/selector-harness.html` (browser, not
unittest) — `allUnique`, `allIdentify`, and `allCtxPass` all true.

## Exact next step — LIVE TEST (happening now)

**▶ NEXT ACTION: run `LIVE-TEST.md` end to end in real Chrome.** This is the immediate
next thing — all v2 code is built and unit-tested, but unverified in a live browser.
The run will confirm (or break) the two risk items: the `desktopCapture` screen picker
opening from the popup→worker path, and `tabs.onUpdated` instrumenting tabs opened
mid-recording. Also eyeball the intent layer in `context.md` (Task callout, Purpose
steer, narrated `## Steps`, semantic click labels, `## Tabs` + `━━━ tab #N ━━━`
markers) and that `frames-annotated.html` draws markers on the right elements.

**Record the outcome in `learnings.md`** — especially which path made the screen picker
work (worker vs. popup vs. `action.onClicked`), and anything that broke.

After the live test passes: build the **on-screen control overlay**
(Pause/Cancel/Restart/Finish) — in v2 a single overlay visible regardless of which tab
is focused. (Deferred until now because its cross-tab design depends on confirming the
live multi-tab behavior first.)

## Known caveats

- The screen picker may steal focus and close the popup — by design; the worker
  runs `start()` independently, so recording still proceeds.
- Restricted pages (`chrome://`, web store, etc.) are skipped, not instrumented.
- v1's mic-grant flow is unchanged and still required for narration.
