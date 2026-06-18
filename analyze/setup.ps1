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

# ffmpeg is required to extract the audio track from video.webm.
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Warning "ffmpeg not found on PATH. Install it, then re-run:"
  Write-Host "     winget install Gyan.FFmpeg     (or: choco install ffmpeg)"
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

Write-Host "Done. pack.py will now auto-transcribe narration. Test it directly with:"
Write-Host "    .venv\Scripts\python.exe analyze\transcribe.py C:\path\to\bundle"
