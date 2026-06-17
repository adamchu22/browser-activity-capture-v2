# Chrome extension — Capture Bundle producer

An MV3 Chrome extension that records one browser task and exports a **Capture
Bundle** — the exact shape [`../analyze/pack.py`](../analyze/pack.py) consumes
and [`../sample-bundle/`](../sample-bundle/) illustrates.

> **Status: scaffold.** The clock, event/timeline capture, CDP→HAR network
> capture, frame capture, bundle assembly, and zip export are wired and loadable.
> Two third-party pieces are marked integration points (see below): rrweb (DOM
> stream) and the video MediaRecorder path.

## The one idea

The service worker owns a single `t0`. Every modality — DOM events, clicks,
network requests, screenshots, video — is stamped as **milliseconds since t0** at
the moment it reaches the worker. So everything is aligned by construction; there
is no post-hoc syncing. This is the whole reason to self-record the tab rather
than bolt onto Loom. See [`../docs/02-design.md`](../docs/02-design.md).

## Load it

1. Vendor rrweb (optional but recommended — without it you still get the
   high-level timeline, just no raw DOM stream):
   ```bash
   # Use the UMD/global build — it exposes window.rrweb, which content.js needs.
   # (dist/rrweb.min.js is the ESM build in 2.0.0 and won't expose a global.)
   curl -L https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs \
        -o src/lib/rrweb.min.js
   ```
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick
   this `extension/` folder.
3. Pin the extension, open a tab, click **Start recording this tab**.
4. Do your task (narrate aloud if you want a transcript — see below). Click
   **Stop & export** → a `capture-<timestamp>.zip` downloads.
5. Unzip and run it through the analysis step:
   ```bash
   python ../analyze/pack.py ./capture-<timestamp> --out ./analysis-pack
   ```

## What it captures

| Modality | Source | Bundle file |
|---|---|---|
| Clicks / inputs / Enter-Tab-Esc / nav | content-script DOM listeners | `timeline.json` |
| Where you point (hover dwell) + click/hover position | content-script pointer-dwell + x/y, % of viewport, element rect | `timeline.json` (+ `frames/`) |
| Raw DOM mutations | rrweb (`src/lib/rrweb.min.js`) | `events.jsonl` |
| HTTP requests + bodies | CDP `Network` via `chrome.debugger` | `network.har` |
| Screenshots at clicks/navs/hovers | `chrome.tabs.captureVisibleTab` | `frames/` |
| Screen video | offscreen `MediaRecorder` + `tabCapture` | `video.webm` |
| Narration (your voice) | mic merged into the offscreen recorder | `video.webm` (audio track) |
| Narration timing | `speech` timeline events (see below) | `transcript.vtt` |

## Files

- `manifest.json` — MV3 manifest, permissions, content-script + offscreen wiring.
- `src/background.js` — **the master clock + bundle assembler.** Owns t0, attaches
  the debugger for HAR, captures frames, buffers to IndexedDB, builds the zip.
- `src/content.js` — in-page capture: rrweb + click/input/key/nav, with
  password/secret masking before anything leaves the page.
- `src/redact.js` — canonical redaction (headers, bodies, secret/email values).
- `src/db.js` — IndexedDB append-log (MV3 workers are ephemeral; nothing is held
  in memory).
- `src/zip.js` — dependency-free STORE zip writer.
- `src/offscreen.{html,js}` — MediaRecorder host for tab video + mic narration
  (merges the tab's video track with a `getUserMedia` mic stream on one clock).
- `src/popup.{html,js}` — start/pause/stop, blocklist, status.
- `src/lib/rrweb.min.js` — **placeholder**; drop the real UMD build here.

## Privacy / redaction (non-negotiable)

Redaction happens **before disk**, in two layers:

- **In-page** (`content.js`): password fields and secret-named inputs are never
  captured in the clear; rrweb runs with `maskAllInputs`.
- **In-worker** (`redact.js`): `Authorization`, `Cookie`, `Set-Cookie` (and
  similar) headers are stripped from every HAR entry; JSON/form bodies have
  secret-named keys masked.

A per-host **blocklist** in the popup stops recording on sensitive domains
entirely. There is no setting to disable redaction, and the analysis step is
instructed never to reconstruct redacted values.

## Narration → transcript

Your voice is recorded into `video.webm`'s audio track (the offscreen recorder
merges the mic with the tab video; toggle it with **Record microphone** in the
popup, on by default). The bundle still ships a `transcript.vtt` stub. Two ways
to turn the narration into aligned cues:

1. Transcribe `video.webm` afterward (Whisper/Parakeet) and drop the result in as
   `transcript.vtt`. Because the mic shares t0 with everything else, the cues line
   up to the millisecond — no offset to solve. `manifest.json`'s
   `narration_in_video` flag tells you whether the audio is actually there.
2. Or feed `speech` events into the timeline (`{ kind: "speech", text }`) from a
   live transcriber — the worker already turns them into VTT cues on export.

## Known gaps (next after scaffold)

- Vendor rrweb and verify the `events.jsonl` stream end-to-end.
- Verify the offscreen `tabCapture` video path on a real Chrome (permissions +
  `getUserMedia` tab constraints vary by version).
- Verify mic narration lands in `video.webm` on real Chrome: the `audioCapture`
  permission should grant the mic to the extension origin without a prompt, but
  offscreen-document mic access is version-sensitive — confirm
  `narration_in_video: true` and audible voice on a first real capture.
- Stronger selectors (a `finder`-style unique-selector lib) for replayable steps.
- Live narration transcriber wiring (option 1 above).
