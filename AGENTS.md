# AGENTS.md

Guidance for coding agents (Claude Code, etc.) working in this repo. Read this
first; it orients you before you touch code.

## What this is

A browser-activity capture tool in two halves:

1. **`extension/`** — an MV3 Chrome extension that records a browser task across
   all tabs (clicks, keystrokes, navigation, network, screenshots, full-screen
   video, narration), aligns everything on **one master clock** (`t0`), and
   exports a portable **Capture Bundle** (a zip of plain files).
2. **`analyze/`** — a stdlib-only Python step that validates a bundle and
   flattens it into an **analysis pack** any agent/LLM can read to produce an
   SOP, an agent skill, and automation suggestions. **LLM-agnostic** — the
   recording is the product; the analysis model is whatever you point at the
   pack.

The bundle and the pack are the **stable contract**. Keep them stable; don't
fork the instructions per provider.

## Layout

```
extension/        MV3 Chrome extension — the capture producer
  manifest.json   MV3 manifest, permissions, content/offscreen wiring
  src/
    background.js   master clock (t0) + bundle assembler; owns IndexedDB, HAR, frames, zip
    content.js      in-page capture: rrweb + click/input/key/nav, secret masking before disk
    offscreen.js    MediaRecorder host for tab video + mic narration (one clock)
    redact.js       canonical redaction (headers, bodies, secret/email values)
    db.js           IndexedDB append-log (MV3 workers are ephemeral)
    zip.js          dependency-free STORE zip writer
    popup.*         start/pause/stop, blocklist, mic enable, status
    bundle-docs.js  embeds the agent-recovery guide into each bundle zip
    lib/rrweb.min.js   vendored UMD build (optional; without it, no raw DOM stream)
analyze/          bundle → analysis pack (stdlib Python)
  pack.py           the core: flatten a bundle into BRIEF.md + context.md + JSON + frames
  validate_bundle.py  shape/clock/redaction gate; run right after export
  transcribe.py     local ASR (parakeet/qwen3-asr/whisper) → transcript.vtt
  autopack.py       watch a folder, pack every new capture zip
  glossary.py / glossary.json  domain-term fixup ASR can't get right
  install_pointer.py  records analyze_dir + venv python + ASR engine/model path for bundles
  adapters/         optional per-provider runners (run_claude.py); instructions never fork
install.sh / install.ps1   the installer: rrweb + venv + speech engine + model + pointer
docs/             design + landscape
sample-bundle/    a hand-made example bundle (refund workflow) — develop analysis against it
tests/            Python (.py) + Node (.mjs) tests; see below
tools/            frame helper
```

## The one hard idea: one master clock

The extension service worker owns a single `t0` at "Start". Every modality —
rrweb DOM events, clicks/inputs/keys/nav, network via `chrome.debugger` → HAR,
screenshots via `captureVisibleTab`, video/narration via the offscreen
MediaRecorder — is stamped as **ms since t0** at the moment it reaches the
worker. So everything is **aligned by construction**; there is no post-hoc
syncing. This is the whole reason the extension self-records instead of bolting
onto an external recorder (Loom). Don't break this invariant: every new event
source must stamp against `t0`, not its own clock.

## Privacy / redaction (non-negotiable)

Redaction happens **before disk**, in two layers, and there is no setting to
disable it:

- **In-page** (`content.js`): `type=password` and `data-capture-secret` fields
  are never captured in the clear; rrweb runs with `maskAllInputs`.
- **In-worker** (`redact.js`): `Authorization`, `Cookie`, `Set-Cookie` (and
  similar) headers are stripped from every HAR entry; JSON/form bodies have
  secret-named keys masked.

A per-host **blocklist** (popup) stops recording on sensitive domains entirely.
**Never reconstruct redacted values.** The analysis step is instructed the
same; if you add any agent-facing doc, keep that instruction.

## Capture Bundle format (the contract)

A plain folder (zipped on export). Don't change the file names without updating
`validate_bundle.py`, `pack.py`, and the sample bundle together.

```
manifest.json     t0_wall, duration, urls, redaction policy, tool versions, narration_in_video
timeline.json     ★ the merged single stream: [{t, kind, payload}] across ALL modalities
events.jsonl       raw rrweb + input events (one per line)
network.har       standard HAR (opens in any DevTools)
transcript.vtt     WebVTT cues, ms-aligned to t0 (ships as a stub; filled by transcribe.py)
frames/000123.png  filename = ms offset; screenshot at moments of action
video.webm         self-recorded tab video + narration audio track (same clock)
```

`timeline.json` is the centerpiece — the *already-merged* view so an agent (or
human) never has to do the join.

## How to run things

```bash
# validate an exported bundle (zip or dir) — run right after export
python analyze/validate_bundle.py ~/Downloads/capture-<timestamp>.zip   # expect PASS

# build the analysis pack (stdlib; auto-transcribes if .venv exists)
python analyze/pack.py <bundle-dir> --out ./analysis-pack

# one-time local transcription setup (ffmpeg on PATH first)
bash install.sh          # macOS / Linux
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows

# transcribe a bundle by hand (default engine: parakeet on Apple Silicon)
.venv/bin/python analyze/transcribe.py <bundle-dir>
.venv/bin/python analyze/transcribe.py --selftest     # verify + pre-warm model

# glossary fixup standalone (no venv needed)
python analyze/glossary.py <bundle-dir>
```

On this machine Python is invoked as `python` (not `python3`); it points to
Python 3.

## Tests

Tests live in `tests/`. Two flavors, run separately:

```bash
# Python tests (analyze/ side): unittest
python -m unittest discover -s tests -p 'test_*.py'

# Node tests (extension/ side): .mjs files, plain `node --test`
node --test tests/*.mjs
```

The Python tests mock the speech engine and ffmpeg — they don't need a venv or
network. The `.mjs` tests are pure JS, no build step. Don't add a dependency to
run the suite.

When writing tests: defend an observable contract (shape, one-clock ordering,
redaction leak detection, engine auto-selection, glossary idempotence), not
plumbing. The existing tests use `unittest.mock` to keep things deterministic
and offline; follow that pattern.

## Conventions

- **Stdlib-first.** `pack.py` and the validator are stdlib-only and never call
  a model or the network. Don't add a runtime dependency to the core. The only
  install side is the optional transcription venv (`analyze/setup.*`).
- **Provider-agnostic.** `BRIEF.md` is provider-neutral; provider runners live
  in `analyze/adapters/` and reuse the shared BRIEF + `pack.build_context`. New
  adapter = ~30 lines, not a fork of the instructions.
- **Engine auto-select.** `pack.py` finds `.venv` and picks `parakeet`
  (Apple Silicon) → `faster-whisper` (everywhere else) → none. Keep the probe
  (`importlib.util.find_spec`) the source of truth; don't hardcode a platform.
- **No secrets in the repo.** `.venv`, capture zips, and per-user config
  (`autopack.config.json`) are git-ignored. Keep it that way.
- **`ffmpeg` is a hard gate.** Transcription silently skips without it, so
  `install.sh`/`install.ps1` exit with the install command rather than warn-and-
  succeed. Preserve that when editing setup.

## Current state / open work

The analysis side is built and tested (Python + Node suite passes). The
extension is a loadable MV3 scaffold: clock, event/timeline capture, CDP→HAR,
frames, zip export are wired; rrweb and the offscreen video path are marked
integration points still being live-verified. Next milestone is a first live
capture that round-trips the whole pipeline — see
[`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md). Treat `README.md`,
this file, and the `docs/` design doc as the authoritative description of intent.