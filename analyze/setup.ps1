# One-time setup for LOCAL narration transcription — Windows (PowerShell).
#
# Creates a .venv at the repo root with faster-whisper so pack.py can turn the
# recorded voice into a timestamped transcript automatically. Audio never leaves
# your machine. (mlx-audio / parakeet is Apple-Silicon-only, so Windows uses the
# cross-platform faster-whisper engine.)
#
#   powershell -ExecutionPolicy Bypass -File analyze\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")  # repo root (one up from analyze\)

Write-Host "-> Setting up the transcription venv (.venv)..."

# ffmpeg is required to extract the audio track from video.webm. It's the one
# dependency pip can't install, and a missing ffmpeg makes every transcription
# silently skip — so HARD-GATE on it here rather than warn and "succeed" anyway.
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "x ffmpeg not found on PATH - transcription won't work without it." -ForegroundColor Red
  Write-Host "  Install it, then re-run this setup:"
  Write-Host "     winget install Gyan.FFmpeg     (or: choco install ffmpeg)"
  exit 1
}

if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv venv .venv
  uv pip install --python .venv\Scripts\python.exe -r analyze\requirements.txt
} else {
  Write-Host "  (uv not found - using python -m venv + pip; 'winget install astral-sh.uv' is faster)"
  python -m venv .venv
  & .venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
  & .venv\Scripts\python.exe -m pip install -r analyze\requirements.txt
}

# Verify the whole chain works on THIS machine before claiming success — and
# pre-warm the model (first engine run downloads weights) so the first real
# capture transcribes fast and offline. selftest exits non-zero if anything's off.
Write-Host "-> Verifying transcription end-to-end (this also downloads the model once)..."
& .venv\Scripts\python.exe analyze\transcribe.py --selftest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Record WHERE this pipeline lives at a fixed home path, so an agent handed a
# capture bundle from any other directory can find pack.py + this .venv and build
# the fused context.md spine itself (see analyze\install_pointer.py).
Write-Host "-> Registering this install so bundles can find it..."
& .venv\Scripts\python.exe analyze\install_pointer.py

Write-Host "Done. pack.py will now auto-transcribe every future capture. Test it directly with:"
Write-Host "    .venv\Scripts\python.exe analyze\transcribe.py C:\path\to\bundle"
