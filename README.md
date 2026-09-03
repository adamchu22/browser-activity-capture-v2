# Browser Activity Capture — v2

> **v2** records your **whole screen across all tabs** (v1 recorded one pinned tab).
> It's forked from the working v1 tool, which stays intact in its own repo. The v2
> capture rework is **built and unit-tested but not yet verified in live Chrome** —
> run [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md) before trusting it.

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
runtime in the dev environment). See [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md)
for the load-and-verify checklist.

Decisions taken: full-screen self-record (follows you across tabs), full HAR with
bodies, in-browser + downloadable zip, analysis-first, **LLM-agnostic** (no provider
lock-in).

## Install

Clone the repo, then run the installer:

```bash
# macOS or Linux:
bash install.sh

# Windows (PowerShell):
powershell -ExecutionPolicy Bypass -File install.ps1
```

**Prerequisites:** `ffmpeg` on PATH, and **Python 3.10 or newer** (the speech
engines require it — macOS's built-in `python3` is 3.9 and won't work). The
installer hard-gates on both and prints the install command if either is missing:

- macOS: `brew install ffmpeg` · `brew install uv` (or `brew install python@3.12`)
- Linux: `sudo apt-get install ffmpeg python3-venv`
- Windows: `winget install Gyan.FFmpeg` (or `choco install ffmpeg`) · `winget install astral-sh.uv`

If [`uv`](https://docs.astral.sh/uv/) is on PATH the installer uses it and needs
no system Python at all — it downloads a suitable CPython itself. Otherwise the
installer searches PATH for a 3.10+ interpreter (`python3.13`, `python3.12`, …)
rather than trusting whatever `python3` happens to be, and rebuilds `.venv` if a
previous run left one built on an older interpreter.

What it does:

1. **Vendors rrweb** into the extension for raw-DOM capture (`events.jsonl`).
2. **Creates a repo-root `.venv`** with a local speech engine — **Parakeet**
   (`mlx-community/parakeet-tdt-0.6b-v3` via `mlx-audio`) on Apple Silicon, and
   **`faster-whisper`** as the cross-platform baseline everywhere else.
3. **Downloads the speech model once and pre-warms it**, so your first real capture
   transcribes fast and offline. Audio never leaves your machine.
4. **Records where all of it lives** — the pipeline, the venv python, and the
   downloaded model weights — at
   `~/.config/browser-activity-capture/install.json`. Every bundle exported later
   points agents at that file, so future sessions re-use this install and this
   already-downloaded model instead of setting anything up again (see
   `analyze/install_pointer.py`).

It's safe to re-run: an existing rrweb copy and a cached model are left alone.

### Load the Chrome extension

Chrome has no CLI install for unpacked extensions, so this one step is manual —
the installer prints the exact path to select.

1. Open `chrome://extensions` → toggle **Developer mode** (top right).
2. **Load unpacked** → select this repo's `extension/` folder.
3. Pin it (puzzle-piece icon → pin).

### ⚠️ Set your "Never record on" list first

**Before your first Start, open the popup and fill in "Never record on" with every
host you don't want captured** — password manager, email, bank, admin consoles,
anything personal. v2 records your **whole screen across all tabs**, so anything
you visit during a capture is in the video unless you've listed it.

- One host per line (e.g. `my.1password.com`). A parent domain covers its
  subdomains (`example.com` blocks `mail.example.com`), and pasting a full URL is
  fine — it's reduced to the hostname.
- While a listed host is the active tab, capture **auto-pauses** — video, events,
  and network all stop, and the toolbar icon says why. It resumes when you leave.
- The list is read when you press **Start**, so edit it before recording, not
  during. It persists between sessions.

Not a substitute for redaction (passwords and auth headers are always stripped),
but it's the only thing that keeps a whole site out of the bundle.

Then open a normal website tab, click the extension, **Start**, do a short task
narrating aloud, **Stop & export** → save `capture-<timestamp>.zip`.

> Full first-capture checklist (mic enable, screen-share picker, troubleshooting):
> [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md).

`pack.py` auto-selects the engine the installer set up: **Parakeet** on Apple
Silicon, **faster-whisper** everywhere else. See
[`analyze/README.md`](analyze/README.md) for picking a non-default engine
(`qwen3-asr`) and running the transcriber by hand.

## Quick start — validate → pack → hand off

```bash
# validate the export
python analyze/validate_bundle.py ~/Downloads/capture-<timestamp>.zip    # expect PASS

# flatten into an agent-ready analysis pack (auto-transcribes)
mkdir -p /tmp/cap && cd /tmp/cap && unzip ~/Downloads/capture-<timestamp>.zip
python analyze/pack.py /tmp/cap --out /tmp/analysis-pack

# then hand /tmp/analysis-pack/ to any agent — open context.md and say "follow BRIEF.md"
```

> **Note:** `pack.py` runs on the system `python` (stdlib, no venv needed for the
> pack itself) but will only auto-transcribe if the installer's `.venv` exists.
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
