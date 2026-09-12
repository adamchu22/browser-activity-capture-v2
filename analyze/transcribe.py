#!/usr/bin/env python3
"""Transcribe a Capture Bundle's narration into transcript.vtt — locally.

The bundle's video.webm carries the user's microphone narration on the t0 clock
(see manifest narration_in_video). This runs a LOCAL speech model over that audio
and writes transcript.vtt with timestamps — so the words land on the same timeline
as the clicks/navigation. No audio ever leaves the machine.

Engines (--engine):
  parakeet   (default) — Parakeet-TDT via mlx-audio, Apple Silicon. Fast (~3x
             quicker than Qwen here) with fine native per-sentence timestamps.
  qwen3-asr  — Qwen3-ASR via mlx-audio. Slower but a bit more robust on hard audio;
             uses less RAM (6-bit). Reuses weights on disk (TypeWhisper's Qwen3
             plugin cache or the HF cache). Timestamps are per-chunk; --chunk tunes.
  whisper    — faster-whisper (CTranslate2). Reuses any cached HF whisper model
             (default size: base). Finer segment timestamps, lower accuracy at base.

Usage (from the project's .venv so the engine is importable):
    .venv/bin/python analyze/transcribe.py <bundle-dir>
    .venv/bin/python analyze/transcribe.py <bundle-dir> --engine whisper --model large-v3

Alignment note: the recorder's audio starts a fraction of a second after t0 (the
offscreen MediaRecorder spins up just after the clock starts), so cue times are
within ~1s of true t0 — fine for matching narration to actions, not frame-exact.
"""

from __future__ import annotations

import argparse
import json
import os
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import glossary as glossary_mod

# Where the Qwen3-ASR weights may already live (reused, never re-downloaded).
QWEN_REPOS = {
    "1.7b": "mlx-community/Qwen3-ASR-1.7B-6bit",
    "0.6b": "mlx-community/Qwen3-ASR-0.6B-8bit",
}
PARAKEET_DEFAULT = "mlx-community/parakeet-tdt-0.6b-v3"
MODEL_CACHES = [
    Path.home() / "Library/Application Support/TypeWhisper/PluginData/com.typewhisper.qwen3/models",
    Path.home() / ".cache/huggingface/hub",
]


# Audio extraction is fast (a stream copy/decode), but a corrupt or truncated
# video can wedge ffmpeg — bound it so the pipeline can't hang forever. run() kills
# the child and raises TimeoutExpired on overrun.
FFMPEG_TIMEOUT_S = 900


def extract_audio(video: Path, wav: Path) -> None:
    # 16 kHz mono is what these models want; -y overwrites the temp file.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(video), "-ar", "16000", "-ac", "1", str(wav)],
        check=True,
        timeout=FFMPEG_TIMEOUT_S,
    )


def extract_audio_multi(video_paths: list[Path], wav: Path) -> None:
    """Concatenate audio from multiple video segments into one wav.

    Multi-segment recordings (the user re-shared after 'Stop sharing') write each
    video segment as a separate webm. The mic audio is continuous across segments
    (the recorder kept capturing mic through the video gap), so concatenating the
    audio back-to-back yields the full narration. ffmpeg's concat demuxer joins
    same-codec streams cleanly. The resulting wav's timeline is segment1-audio →
    segment2-audio → … with no gaps — which matches what the user actually spoke.
    """
    if len(video_paths) == 1:
        extract_audio(video_paths[0], wav)
        return
    listfile = wav.parent / "concat.txt"
    listfile.write_text("\n".join(f"file '{p.resolve()}'" for p in video_paths), encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "concat", "-safe", "0", "-i", str(listfile),
         "-ar", "16000", "-ac", "1", str(wav)],
        check=True,
        timeout=FFMPEG_TIMEOUT_S,
    )


def find_local_model(repo_id: str) -> str:
    """Return a local snapshot path for an HF repo if it's already on disk,
    else the repo id (the engine will fetch it)."""
    folder = "models--" + repo_id.replace("/", "--")
    for cache in MODEL_CACHES:
        snaps = sorted((cache / folder / "snapshots").glob("*")) if (cache / folder / "snapshots").is_dir() else []
        if snaps:
            return str(snaps[-1])
    return repo_id


