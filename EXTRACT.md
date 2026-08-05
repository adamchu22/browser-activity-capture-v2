# EXTRACT — move this tool into another repo

This project is self-contained: nothing here imports from outside its own
folder, so it can be lifted wholesale into another repo (or a fresh repo of its
own). Use this guide to do it, or hand the file to a coding agent as
instructions.

## What you're moving

A browser-activity capture tool in two halves:

1. **`extension/`** — an MV3 Chrome extension that records one browser task
   (clicks, keystrokes, navigation, network, screenshots, video, narration),
   aligns everything on one clock, and exports a portable **Capture Bundle** (a
   zip of plain files).
2. **`analyze/`** — a stdlib-only Python step that validates a bundle and
   flattens it into an **analysis pack** any agent/LLM can read to produce an
   SOP, an agent skill, and automation suggestions. It is **LLM-agnostic** — the
   recording is the product; the analysis model is whatever you choose.

Supporting: `docs/` (landscape + design), `sample-bundle/` (a hand-made example),
`tools/` (frame helper).

## Move it (agent or by hand)

Clone *this* repository to a temp dir, copy the whole project into the
destination repo at its root, then commit.

```bash
# 1. clone this repo (shallow is fine) into a temp dir
git clone --depth 1 https://github.com/adamchu22/browser-activity-capture-v2.git \
  /tmp/bac-src
#   (or: gh repo clone adamchu22/browser-activity-capture-v2 /tmp/bac-src -- --depth 1)

# 2. copy the project to the ROOT of the destination repo, WITHOUT git history
cp -R /tmp/bac-src <DEST_REPO>/.   # trailing "." copies contents, not a wrapper folder
#   If you want it nested under a subfolder instead, target that subfolder.

# 3. clean up
rm -rf /tmp/bac-src

# 4. verify the Python pieces run (should print PASS)
cd <DEST_REPO>
python analyze/validate_bundle.py sample-bundle

# 5. commit into the destination repo on a new branch (don't push/PR unless asked)
git checkout -b add-browser-activity-capture
git add .
git commit -m "Add browser-activity-capture tool"
```

Nothing here imports from outside this folder, so no other paths need fixing.

## How the tool works (the mental model)

- The extension service worker owns a single clock `t0`. Every modality (rrweb
  DOM stream, clicks/inputs/keys/nav, network via the CDP Network domain → HAR,
  screenshots via captureVisibleTab, video via an offscreen MediaRecorder) is
  stamped as **ms-since-`t0`** at capture time, so all of it is aligned by
  construction — no post-hoc syncing. That's why we self-record the tab instead
  of bolting onto an external recorder.
- **Redaction is non-negotiable and happens before disk:** password/secret
  inputs are masked in-page; Authorization/Cookie/Set-Cookie headers and
  secret-looking body fields are stripped from the HAR. There's a per-host
  blocklist and a pause button. Never reconstruct redacted values.
- On stop, it assembles the bundle (`manifest.json`, `timeline.json`,
  `events.jsonl`, `network.har`, `transcript.vtt`, `frames/`, optional
  `video.webm`) and downloads a zip.
- `analyze/validate_bundle.py` checks a bundle (zip or dir) for shape, one-clock
  ordering, resolvable frame references, and **redaction leaks** — run it right
  after export.
- `analyze/pack.py` (stdlib, no API key, no network) flattens a bundle into an
  `analysis-pack/`: `BRIEF.md` (provider-neutral task), `context.md` (the whole
  recording as one readable doc), `frames/`, and the raw `bundle/`. Hand that
  folder to any agent and say "follow BRIEF.md" — it writes `SOP.md`,
  `skills/<name>/SKILL.md`, `automation.suggestions.md`, `notes.md`.
- `analyze/adapters/run_claude.py` is **one optional** reference runner; the tool
  is not Claude-locked.

## How the user's workflow goes

1. Vendor rrweb once:
   ```bash
   curl -L https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs \
     -o extension/src/lib/rrweb.min.js
   ```
2. Load the extension unpacked: `chrome://extensions` → Developer mode → Load
   unpacked → pick `extension/`.
3. Open a normal website tab → click the extension → **Start recording**. Do a
   task (narrate aloud for a transcript). **Stop & export** → save the zip.
4. `python analyze/validate_bundle.py ~/Downloads/capture-*.zip` → expect **PASS**.
5. Unzip, then `python analyze/pack.py <bundle-dir> --out ./analysis-pack`.
6. Hand `analysis-pack/` to any agent → it produces the SOP/skill/automation
   assets for you to review.

See [`README.md`](README.md) § Quick start for the one-time transcription setup
(Parakeet on Apple Silicon, faster-whisper elsewhere).

## Current state

Extension is a **loadable scaffold** (clock, event/timeline capture, CDP→HAR,
frames, zip export wired; rrweb and the video path are marked integration
points). The analysis step and validator are **done and tested** against
`sample-bundle/`. Next milestone: a first live capture that round-trips through
the pipeline — see `extension/FIRST-CAPTURE.md`.