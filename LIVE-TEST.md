# Live test — verify v2 capture in real Chrome

The v2 capture rework (full-screen video + all-tabs instrumentation) is **built and
static-checked but not yet verified in a live browser** — this environment has no
extension runtime. Run this once on a real machine to confirm it works, then record
the outcome in `learnings.md`.

Every item is something I could not test without live Chrome. The two highest-risk
unknowns are marked **⚠ RISK**.

## Setup

1. Vendor rrweb if missing (optional, for the raw DOM stream):
   ```bash
   cd extension
   curl -L https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs -o src/lib/rrweb.min.js
   ```
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
   Confirm no red **Errors** button (a manifest/permission problem shows here).
   The card should read **Browser Activity Capture v2 / 0.2.0**.
3. One-time mic grant (for narration): popup → **Enable microphone…** → Allow in the
   tab that opens. (Unchanged from v1.)

## The test

1. Open **two or three normal website tabs** (not `chrome://`). Optionally a second
   window.
2. In the popup, type a one-line **task goal** ("What are you doing in this
   recording?") and tick at least one **purpose** ("Why are you recording?" — e.g.
   *Build a skill*, *UX feedback*). Start is blocked until a purpose is picked. Then
   **Start**.
   - **⚠ RISK 1 — the screen picker.** A Chrome "Choose what to share" picker should
     appear. Pick a **screen** (or a window). If no picker appears, `desktopCapture`
     wasn't triggered from the worker — see "If the picker never shows" below.
   - Picking the target may close the popup. That's fine — the worker keeps running.
   - Expect a red **REC** badge.
   - Expect the **"… is being debugged"** banner on **every** eligible tab (that's
     the per-tab CDP network capture — confirms all-tabs instrumentation).
3. Do a cross-tab task (~30s), narrating aloud:
   - Click/type in tab 1, **switch to tab 2** and do something, open a **brand-new
     tab**, navigate it, act in it, switch back.
   - **⚠ RISK 2 — new-tab instrumentation.** The brand-new tab should also get the
     "is being debugged" banner shortly after it loads. If it doesn't, the
     `tabs.onUpdated` listener isn't attaching the debugger to new tabs.
4. Popup → **Stop & export** → save `capture-<timestamp>.zip`.

## Verify the bundle

```bash
python3 analyze/validate_bundle.py ~/Downloads/capture-<timestamp>.zip   # expect PASS
# unzip it, then:
python3 analyze/transcribe.py <bundle-dir>        # narration → transcript.vtt (+ glossary)
python3 analyze/pack.py <bundle-dir> --out ./pack
```

In `pack/context.md` confirm the v2 signal:
- your typed **Task** and a **## Purpose of this recording** steer block (the
  lenses + outputs for the purpose(s) you picked) appear at the very top;
- a **## Steps (narrated procedure)** section that reads like a draft SOP, with your
  narration bound to each step and clicks described semantically (e.g. `click button
  "…" in "…"`, not a bare selector);
- a **## Tabs (recorded in parallel)** section + **`━━━ tab #N ━━━`** switch markers
  where you moved between tabs;
- clicks/network from **all** the tabs (not just the one you started on);
- `video.webm` plays back your **whole screen** following you across tabs;
- the narration you spoke is interleaved as `🗣` lines on the same clock.

Then open **`pack/frames-annotated.html`** in a browser: each click/hover frame should
show a red ring on the spot you clicked and a box around the element. (Confirms the
captured coordinates + element rect line up with what was on screen.)

Also confirm the pack is self-driving: `pack/agent-skills/analyze-capture/SKILL.md`
exists, plus `ui-improvement` if you picked a UX/UI purpose. Point a coding agent at
the pack and tell it to read that skill first — it should produce the outputs your
purpose named.

## If the picker never shows (RISK 1 fallback)

`chrome.desktopCapture.chooseDesktopMedia` is called from the service worker
(`startVideo` in `background.js`). If Chrome requires a user gesture it can't see
through the popup→worker message, the picker won't open and `errors.json` will note
"screen picker cancelled". Fix options, in order of preference:
1. Call `chooseDesktopMedia` from a context with a live gesture — e.g. move Start to
   `chrome.action.onClicked` (drop the popup for starting), or call it in the popup's
   click handler and pass the `streamId` to the worker.
2. Confirm the `desktopCapture` permission is present in `manifest.json` (it is).

Record which path worked in `learnings.md` so the next person doesn't re-derive it.
