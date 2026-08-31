# Installer for Browser Activity Capture — Windows (PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Sets up the half of the tool that lives on your machine:
#   1. vendors rrweb into the extension (raw-DOM capture)
#   2. creates a repo-root .venv with faster-whisper, the cross-platform local
#      speech engine (mlx-audio / parakeet is Apple-Silicon-only)
#   3. downloads the speech model once and pre-warms it, so your first real
#      capture transcribes fast and offline
#   4. records where all of that lives (~\.config\browser-activity-capture\install.json)
#      so bundles exported later can find the pipeline and the model from any directory
#
# Audio never leaves your machine. The Chrome extension is loaded by hand
# afterwards (this prints the exact path) — Chrome has no CLI install for
# unpacked extensions.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot  # repo root

$RrwebUrl = "https://cdn.jsdelivr.net/npm/rrweb@2.0.0/dist/rrweb.umd.min.cjs"

Write-Host "-> Installing Browser Activity Capture..."

# ffmpeg is required to extract the audio track from video.webm. It's the one
# dependency pip can't install, and a missing ffmpeg makes every transcription
# silently skip — so HARD-GATE on it here rather than warn and "succeed" anyway.
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "x ffmpeg not found on PATH - transcription won't work without it." -ForegroundColor Red
  Write-Host "  Install it, then re-run this installer:"
  Write-Host "     winget install Gyan.FFmpeg     (or: choco install ffmpeg)"
  exit 1
}

# ---- 1. rrweb ------------------------------------------------------------
# Optional at runtime (without it you still get the high-level timeline, just no
# events.jsonl DOM stream), so a download failure is a warning, not a failure.
$RrwebPath = "extension\src\lib\rrweb.min.js"
if (Test-Path $RrwebPath) {
  Write-Host "-> rrweb already vendored - skipping."
} else {
  Write-Host "-> Vendoring rrweb for raw-DOM capture..."
  try {
    Invoke-WebRequest -Uri $RrwebUrl -OutFile $RrwebPath -UseBasicParsing
  } catch {
    Remove-Item $RrwebPath -ErrorAction SilentlyContinue
    Write-Host "  ! couldn't download rrweb - continuing without it (you'll get the timeline" -ForegroundColor Yellow
    Write-Host "    but no events.jsonl). Re-run this installer to retry." -ForegroundColor Yellow
  }
}

# ---- 2. speech engine ----------------------------------------------------
Write-Host "-> Setting up the transcription venv (.venv)..."

if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv venv --allow-existing .venv
  uv pip install --python .venv\Scripts\python.exe -r analyze\requirements.txt
} else {
  Write-Host "  (uv not found - using python -m venv + pip; 'winget install astral-sh.uv' is faster)"
  python -m venv .venv
  & .venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
  & .venv\Scripts\python.exe -m pip install -r analyze\requirements.txt
}

# ---- 3. download + pre-warm the model ------------------------------------
# Verify the whole chain works on THIS machine before claiming success — and
# pre-warm the model (first engine run downloads weights) so the first real
# capture transcribes fast and offline. selftest exits non-zero if anything's off.
Write-Host "-> Downloading the speech model and verifying transcription end-to-end..."
& .venv\Scripts\python.exe analyze\transcribe.py --selftest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ---- 4. record where it all lives ----------------------------------------
# A capture bundle is usually handed to an agent working in some OTHER directory,
# so it can't find pack.py, the .venv, or the downloaded model by itself. Record
# them at a fixed home path the exported bundle docs point at, and every future
# session picks the pipeline up automatically (see analyze\install_pointer.py).
Write-Host "-> Registering this install so future captures can find it..."
& .venv\Scripts\python.exe analyze\install_pointer.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ---- done ----------------------------------------------------------------
Write-Host ""
Write-Host "Installed. One manual step left - load the Chrome extension:" -ForegroundColor Green
Write-Host ""
Write-Host "    1. open  chrome://extensions"
Write-Host "    2. toggle Developer mode (top right)"
Write-Host "    3. Load unpacked -> select:"
Write-Host "         $(Join-Path $PSScriptRoot 'extension')"
Write-Host "    4. pin it (puzzle-piece icon -> pin)"
Write-Host ""
Write-Host "Then hit Start, do a short task narrating aloud, and Stop & export."
Write-Host "Captures auto-transcribe from here on. Test the transcriber directly with:"
Write-Host "    .venv\Scripts\python.exe analyze\transcribe.py C:\path\to\bundle"
