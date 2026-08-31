"""Machine-local pointer to THIS install of the analyze pipeline.

Why this exists: a capture bundle (the raw zip) is usually handed to an agent
working in some *other* directory — so the agent has no idea where `pack.py`
lives. This writes a tiny JSON pointer at a FIXED, documented home path that any
agent can read to locate the pipeline (and the transcription `.venv` python),
build the fused `context.md` spine, and stop doing the multi-step stream-join by
hand. See the "Step 0" block the export embeds via extension/src/bundle-docs.js.

It also records WHICH speech engine was installed and WHERE the ASR model weights
were cached, so an agent recovering narration from a bundle re-uses the model this
machine already downloaded instead of fetching a second copy.

Written by `install.sh` / `install.ps1` at install time (they know the path, so
there's no fragile filesystem search). An agent that finds a checkout but no
pointer can also run this module once to record the location:

    python analyze/install_pointer.py

Read it from anywhere with read_pointer(). Stdlib only; never raises on a
missing/malformed pointer (returns None) so callers degrade to self-driving.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Fixed, provider-neutral location (NOT ~/.claude/* — bundles are handed to
# non-Claude agents too). Honors XDG_CONFIG_HOME so tests can redirect it.
POINTER_REL = Path("browser-activity-capture") / "install.json"


def config_home() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    return (Path(base) if base else Path.home() / ".config").expanduser()


def pointer_path() -> Path:
    return config_home() / POINTER_REL


def analyze_dir() -> Path:
    """The directory this file lives in — i.e. the installed `analyze/`."""
    return Path(__file__).resolve().parent


def repo_python() -> str:
    """Prefer the repo's transcription `.venv` python (so the agent's pack run
    also fills narration); fall back to the current interpreter."""
    venv = analyze_dir().parent / ".venv"
    for cand in (venv / "bin" / "python", venv / "Scripts" / "python.exe"):
        if cand.exists():
            return str(cand)
    return sys.executable


def engine_info() -> dict:
    """Which ASR engine is importable HERE, and where its weights are cached.

    Run by the installer with the .venv interpreter, so "importable here" is exactly
    what pack.py will pick at run time. Best-effort: this pulls engine metadata from
    transcribe.py, and if that import fails for any reason we record nothing rather
    than failing the install over a nice-to-have field.
    """
    sys.path.insert(0, str(analyze_dir()))
    try:
        import transcribe
    except Exception:  # noqa: BLE001 — the pointer's core job must still succeed
        return {}
    engine = transcribe._available_engine()
    if engine is None:
        return {}
    # The repo id / name the engine is invoked with, plus the on-disk snapshot when the
    # weights are already cached. find_local_model falls back to the repo id, which is
    # still valid to pass an engine — it just means "not downloaded yet", so only record
    # model_path when it actually resolved to a real directory.
    model = transcribe.PARAKEET_DEFAULT if engine == "parakeet" else "base"
    repo = model if engine == "parakeet" else f"Systran/faster-whisper-{model}"
    info = {"engine": engine, "model": model}
    resolved = transcribe.find_local_model(repo)
    if resolved != repo and Path(resolved).exists():
        info["model_path"] = resolved
    return info


def build_record(adir: Path | None = None, python: str | None = None) -> dict:
    adir = (adir or analyze_dir()).resolve()
    python = python or repo_python()
    rec = {
        "tool": "browser-activity-capture",
        "analyze_dir": str(adir),
        "python": python,
        # Ready-to-run template; the agent substitutes the bundle path.
        "pack_cmd": f'{python} {adir / "pack.py"} <bundle> --out <bundle>-pack',
    }
    # Speech engine + cached model weights, so narration recovery re-uses this install
    # instead of downloading a second copy. Absent when no engine is installed.
    rec.update(engine_info())
    if rec.get("engine"):
        rec["transcribe_cmd"] = (
            f'{python} {adir / "transcribe.py"} <bundle> --engine {rec["engine"]}'
        )
    return rec


def write_pointer(
    adir: Path | None = None, python: str | None = None, dest: Path | None = None
) -> Path:
    """Write the pointer JSON, creating parent dirs. Returns the path written."""
    dest = dest or pointer_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        json.dumps(build_record(adir, python), indent=2) + "\n", encoding="utf-8"
    )
    return dest


def read_pointer(src: Path | None = None) -> dict | None:
    """Best-effort read. Returns the dict, or None if missing/unreadable/malformed
    (so a caller can fall back to the self-driving path without a try/except)."""
    src = src or pointer_path()
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("analyze_dir") else None


if __name__ == "__main__":
    p = write_pointer()
    rec = read_pointer(p) or {}
    print(f"registered analyze pipeline → {p}")
    if rec.get("engine"):
        print(f"  engine:  {rec['engine']}  (model {rec['model']})")
        print(f"  weights: {rec.get('model_path', '(not cached yet — downloads on first use)')}")
