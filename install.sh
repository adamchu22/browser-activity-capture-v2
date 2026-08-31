#!/usr/bin/env bash
# Installer for Browser Activity Capture — macOS / Linux.
#
#   bash install.sh
#
# Sets up the half of the tool that lives on your machine:
#   1. vendors rrweb into the extension (raw-DOM capture)
#   2. creates a repo-root .venv with a LOCAL speech engine — Parakeet on Apple
#      Silicon (via mlx-audio), faster-whisper everywhere else
#   3. downloads the speech model once and pre-warms it, so your first real
#      capture transcribes fast and offline
#   4. records where all of that lives (~/.config/browser-activity-capture/install.json)
#      so bundles exported later can find the pipeline and the model from any directory
#
# Audio never leaves your machine. The Chrome extension is loaded by hand
# afterwards (this prints the exact path) — Chrome has no CLI install for
# unpacked extensions.
set -euo pipefail
cd "$(dirname "$0")"  # repo root

RRWEB_URL="https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs"

echo "→ Installing Browser Activity Capture…"

# ffmpeg is required to extract the audio track from video.webm. It's the one
# dependency pip can't install, and a missing ffmpeg makes every transcription
# silently skip — so HARD-GATE on it here rather than warn and "succeed" anyway.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg not found on PATH — transcription won't work without it." >&2
  echo "  Install it, then re-run this installer:" >&2
  echo "     macOS:  brew install ffmpeg" >&2
  echo "     Linux:  sudo apt-get install ffmpeg   (or your distro's package manager)" >&2
  exit 1
fi

# ---- 1. rrweb ------------------------------------------------------------
# Optional at runtime (without it you still get the high-level timeline, just no
# events.jsonl DOM stream), so a download failure is a warning, not a failure.
if [ -f extension/src/lib/rrweb.min.js ]; then
  echo "→ rrweb already vendored — skipping."
else
  echo "→ Vendoring rrweb for raw-DOM capture…"
  if ! curl -fsSL "$RRWEB_URL" -o extension/src/lib/rrweb.min.js; then
    rm -f extension/src/lib/rrweb.min.js
    echo "  ! couldn't download rrweb — continuing without it (you'll get the timeline" >&2
    echo "    but no events.jsonl). Re-run this installer to retry." >&2
  fi
fi

# ---- 2. speech engine ----------------------------------------------------
echo "→ Setting up the transcription venv (.venv)…"

is_apple_silicon() { [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; }

if command -v uv >/dev/null 2>&1; then
  uv venv --allow-existing .venv
  uv pip install --python .venv/bin/python -r analyze/requirements.txt
  if is_apple_silicon; then
    echo "→ Apple Silicon detected: adding mlx-audio (the faster 'parakeet' engine)…"
    uv pip install --python .venv/bin/python mlx-audio
  fi
else
  echo "  (uv not found — using python3 -m venv + pip; 'brew install uv' is faster)"
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r analyze/requirements.txt
  if is_apple_silicon; then
    echo "→ Apple Silicon detected: adding mlx-audio (the faster 'parakeet' engine)…"
    .venv/bin/python -m pip install mlx-audio
  fi
fi

# ---- 3. download + pre-warm the model ------------------------------------
# Verify the whole chain works on THIS machine before claiming success — and
# pre-warm the model (first engine run downloads weights) so the first real
# capture transcribes fast and offline. selftest exits non-zero if anything's off.
echo "→ Downloading the speech model and verifying transcription end-to-end…"
.venv/bin/python analyze/transcribe.py --selftest

# ---- 4. record where it all lives ----------------------------------------
# A capture bundle is usually handed to an agent working in some OTHER directory,
# so it can't find pack.py, the .venv, or the downloaded model by itself. Record
# them at a fixed home path the exported bundle docs point at, and every future
# session picks the pipeline up automatically (see analyze/install_pointer.py).
echo "→ Registering this install so future captures can find it…"
.venv/bin/python analyze/install_pointer.py

# ---- done ----------------------------------------------------------------
cat <<EOF

✓ Installed. One manual step left — load the Chrome extension:

    1. open  chrome://extensions
    2. toggle Developer mode (top right)
    3. Load unpacked → select:
         $(pwd)/extension
    4. pin it (puzzle-piece icon → pin)

Then hit Start, do a short task narrating aloud, and Stop & export.
Captures auto-transcribe from here on. Test the transcriber directly with:
    .venv/bin/python analyze/transcribe.py /path/to/bundle
EOF