# ---- engines -------------------------------------------------------------

def vtt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def run_whisper(wav: Path, model_name: str) -> tuple[str, int]:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper not installed in this venv. See analyze/README.md.")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(wav), word_timestamps=True)
    out = ["WEBVTT", "", f"NOTE engine=whisper model={model_name} language={info.language} ({info.language_probability:.2f})", ""]
    n = 0
    for seg in segments:
        text = seg.text.strip()
        if text:
            out += [f"{vtt_time(seg.start)} --> {vtt_time(seg.end)}", text, ""]
            n += 1
    return "\n".join(out) + "\n", n


def run_mlx_audio(wav: Path, model_path: str, note: str, extra: list[str]) -> tuple[str, int]:
    """Drive mlx-audio's STT CLI (used by both parakeet and qwen3-asr)."""
    env = {**os.environ, "HF_HUB_DISABLE_PROGRESS_BARS": "1", "TOKENIZERS_PARALLELISM": "false"}
    with tempfile.TemporaryDirectory() as td:
        out_base = Path(td) / "out"
        subprocess.run(
            [sys.executable, "-m", "mlx_audio.stt.generate",
             "--model", model_path, "--audio", str(wav),
             "--output-path", str(out_base), "--format", "vtt", *extra],
            check=True, env=env,
        )
        # mlx-audio writes "<output-path>.vtt".
        vtt = Path(str(out_base) + ".vtt").read_text(encoding="utf-8")
    if vtt.startswith("WEBVTT"):
        vtt = vtt.replace("WEBVTT", "WEBVTT\n\n" + note, 1)
    return vtt, vtt.count("-->")


def run_qwen(wav: Path, model_key: str, chunk: float) -> tuple[str, int]:
    model_path = find_local_model(QWEN_REPOS.get(model_key, model_key))
    note = f"NOTE engine=qwen3-asr model={Path(model_path).name} chunk={chunk}s"
    return run_mlx_audio(wav, model_path, note, ["--chunk-duration", str(chunk)])


def run_parakeet(wav: Path, model: str) -> tuple[str, int]:
    # Pass the repo id, not a local snapshot path: mlx-audio infers the model type
    # from the name (a snapshot hash isn't recognized), and the HF cache is still
    # reused so there's no re-download once it's been fetched.
    repo = model or PARAKEET_DEFAULT
    note = f"NOTE engine=parakeet model={repo.split('/')[-1]}"
    return run_mlx_audio(wav, repo, note, [])


# ---- self-test -----------------------------------------------------------

def _ffmpeg_ok() -> bool:
    """True if ffmpeg is callable. The one external (non-pip) dependency, so the
    installer and selftest check it explicitly rather than failing deep in a run."""
    from shutil import which
    return which("ffmpeg") is not None


def _available_engine() -> str | None:
    """The fastest speech engine importable in THIS interpreter: parakeet
    (mlx-audio, Apple Silicon) → whisper (faster-whisper, cross-platform) → None."""
    import importlib.util as u
    if u.find_spec("mlx_audio"):
        return "parakeet"
    if u.find_spec("faster_whisper"):
        return "whisper"
    return None


