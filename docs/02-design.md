# Design: the alignment + packaging layer

## Goal (restated)

While you narrate and work through a task in Chrome, capture everything —
audio/transcript, screen, timestamped clicks/keystrokes/navigation, and network
requests — align it all on one timeline, and emit a single portable **Capture
Bundle**. That bundle is fed downstream to Claude to produce **skills, SOPs, and
automation suggestions**. Generation is a *separate, deliberate* step, not
automatic — the bundle is the product; assets are derived from it on demand.

## The one hard problem: keeping everything in sync

Every other piece is a solved tool. The thing that makes them *useful together*
is a shared timeline. Loom's video starts at its own `t=0`; rrweb stamps events
with `performance.now()`; the network log has its own clock. If these drift, the
AI can't tell which click caused which request, or what you were saying when you
did it.

**Principle: one master clock owns the session.** The extension records
`t0_wall = Date.now()` at "Start" and stamps *every* event as `ms since t0`.
Because rrweb events, network events, and our own screenshots all run in the same
extension context, they are **automatically in sync** — no alignment needed.

That leaves exactly one alignment problem: the **external video/transcript**
(Loom). Two ways to solve it, pick per-session:

- **Self-record (recommended for MVP, perfect sync):** the extension grabs the
  tab's audio+video itself via `chrome.tabCapture` / `getDisplayMedia` using the
  *same clock*. Then transcript (Whisper) is already aligned to the millisecond.
  Loom becomes an optional "pretty human-facing copy," not load-bearing.
- **Loom-as-source (one offset to solve):** you start Loom, then click Start in
  the extension. We store both wall-clock times and compute a single offset.
  Good enough to ~1–2 s; can be nudged later. More fragile, so it's the fallback.

Either way, the captured transcript ends up as timestamped cues on the master
timeline. No per-event guessing.

## Architecture

```
┌─────────────────────────── Chrome ───────────────────────────┐
│  Content script (per tab)          Service worker / offscreen │
│  • rrweb recorder  ─────────────►  • master clock (t0)        │
│  • fetch/XHR hook                  • buffers events → IndexedDB│
│  • input/keystroke hook            • chrome.debugger → HAR     │
│  • redaction (mask pw fields)      • tabCapture → video/audio  │
│                                    • captureVisibleTab → frames│
└───────────────────────────────────────────┬──────────────────┘
                                             │  "Stop & Export"
                                             ▼
                              ┌──────────────────────────────┐
                              │      Capture Bundle (.zip)    │
                              │  manifest.json               │
                              │  events.jsonl   (rrweb+input)│
                              │  network.har                 │
                              │  transcript.vtt              │
                              │  frames/000123.png …         │
                              │  video.webm  (or Loom URL)   │
                              │  timeline.json  ◄── the key   │
                              └───────────────┬──────────────┘
                                              │  (offline, deliberate)
                                              ▼
                              ┌──────────────────────────────┐
                              │  Compiler (script + Claude)   │
                              │  → SOP.md                     │
                              │  → skill/ (SKILL.md + steps)  │
                              │  → automation.suggestions.md  │
                              │  → flow.playwright.ts (opt)   │
                              └──────────────────────────────┘
```

## The Capture Bundle format

A plain folder (zipped). Everything an AI needs, nothing it has to reverse-engineer.

```
capture-2026-06-04-1430/
  manifest.json        # t0_wall, duration, urls visited, redaction policy, tool versions, sync-mode
  timeline.json        # ⭐ merged single stream: [{t, kind, payload}] across ALL modalities
  events.jsonl         # raw rrweb + input events (one per line, replayable)
  network.har          # standard HAR — opens in any DevTools
  transcript.vtt       # WebVTT cues, ms-aligned to t0
  frames/
    000123.png         # filename = ms offset; screenshot at moments of action
  video.webm           # self-recorded, OR omitted with a loom_url in manifest
  README.md            # human-readable summary of the session
```

`timeline.json` is the centerpiece — it's the *already-merged* view so the AI (or
a human) never has to do the join:

```json
[
  { "t": 0,     "kind": "nav",      "url": "https://app.example.com/login" },
  { "t": 1240,  "kind": "speech",   "text": "First I log in with the shared admin account" },
  { "t": 2110,  "kind": "click",    "selector": "#email", "text": "Email", "frame": "frames/002110.png" },
  { "t": 3050,  "kind": "input",    "selector": "#email", "value": "‹redacted:email›" },
  { "t": 4400,  "kind": "network",  "method": "POST", "url": "/api/session", "status": 200, "ms": 180 },
  { "t": 5200,  "kind": "nav",      "url": "https://app.example.com/dashboard" }
]
```

## Privacy & redaction (non-negotiable, built in from day 1)

Keystrokes + network = passwords, tokens, PII. The capture layer must:

- Mask `type=password` and any field tagged `data-capture-secret`.
- Redact `Authorization`, `Cookie`, `Set-Cookie` headers and known token params.
- Domain allow/block list; a visible recording indicator; a **Pause** button.
- All redaction happens **before** anything hits disk, locally. Nothing leaves
  the machine unless *you* hand the bundle off.

## MVP scope (what we actually build)

Deliberately thin. Reuse rrweb + Chrome APIs + your existing video/transcript.

1. **Chrome extension (MV3)** with Start / Pause / Stop & a recording indicator.
2. **Capture**: embed rrweb; add fetch/XHR + keystroke hooks with redaction.
3. **Network → HAR** via `chrome.debugger` (CDP Network domain).
4. **Frames**: `captureVisibleTab` on each significant action.
5. **One master clock**; buffer to IndexedDB (survives MV3 worker eviction).
6. **Export**: zip the Capture Bundle, including the merged `timeline.json`.
7. **Transcript ingest**: drop in a Loom/Whisper `.vtt`/`.srt`; align to t0.
8. **Compiler (separate)**: a script that sends `timeline.json` (+ frames) to
   Claude with a prompt that emits SOP.md + a skill folder + automation ideas.

Self-recorded tab video (step toward perfect sync) is a fast-follow if we decide
Loom alignment is too fiddly.

## Explicitly out of scope for MVP

- Whole-desktop capture (browser only).
- Building our own video recorder or ASR (reuse Loom/Whisper/Granola).
- A hosted backend / team sharing UI (bundle is a local file you pass around).
- Auto-publishing docs anywhere (the bundle is the handoff point).

## Open decisions (see chat)

1. **Video/transcript source** — self-record in the extension (perfect sync) vs.
   keep Loom as the source (one offset, more fragile)?
2. **Network depth** — metadata only (`webRequest`, no debugger banner) vs. full
   HAR with bodies (`chrome.debugger`, shows a "being debugged" banner)?
3. **Storage/handoff** — pure in-browser + "Download bundle" zip, vs. a tiny
   local companion app that writes straight to disk (bigger sessions, less limit).
4. **First build step** — scaffold the extension now, or first build the
   *compiler* against a hand-made sample bundle to lock the output shape?
