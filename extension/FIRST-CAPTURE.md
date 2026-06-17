# First capture — a 5-minute smoke test

Goal: prove one real recording round-trips all the way through the pipeline. Do
this once before refining anything; whatever breaks here tells us what to fix.

## 0. Vendor rrweb (optional, 30s)

Without it you still get the high-level timeline; with it you get the raw DOM
stream in `events.jsonl`.

```bash
cd browser-activity-capture/extension
# UMD/global build (exposes window.rrweb); the dist/rrweb.min.js name is ESM in 2.0.0.
curl -L https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs -o src/lib/rrweb.min.js
```

## 1. Load the extension

1. `chrome://extensions` → toggle **Developer mode** (top right).
2. **Load unpacked** → select `browser-activity-capture/extension/`.
3. Confirm it loads with no errors. If there's a red **Errors** button, open it —
   that's a manifest/syntax problem, fix before continuing.
4. Pin it (puzzle-piece icon → pin).

## 2. Record a throwaway task (v2 — full screen, all tabs)

> v2 records your **whole screen** and instruments **every** open tab, so it follows
> you across tabs and windows. (v1 recorded a single pinned tab.) For the detailed
> verification checklist, see `../LIVE-TEST.md`.

1. Open **two or three normal website tabs** (not `chrome://`, not the web store —
   those are skipped by the restricted-page guard).
2. For narration: leave **Record microphone (narration)** checked. The first time,
   the popup shows "Microphone not enabled" with an **Enable microphone…** button —
   click it, then **Allow** in the tab that opens. This grants the mic to the
   extension once; after that the popup shows "Microphone enabled ✓" and every
   recording includes your voice. (An MV3 offscreen doc can't prompt for the mic
   itself, which is why the grant goes through that page.) Then click the
   extension → **Start**.
   - A Chrome **"Choose what to share"** picker appears — pick a **screen** (or
     window). Picking it may close the popup; that's fine, recording continues.
   - Expect a **"… is being debugged"** banner on **every** open website tab. That
     IS the per-tab network capture.
   - Expect a red **REC** badge on the icon.
   - If you cancel the picker, recording continues **data-only** (clicks/network/DOM,
     no video). If the mic is blocked, it continues without narration (non-fatal).
3. Do a short cross-tab task: click/type in one tab, **switch to another tab**, open
   a **new tab** and navigate it, act there, switch back. ~30 seconds. Narrate aloud
   — that audio lands in `video.webm` on the same clock as everything else. To test
   pointer capture, pause your cursor (~½s) over an area you're describing — that
   logs a `hover` with its position.
4. Click **Stop & export** → a **Save** dialog → save `capture-<timestamp>.zip`.

## 3. Validate before analyzing

```bash
cd browser-activity-capture
python analyze/validate_bundle.py ~/Downloads/capture-<timestamp>.zip
```

Expect `PASS — Ready for pack.py.` The validator checks shape, the one-clock
ordering, that referenced frames exist, **and that no auth headers / tokens
leaked**. If it says FAIL, read the `✗` lines — that's your fix list.

## 4. Run the analysis pipeline

```bash
mkdir -p /tmp/cap && cd /tmp/cap && unzip ~/Downloads/capture-<timestamp>.zip
cd /path/to/browser-activity-capture
python analyze/pack.py /tmp/cap --out /tmp/analysis-pack
```

Then open `/tmp/analysis-pack/context.md` and read it top to bottom. That's the
real test: **does the flattened recording read like your task?**

## What "good" looks like

| Check | Expected |
|---|---|
| zip contents | `manifest.json`, `timeline.json`, `events.jsonl`, `network.har`, `transcript.vtt`, `frames/*.png`, maybe `video.webm` |
| `validate_bundle.py` | PASS, 0 errors |
| `context.md` timeline | your clicks/inputs/navs in order, with `mm:ss` stamps |
| pointer | clicks show `@(x%,y%)`; pausing over an area logs `👆 hover … @(x%,y%)` so blank-area references resolve |
| frames | screenshots at the clicks/navs you made |
| narration | `manifest.json` has `"narration_in_video": true`, and playing `video.webm` you hear what you said |
| redaction | any password you typed shows as `‹redacted:secret›`; no `Authorization`/`Cookie` values in `network.har` |

## Likely failure modes (and what they mean)

| Symptom | Cause → fix |
|---|---|
| Popup: "Can't record this page" | You're on a chrome/internal page. Use a normal site. |
| `timeline.json` has nav/network but **no clicks/inputs** | Content script didn't attach. Reload the tab, re-record. (Guarded, but a tab opened pre-install needs one reload.) |
| `events.jsonl` empty | rrweb not vendored (step 0) — expected, non-fatal. |
| `network.har` has no entries | Debugger didn't attach (banner missing?). Another DevTools/debugger may be open on that tab — close it. |
| No `video.webm` | `tabCapture`/offscreen path failed — non-fatal for now; note the console error and we'll fix it. |
| `video.webm` has no voice (`narration_in_video: false`) | Mic checkbox off, mic not enabled (click **Enable microphone…** in the popup → Allow), or blocked at the OS level (macOS System Settings → Privacy → Microphone allows Chrome). Re-record. |
| `frames/` empty | Tab/window wasn't focused during capture (`captureVisibleTab` needs the active tab). Keep the tab in front. |

## After the run

Tell me what `validate_bundle.py` said and paste (or describe) the
`context.md` timeline. That real output drives the refinements — selectors,
narration wiring, video — instead of guessing against the hand-made sample.
