"""Machine-local pointer to THIS install of the analyze pipeline.

Why this exists: a capture bundle (the raw zip) is usually handed to an agent
working in some *other* directory — so the agent has no idea where `pack.py`
lives. This writes a tiny JSON pointer at a FIXED, documented home path that any
agent can read to locate the pipeline (and the transcription `.venv` python),
build the fused `context.md` spine, and stop doing the multi-step stream-join by
hand. See the "Step 0" block the export embeds via extension/src/bundle-docs.js.

Written by `analyze/setup.sh` / `setup.ps1` at install time (they know the path,
so there's no fragile filesystem search). An agent that finds a checkout but no
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


def build_record(adir: Path | None = None, python: str | None = None) -> dict:
    adir = (adir or analyze_dir()).resolve()
    python = python or repo_python()
    return {
        "tool": "browser-activity-capture",
        "analyze_dir": str(adir),
        "python": python,
        # Ready-to-run template; the agent substitutes the bundle path.
        "pack_cmd": f'{python} {adir / "pack.py"} <bundle> --out <bundle>-pack',
    }


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
    print(f"registered analyze pipeline → {p}")
