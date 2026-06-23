#!/usr/bin/env bash
# One-time setup for LOCAL narration transcription — macOS / Linux.
#
# Creates a .venv at the repo root with a speech engine so pack.py can turn the
# recorded voice into a timestamped transcript automatically. Audio never leaves
# your machine. On Apple Silicon it also installs mlx-audio (the faster `parakeet`
# engine); everywhere else it uses faster-whisper.
#
#   bash analyze/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."  # repo root (one up from analyze/)

echo "→ Setting up the transcription venv (.venv)…"

# ffmpeg is required to extract the audio track from video.webm. It's the one
# dependency pip can't install, and a missing ffmpeg makes every transcription
# silently skip — so HARD-GATE on it here rather than warn and "succeed" anyway.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg not found on PATH — transcription won't work without it." >&2
  echo "  Install it, then re-run this setup:" >&2
  echo "     macOS:  brew install ffmpeg" >&2
  echo "     Linux:  sudo apt-get install ffmpeg   (or your distro's package manager)" >&2
  exit 1
fi

is_apple_silicon() { [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; }

if command -v uv >/dev/null 2>&1; then
  uv venv .venv
  uv pip install --python .venv/bin/python -r analyze/requirements.txt
  if is_apple_silicon; then
    echo "→ Apple Silicon detected: adding mlx-audio (faster 'parakeet' engine)…"
    uv pip install --python .venv/bin/python mlx-audio
  fi
else
  echo "  (uv not found — using python3 -m venv + pip; 'brew install uv' is faster)"
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r analyze/requirements.txt
  if is_apple_silicon; then
    echo "→ Apple Silicon detected: adding mlx-audio (faster 'parakeet' engine)…"
    .venv/bin/python -m pip install mlx-audio
  fi
fi

# Verify the whole chain works on THIS machine before claiming success — and
# pre-warm the model (first engine run downloads weights) so the first real
# capture transcribes fast and offline. selftest exits non-zero if anything's off.
echo "→ Verifying transcription end-to-end (this also downloads the model once)…"
.venv/bin/python analyze/transcribe.py --selftest

# Record WHERE this pipeline lives at a fixed home path, so an agent handed a
# capture bundle from any other directory can find pack.py + this .venv and build
# the fused context.md spine itself (see analyze/install_pointer.py).
echo "→ Registering this install so bundles can find it…"
.venv/bin/python analyze/install_pointer.py

echo "✓ Done. pack.py will now auto-transcribe every future capture. Test it directly with:"
echo "    .venv/bin/python analyze/transcribe.py /path/to/bundle"
