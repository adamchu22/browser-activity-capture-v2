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

# ffmpeg is required to extract the audio track from video.webm.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "⚠  ffmpeg not found on PATH. Install it, then re-run:"
  echo "     macOS:  brew install ffmpeg"
  echo "     Linux:  sudo apt-get install ffmpeg   (or your distro's package manager)"
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

echo "✓ Done. pack.py will now auto-transcribe narration. Test it directly with:"
echo "    .venv/bin/python analyze/transcribe.py /path/to/bundle"
