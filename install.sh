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

# The speech deps need Python 3.10+ (mlx-audio, mlx, av). macOS ships 3.9.6 as
# `python3`, so building the venv on "whatever python3 is" produces a venv that
# CAN'T install them — pip fails with a Requires-Python error deep in the
# dependency chain, and the tool looks broken. Pick the interpreter explicitly.
MIN_PY="3.10"

# A .venv left over from a too-old interpreter has the same effect, so rebuild it
# rather than reusing it.
if [ -x .venv/bin/python ] && ! .venv/bin/python -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  echo "  .venv was built with Python $(.venv/bin/python -c 'import platform; print(platform.python_version())') (older than $MIN_PY) — rebuilding it."
  rm -rf .venv
fi

pick_python() {
  for c in python3.14 python3.13 python3.12 python3.11 python3.10 python3 python; do
    p="$(command -v "$c")" || continue
    if "$p" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      echo "$p"; return 0
    fi
  done
  return 1
}

if command -v uv >/dev/null 2>&1; then
  # uv downloads a qualifying CPython if the machine has none, so this path needs
  # no system Python at all.
  uv venv --allow-existing --python ">=$MIN_PY" .venv
  uv pip install --python .venv/bin/python -r analyze/requirements.txt
else
  echo "  (uv not found — using python -m venv + pip; 'brew install uv' is faster)"
  if ! PY="$(pick_python)"; then
    echo "✗ No Python $MIN_PY+ on PATH — the local speech engine requires it." >&2
    echo "  (macOS's built-in python3 is 3.9 and can't install it.)" >&2
    echo "  Install one, then re-run this installer:" >&2
    echo "     macOS:  brew install uv          (or: brew install python@3.12)" >&2
    echo "     Linux:  sudo apt-get install python3-venv   (3.10+; or your package manager)" >&2
    exit 1
  fi
  echo "  using $PY ($("$PY" -c 'import platform; print(platform.python_version())'))"
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r analyze/requirements.txt
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
