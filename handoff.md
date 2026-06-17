# Handoff (v2)

_Last updated: 2026-06-17 (v2 capture rework built, not yet live-verified)_

## What this is

v2 of `browser-activity-capture`, forked from the working v1 tool (which lives in
its own repo, untouched). v2 changes the capture model from **one pinned tab** to
**full-screen video + all-tabs instrumentation**: it records the whole screen
(follows you across tabs/windows) and attaches the CDP debugger + content script to
every eligible tab, including tabs opened mid-recording. Every event is tagged with
its source tab; the bundle carries a tab legend and `pack.py` renders tab-switch
markers.

The `analyze/` pipeline (validate → transcribe → glossary → pack) is inherited from
v1 and works the same; it now also renders the multi-tab data.

## Status — built, static-checked, NOT live-verified

All v2 code is committed. Extension files parse, manifest is valid JSON, and the
analyze side has 37 passing unit tests. **But the extension has not run in a real
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

`python3 -m unittest discover -s tests` — 37 tests (glossary, network-noise collapse,
multi-tab rendering). Stdlib only. The content.js unique-selector logic is verified
separately via `tests/browser/selector-harness.html` (browser, not unittest).

## Exact next step

Run `LIVE-TEST.md` and record the outcome in `learnings.md` — especially which path
made the screen picker work (worker vs. popup vs. action.onClicked). Then build the
**on-screen control overlay** (Pause/Cancel/Restart/Finish) — in v2 it should be a
single overlay that's visible regardless of which tab is focused.

## Known caveats

- The screen picker may steal focus and close the popup — by design; the worker
  runs `start()` independently, so recording still proceeds.
- Restricted pages (`chrome://`, web store, etc.) are skipped, not instrumented.
- v1's mic-grant flow is unchanged and still required for narration.
