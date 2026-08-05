# Browser Activity Capture — v2

> **v2** records your **whole screen across all tabs** (v1 recorded one pinned tab).
> It's forked from the working v1 tool, which stays intact in its own repo. The v2
> capture rework is **built and unit-tested but not yet verified in live Chrome** —
> run [`LIVE-TEST.md`](LIVE-TEST.md) before trusting it.

Capture what you do in Chrome — narration/transcript, screen, timestamped
clicks/keystrokes/navigation, and network requests — aligned on one timeline and
exported as a single portable **Capture Bundle**. Then hand it to *any* agent,
harness, or LLM to produce **skills, SOPs, and automation suggestions**.

The bundle is the product, and it's **LLM-agnostic** — generated docs/skills are
derived from it deliberately, by whatever model you choose, not automatically and
not locked to one provider.

## Why this exists

The capture, video, transcription, and even auto-doc problems are already solved
products (rrweb, Loom, Whisper, Scribe/Tango). The missing piece is the layer
that **aligns all of them on one clock and packages them into a portable,
agent-ready bundle** aimed at producing skills/automation — not just a human help
article locked in a vendor's cloud.

## Status

The full pipeline (record → narrate → transcribe → analysis pack) works end-to-end
in v1. **v2** reworks capture to **full-screen video + all-tabs instrumentation**:
the code is built, the analyze side has 37 passing tests, and a synthetic v2 bundle
round-trips — but the extension itself is **not yet live-verified** (no browser
runtime in the dev environment). See [`LIVE-TEST.md`](LIVE-TEST.md) and `handoff.md`.

Decisions taken: full-screen self-record (follows you across tabs), full HAR with
bodies, in-browser + downloadable zip, analysis-first, **LLM-agnostic** (no provider
lock-in).

## Quick start

Two halves, two steps. Do them in order.

### 1. Load the Chrome extension

> Full checklist (mic enable, screen-share picker, troubleshooting):
> [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md).

1. (Optional, 30s) Vendor rrweb for raw-DOM capture. Without it you still get the
   high-level timeline, just no `events.jsonl` stream:
   ```bash
   cd extension
   curl -L https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs \
        -o src/lib/rrweb.min.js
   ```
2. Open `chrome://extensions` → toggle **Developer mode** (top right) →
   **Load unpacked** → select this repo's `extension/` folder.
3. Pin it (puzzle-piece icon → pin). Open a normal website tab, click the
   extension, **Start**, do a short task narrating aloud, **Stop & export** →
   save `capture-<timestamp>.zip`.

### 2. Set up local transcription (Parakeet / Whisper)

The capture zip ships `transcript.vtt` as a stub. `analyze/pack.py` fills it by
**auto-transcribing the narration locally** — audio never leaves your machine.
One-time setup:

```bash
# macOS or Linux:
bash analyze/setup.sh

# Windows (PowerShell):
powershell -ExecutionPolicy Bypass -File analyze\setup.ps1
```

What the setup does, and what it needs:

- **`ffmpeg` on PATH** (hard requirement — the script exits with the install
  command if it's missing):
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt-get install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg` (or `choco install ffmpeg`)
- Creates a repo-root `.venv` and installs **`faster-whisper`** (cross-platform
  baseline). On **Apple Silicon** it also installs **`mlx-audio`** for the faster
  **Parakeet** engine (`mlx-community/parakeet-tdt-0.6b-v3`).
- Runs `transcribe.py --selftest`, which **downloads the model once** and
  pre-warms it so your first real capture transcribes fast and offline.
- Registers the install so capture bundles can find `pack.py` + this `.venv`
  from any directory (see `analyze/install_pointer.py`).

`pack.py` auto-selects the engine: **Parakeet** on Apple Silicon,
**faster-whisper** everywhere else. See [`analyze/README.md`](analyze/README.md)
for picking a non-default engine (`qwen3-asr`) and running the transcriber by hand.

### 3. Validate → pack → hand off

```bash
# validate the export
python analyze/validate_bundle.py ~/Downloads/capture-<timestamp>.zip    # expect PASS

# flatten into an agent-ready analysis pack (auto-transcribes)
mkdir -p /tmp/cap && cd /tmp/cap && unzip ~/Downloads/capture-<timestamp>.zip
python analyze/pack.py /tmp/cap --out /tmp/analysis-pack

# then hand /tmp/analysis-pack/ to any agent — open context.md and say "follow BRIEF.md"
```

> **Note:** `pack.py` runs on the system `python` (stdlib, no venv needed for the
> pack itself) but will only auto-transcribe if the `.venv` from step 2 exists.
> No `.venv`? The pack still builds; `transcript.vtt` just stays a stub.

## Layout

- [`docs/01-landscape.md`](docs/01-landscape.md) — what's already solved, build vs. reuse.
- [`docs/02-design.md`](docs/02-design.md) — architecture, the "one clock" sync principle,
  the Capture Bundle format, MVP scope, and decisions.
- [`sample-bundle/`](sample-bundle/) — a realistic example of what the extension will emit
  (a refund workflow), used to develop the analysis step against.
- [`analyze/`](analyze/) — `pack.py` turns a bundle into a portable, provider-neutral
  analysis pack any agent can consume. `validate_bundle.py` checks a bundle before
  analysis. Optional reference runners live in `analyze/adapters/` (e.g. Claude).
- [`extension/`](extension/) — the MV3 Chrome extension that produces real bundles
  (loadable scaffold). See [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md).
- [`AGENTS.md`](AGENTS.md) — orientation for coding agents working in this repo.
- [`EXTRACT.md`](EXTRACT.md) — how to move this self-contained project into another repo.

## Pipeline

```
[Chrome extension] ─► Capture Bundle ─► pack.py ─► analysis-pack/ ─► [ any agent / LLM ] ─► SOP.md
  (next to build)     (sample-bundle/)  (stdlib)   BRIEF + context              ▲           skills/<name>/SKILL.md
                                                    + frames + raw    Claude Code / chat LLM / automation.suggestions.md
                                                                      your own harness        notes.md
```

The bundle and the pack are the stable contract. Swap models, run it in several
harnesses, compare outputs — the recording underneath doesn't change.

## License

Copyright (C) 2026 Rugby Waldorf LLC. Licensed under the
[GNU General Public License v3.0](LICENSE) or, at your option, any later
version — a strong copyleft license. See [`LICENSE`](LICENSE) for the full terms.
