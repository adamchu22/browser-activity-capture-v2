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


def extract_audio(video: Path, wav: Path) -> None:
    # 16 kHz mono is what these models want; -y overwrites the temp file.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(video), "-ar", "16000", "-ac", "1", str(wav)],
        check=True,
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


# ---- driver --------------------------------------------------------------

def transcribe(bundle: Path, engine: str, model: str, chunk: float,
               glossary_path: Path | None, use_glossary: bool = True) -> int:
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    # .name strips any directory so a hostile manifest can't point `video` at a file
    # outside the bundle for ffmpeg to read (path traversal on an untrusted bundle).
    video = bundle / Path(manifest.get("video") or "video.webm").name

    if not video.exists():
        print(f"no video in bundle ({video.name}) — nothing to transcribe", file=sys.stderr)
        return 1
    if manifest.get("narration_in_video") is False:
        print("manifest says narration_in_video: false — the video has no mic audio.", file=sys.stderr)
        print("Transcribing anyway; expect an empty result if it's truly silent.")

    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "audio.wav"
        extract_audio(video, wav)
        if engine == "whisper":
            vtt, cues = run_whisper(wav, model or "base")
        elif engine == "qwen3-asr":
            vtt, cues = run_qwen(wav, model or "1.7b", chunk)
        else:
            vtt, cues = run_parakeet(wav, model)

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
    ap.add_argument("bundle", type=Path, help="path to a capture bundle directory")
    ap.add_argument("--engine", choices=["parakeet", "qwen3-asr", "whisper"], default="parakeet",
                    help="speech engine (default: parakeet — fast, fine timestamps)")
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

    if not (args.bundle / "manifest.json").exists() and not (args.bundle / "video.webm").exists():
        sys.exit(f"error: {args.bundle} doesn't look like a capture bundle (no manifest.json/video.webm)")
    sys.exit(transcribe(args.bundle, args.engine, args.model, args.chunk,
                        args.glossary, use_glossary=not args.no_glossary))


if __name__ == "__main__":
    main()
