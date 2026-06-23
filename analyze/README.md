# analyze — bundle → portable analysis pack (LLM-agnostic)

The capture step produces a **Capture Bundle** (plain files). This step turns a
bundle into an **analysis pack** you can hand to *any* agent, harness, or LLM.
There is no provider lock-in: the core (`pack.py`) is stdlib-only and never calls
a model. The model is whatever *you* point at the pack. (One optional, best-effort
exception: if the bundle's `transcript.vtt` is still the stub, `pack.py` will run the
**local** transcriber to fill it in — see §1b. It's skipped automatically if `ffmpeg`
or a speech engine isn't installed, and `--no-transcribe` turns it off.)

```
bundle/ ──► pack.py ──► analysis-pack/        ──►  [ any agent / harness / LLM ]
 (stdlib only)          ├── BRIEF.md     (the task, provider-neutral)
                        ├── context.md   (fused recording + to-dos/friction up top)
                        ├── todos.json   (intent extracted from narration, with evidence)
                        ├── friction.json(computed UX signals: pauses, rage clicks, errors)
                        ├── health.json  (integrity: frame index vs disk, gaps, flags)
                        ├── frames/      (screenshots)
                        └── bundle/      (raw structured files)
```

The three JSON artifacts do the forensic join **once** so an agent starts from a
labelled draft, not raw streams: `todos.json` classifies each narration utterance
(bug / to-do / question / praise / research / decision) and attaches the element /
frame / endpoint around it; `friction.json` pre-computes long pauses, rage/repeat
clicks, retried actions and error-shaped events; `health.json` rebuilds the frame
index from disk (the manifest can under-index it after a worker restart) and reports
what to trust. All stdlib-only — `todos.json` is a heuristic draft, refine with an LLM
if you want.

### Auto-pack: a pack for every new capture, no manual step

`autopack.py` watches a folder (where the extension downloads captures) and builds a
pack for every new capture zip — so the handoff is always the pack, never the raw zip.

```bash
python autopack.py                 # configured/default location(s)
python autopack.py ~/Downloads      # pack new capture zips in a folder
python autopack.py --watch          # poll forever (or run from cron/launchd)
```

Idempotent (skips zips already packed) and best-effort per zip. Per-user locations go
in `analyze/autopack.config.json` (git-ignored): `{"watch_dirs": ["~/Downloads"],
"packs_dir": "~/captures/packs"}`. Installing this as a background service on a new
machine is the "install on new computers" task — see `to-do-current.md`.

## 1. Build the pack (no API key, no network)

```bash
# optional but recommended: sanity-check a freshly exported bundle first
python validate_bundle.py ../sample-bundle      # shape, one-clock order, redaction leaks

python pack.py ../sample-bundle --out ./analysis-pack
```

`validate_bundle.py` accepts a `capture-*.zip` or a bundle directory and exits
non-zero if anything is malformed or a secret leaked — run it right after the
extension exports.

By default `pack.py` **collapses** low-signal network noise (analytics, ad
networks, tracking pixels) in `context.md` so the timeline stays readable — it
keeps the count and hostnames rather than deleting, and the raw `network.har` in
`bundle/` is untouched. The host list lives in **`analyze/netfilter.json`** (edit
freely). Pass `--no-net-filter` to render every request verbatim. On a real ESPN
recording this cut `context.md` from ~22 KB to ~6 KB.

## 1b. Transcribe the narration locally (optional)

If the bundle has narration (`manifest.narration_in_video: true`), turn the voice
into a timestamped `transcript.vtt` with a **local** model — audio never leaves the
machine. `pack.py` then interleaves the narration with the clicks on the one clock.

**One-time setup, then automatic forever.** Run this once on your machine and every
future capture you pack gets transcribed with no extra step (`ffmpeg` must be on PATH
first — setup hard-stops with the install command if it's missing):

```bash
bash analyze/setup.sh                                   # macOS / Linux
# Windows (PowerShell):
powershell -ExecutionPolicy Bypass -File analyze\setup.ps1
```

Setup verifies the whole chain works end-to-end before it reports success (and
downloads the model once so your first capture is fast and offline). To re-check it
anytime: `.venv/bin/python analyze/transcribe.py --selftest`.

That's it — `pack.py` then **auto-transcribes** narration (it finds `.venv` and
picks the engine: `parakeet` on Apple Silicon, `faster-whisper` elsewhere). Note a
freshly downloaded bundle ships `transcript.vtt` as a stub; it's filled when you run
`pack.py` (or `transcribe.py`), not by opening the file. To run the transcriber by
hand, or pick a non-default engine:

```bash
# transcribe a bundle in place (writes transcript.vtt into it)
.venv/bin/python analyze/transcribe.py /path/to/bundle          # default: parakeet
```

Under the hood the setup installs `faster-whisper` everywhere (cross-platform) and
adds `mlx-audio` on Apple Silicon for the faster `parakeet` engine.

Engines:
- **`parakeet`** (default) — Parakeet-TDT via `mlx-audio` (Apple Silicon). Fastest
  here with fine native per-sentence timestamps.
- **`qwen3-asr`** — a bit more robust on hard audio; reuses Qwen3-ASR weights
  already on disk (e.g. TypeWhisper's Qwen3 plugin cache) with no download. Runs
  via `mlx-audio`. Timestamps are per-chunk; `--chunk 8` (default) trades a little
  coarseness for clean cue boundaries.
- **`whisper`** — `faster-whisper` (CTranslate2), finer segment timestamps, lower
  accuracy at `base`. Bigger models are more accurate and slower:
  `--engine whisper --model large-v3`.

```bash
.venv/bin/python analyze/transcribe.py /path/to/bundle --model 0.6b        # smaller/faster Qwen
.venv/bin/python analyze/transcribe.py /path/to/bundle --engine whisper --model large-v3
```

You don't have to run this by hand: `pack.py` auto-runs it (best-effort) when it sees
a stub `transcript.vtt` and the bundle has narration audio. Run `transcribe.py`
yourself first if you want a non-default engine/model (or use `--no-transcribe` on
`pack.py` to skip the auto step).

## 1c. Glossary post-pass (domain terms ASR can't get)

No general speech model is trained on Distru, METRC, Eaze, Stiiizy, BioTrack, or
myrcene, so they come back misheard ("this true" → Distru, "stizzy" → Stiiizy,
"micrine" → myrcene). `transcribe.py` runs a deterministic find/replace over the
new `transcript.vtt` using the editable dictionary in **`analyze/glossary.json`**.

- Matches are **case-insensitive and word-boundary safe**, so "increase" is never
  touched by the "ease" rule and only cue text is rewritten (timestamps/NOTE lines
  are left alone). Re-running is a no-op (idempotent).
- Variants that are also ordinary English (`ease`, `metric`, `dispute`) carry a
  `context` list — they're only replaced when a domain word appears in the same
  cue, so normal prose isn't corrupted. **Edit `glossary.json`** to add terms or
  tune guards.

It runs automatically inside `transcribe.py`. Flags: `--no-glossary` to skip,
`--glossary <path>` for a custom dictionary. To fix a transcript you dropped in by
hand (no re-transcription), run it standalone — pure stdlib, no venv needed:

```bash
python3 analyze/glossary.py /path/to/bundle              # or .../transcript.vtt
```

## 2. Hand it to any agent

- **Claude Code / any coding agent:** point it at `analysis-pack/` and say
  "follow BRIEF.md". It writes `SOP.md`, `skills/<name>/SKILL.md`,
  `automation.suggestions.md`, and `notes.md` back into the pack.
- **Any chat LLM:** paste `BRIEF.md` then `context.md`; attach `frames/` if it
  has vision.
- **Your own harness:** read `BRIEF.md` as the system/instruction and feed
  `context.md` (+ frames) as input. The contract is just files.

## Optional reference runners — `adapters/`

Convenience one-command runners for specific providers. They reuse the shared
`BRIEF.md` and `pack.py`, so the instructions never fork.

- `adapters/run_claude.py` — runs it against Claude (Anthropic SDK).

```bash
pip install -r adapters/requirements.txt
export ANTHROPIC_API_KEY=...
python adapters/run_claude.py ../sample-bundle --out ./out
```

Adding an adapter for another provider is ~30 lines: read `BRIEF.md`, send
`pack.build_context(bundle)` + frames, write the four files. The bundle and pack
don't change.

## Why agnostic matters here

The whole value is that the *recording* is portable and the *analysis* is yours
to route. Swap models, run it in three harnesses, compare outputs — the bundle
and pack are the stable contract underneath.
