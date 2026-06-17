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

> **Video path rebuilt (2026-06-17 fix #2).** Run 1 proved `desktopCapture` from the
> worker can't open the picker, and research showed its streamId isn't consumable in
> an offscreen doc anyway ("Invalid state"). Video now uses **`getDisplayMedia()` inside
> the offscreen document** (Chrome's recommended MV3 path), so **Start is back in the
> popup** — no dedicated page needed. The picker is Chrome's own "Choose what to share"
> dialog, shown after Start.

## The test

1. Open **two or three normal website tabs** (not `chrome://`). Optionally a second
   window.
2. In the popup, type a one-line **task goal** and optionally tick a **purpose**
   (none → *general*). Then **Start**.
   - **⚠ RISK 1 (re-test) — the screen picker.** Chrome's **"Choose what to share"**
     dialog should now appear (run 1 showed nothing). Pick a **screen** (best for
     follow-across-tabs) or a window. If it instead errors with a gesture complaint,
     note it — that's the one residual unknown for getDisplayMedia-in-offscreen.
   - Expect a red **REC** badge and a `video.webm` in the final bundle (run 1 had none).
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

## If the picker STILL never shows (RISK 1 — after the getDisplayMedia fix)

Video now comes from `getDisplayMedia({video:true})` called inside the offscreen
document (`offscreen.js`), which the worker creates with the `DISPLAY_MEDIA` reason.
If no "Choose what to share" dialog appears or `errors.json` notes a video failure:
1. Check the offscreen error in `errors.json` — a gesture complaint
   (`getDisplayMedia must be called from a user gesture`) means this Chrome build
   doesn't waive activation in offscreen. Fix: relay the popup's click activation, or
   call `getDisplayMedia` from a short-lived extension page opened on Start.
2. Confirm the offscreen doc was created with reason `DISPLAY_MEDIA` (it is).
3. `getUserMedia`/`Invalid state` errors mean something still passes a desktopCapture
   streamId — there should be none left.

Record the outcome in `learnings.md` so the next person doesn't re-derive it.