def selftest(engine: str, model: str, chunk: float, *, engine_explicit: bool = False) -> int:
    """End-to-end check the install actually transcribes on THIS machine: synth a
    short silent clip with ffmpeg, run the speech engine over it, report pass/fail.
    Exits non-zero with the exact missing piece so `install.sh` can gate on it. Also
    pre-warms the model (first engine run downloads/loads weights), so the user's
    first real capture transcribes fast and offline."""
    if not _ffmpeg_ok():
        print("✗ ffmpeg not found on PATH — transcription cannot run.\n"
              "    macOS:   brew install ffmpeg\n"
              "    Linux:   sudo apt-get install ffmpeg\n"
              "    Windows: winget install Gyan.FFmpeg   (or: choco install ffmpeg)\n"
              "  Install it, then re-run setup.", file=sys.stderr)
        return 2
    # Unless the caller forced --engine, verify whatever was actually installed
    # (parakeet on Apple Silicon, faster-whisper elsewhere) so the check matches
    # what pack.py will pick at run time.
    if not engine_explicit:
        detected = _available_engine()
        if detected is None:
            print("✗ no speech engine installed in this .venv — re-run install.sh.",
                  file=sys.stderr)
            return 3
        engine = detected
    print(f"→ verifying transcription end-to-end (engine {engine}; first run loads the model)…",
          file=sys.stderr)
    try:
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "selftest.wav"
            # 1s of silence — proves ffmpeg runs and produces the 16kHz mono wav the
            # engines expect. The transcript will be empty; we're checking the chain,
            # not the words.
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                 "-i", "anullsrc=r=16000:cl=mono", "-t", "1", str(wav)],
                check=True,
            )
            if engine == "whisper":
                run_whisper(wav, model or "base")
            elif engine == "qwen3-asr":
                run_qwen(wav, model or "1.7b", chunk)
            else:
                run_parakeet(wav, model)
    except SystemExit as e:  # run_whisper exits if the engine isn't importable
        print(f"✗ transcription self-test failed: {e}", file=sys.stderr)
        return 3
    except Exception as e:  # noqa: BLE001 — any failure means it won't work for them
        print(f"✗ transcription self-test failed ({type(e).__name__}: {e}).\n"
              "  The .venv may be missing a speech engine — re-run install.sh.",
              file=sys.stderr)
        return 3
    print(f"✓ transcription works (ffmpeg + {engine}). Future captures auto-transcribe via pack.py.",
          file=sys.stderr)
    return 0


def offset_cues(vtt: str, offset_ms: float) -> list[tuple[float, float, str]]:
    """Parse VTT cues and move both endpoints from segment PTS to master time."""
    stamp = r"(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})"
    pattern = re.compile(rf"^{stamp}\s+-->\s+{stamp}(?:\s+.*)?$")
    lines, out, i = vtt.splitlines(), [], 0
    while i < len(lines):
        match = pattern.match(lines[i].strip())
        i += 1
        if not match:
            continue
        values = match.groups()
        def seconds(parts):
            h, m, s, ms = parts
            return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
        start, end = seconds(values[:4]), seconds(values[4:])
        body = []
        while i < len(lines) and lines[i].strip():
            body.append(lines[i])
            i += 1
        if body and end > start:
            out.append((start + offset_ms / 1000, end + offset_ms / 1000, "\n".join(body)))
    return out


# ---- driver --------------------------------------------------------------

def transcribe(bundle: Path, engine: str, model: str, chunk: float,
               glossary_path: Path | None, use_glossary: bool = True) -> int:
    engine = engine or "parakeet"  # None (no --engine given) → the default run engine
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    # .name strips any directory so a hostile manifest can't point `video` at a file
    # outside the bundle for ffmpeg to read (path traversal on an untrusted bundle).
    primary_video = bundle / Path(manifest.get("video") or "video.webm").name
    # Multi-segment: gather all video segment files declared in the manifest, in
    # order. Each is a separate webm; the mic audio is continuous across them.
    segment_files = [primary_video]
    for seg in (manifest.get("video_segments") or []):
        if not isinstance(seg, dict):
            continue
        seg_file = seg.get("file")
        if not seg_file:
            continue
        candidate = bundle / Path(seg_file).name
        if candidate.exists() and candidate != primary_video:
            segment_files.append(candidate)
    # Dedup while preserving order (the primary video may also appear in video_segments[0]).
    seen = set()
    video_paths = [p for p in segment_files if not (p in seen or seen.add(p))]
    video_paths = [p for p in video_paths if p.exists()]
    if not video_paths:
        print(f"no video in bundle ({primary_video.name}) — nothing to transcribe", file=sys.stderr)
        return 1
    if manifest.get("narration_in_video") is False:
        print("manifest says narration_in_video: false — the video has no mic audio.", file=sys.stderr)
        print("Transcribing anyway; expect an empty result if it's truly silent.")

    offsets = {}
    for i, seg in enumerate(manifest.get("video_segments") or []):
        if not isinstance(seg, dict):
            raise ValueError("Malformed video segment")
        name = Path(seg.get("file") or ("video.webm" if i == 0 else f"video-{i + 1}.webm")).name
        offset = seg.get("offset_ms", 0)
        if isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset) or offset < 0:
            raise ValueError("Invalid video segment offset_ms")
        offsets[name] = offset

    # Each WebM starts at its own PTS zero. Transcribe independently and translate
    # cue times onto the recording clock, preserving gaps rather than concatenating
    # them away. No transcript redaction is introduced here.
    combined = []
    with tempfile.TemporaryDirectory() as td:
        for i, video in enumerate(video_paths):
            wav = Path(td) / f"audio-{i}.wav"
            extract_audio(video, wav)
            if engine == "whisper":
                part, _ = run_whisper(wav, model or "base")
            elif engine == "qwen3-asr":
                part, _ = run_qwen(wav, model or "1.7b", chunk)
            else:
                part, _ = run_parakeet(wav, model)
            combined.extend(offset_cues(part, offsets.get(video.name, 0)))
    combined.sort(key=lambda cue: cue[0])
    lines = ["WEBVTT", "", f"NOTE engine={engine}; segment offsets applied", ""]
    for start, end, text in combined:
        lines.extend([f"{vtt_time(start)} --> {vtt_time(end)}", text, ""])
    vtt, cues = "\n".join(lines) + "\n", len(combined)

    vtt_path = bundle / "transcript.vtt"
    vtt_path.write_text(vtt, encoding="utf-8")
    print(f"✓ transcript.vtt written to {bundle} — {cues} cue(s), engine {engine}")
    if not cues:
        print("  (no speech detected — the audio may be silent)")

    # Domain post-pass: fix terms general ASR can't get (Distru, METRC, Stiiizy…).
    if use_glossary and cues:
        changed = glossary_mod.apply_to_file(vtt_path, glossary_mod.load_glossary(glossary_path))
        if changed:
            print(f"  glossary: {changed} line(s) corrected")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Transcribe a Capture Bundle's narration locally.")
    ap.add_argument("bundle", type=Path, nargs="?", default=None,
                    help="path to a capture bundle directory (omit with --selftest)")
    ap.add_argument("--selftest", action="store_true",
                    help="verify ffmpeg + the speech engine work end-to-end (and pre-warm the "
                         "model), then exit. Used by install.sh/install.ps1; needs no bundle.")
    ap.add_argument("--engine", choices=["parakeet", "qwen3-asr", "whisper"], default=None,
                    help="speech engine (default: parakeet for a run; --selftest auto-detects "
                         "the installed engine unless this is set)")
    ap.add_argument("--model", default="",
                    help="parakeet: an HF repo id (default parakeet-tdt-0.6b-v3). "
                         "qwen3-asr: 1.7b (default) | 0.6b | repo id. "
                         "whisper: base (default) | small | medium | large-v3")
    ap.add_argument("--chunk", type=float, default=8.0,
                    help="qwen3-asr chunk seconds — smaller = finer timestamps (default: 8)")
    ap.add_argument("--glossary", type=Path, default=None,
                    help="domain glossary JSON to apply after transcription (default: glossary.json)")
    ap.add_argument("--no-glossary", action="store_true",
                    help="skip the domain glossary post-pass")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(selftest(args.engine or "parakeet", args.model, args.chunk,
                          engine_explicit=args.engine is not None))

    if args.bundle is None:
        ap.error("a bundle directory is required (or pass --selftest)")
    if not (args.bundle / "manifest.json").exists() and not (args.bundle / "video.webm").exists():
        sys.exit(f"error: {args.bundle} doesn't look like a capture bundle (no manifest.json/video.webm)")
    sys.exit(transcribe(args.bundle, args.engine, args.model, args.chunk,
                        args.glossary, use_glossary=not args.no_glossary))


if __name__ == "__main__":
    main()
