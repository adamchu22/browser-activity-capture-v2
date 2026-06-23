"""Auto-pack: turn every new capture zip in a location into an analysis pack.

Point it at a folder (where the extension downloads captures) and it builds a
pack for every capture zip that doesn't have one yet — so "record → hand off the
pack" needs no manual `pack.py` step per recording. It's idempotent (skips zips
already packed) and best-effort per zip (one bad zip doesn't stop the rest), so a
scheduler (launchd / cron / a folder watcher — see to-do-current.md "install on
new computers") can just call it on a timer, or a person can run it by hand.

    python analyze/autopack.py                 # use configured/default location(s)
    python analyze/autopack.py ~/Downloads      # pack new capture zips in a folder
    python analyze/autopack.py --watch          # poll the location(s) forever

Per-user locations live in `analyze/autopack.config.json` (git-ignored, written
by setup): {"watch_dirs": ["~/Downloads"], "packs_dir": "~/captures/packs"}.
With no config and no argument it defaults to ~/Downloads, packs written beside
each zip as `<name>-pack/`.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import zipfile
from pathlib import Path

# pack.py lives beside this file; analyze/ is on sys.path when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack import build_pack, load_blocklist  # noqa: E402

CONFIG = Path(__file__).resolve().parent / "autopack.config.json"
# A capture zip is one that carries these at its root (see the extension export).
BUNDLE_MARKERS = ("manifest.json", "timeline.json")


def load_config() -> dict:
    """Per-user watch dirs + packs dir, if setup wrote them. Never raises."""
    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        return cfg if isinstance(cfg, dict) else {}
    except Exception:  # noqa: BLE001 — missing/malformed config falls back to defaults
        return {}


def _expand(p: str | Path) -> Path:
    return Path(p).expanduser()


def resolve_locations(arg_locations: list[str]) -> tuple[list[Path], Path | None]:
    """Decide which folders to scan and where packs go. CLI args win over config;
    config wins over the ~/Downloads default. packs_dir None = beside each zip."""
    cfg = load_config()
    if arg_locations:
        locs = [_expand(p) for p in arg_locations]
    elif cfg.get("watch_dirs"):
        locs = [_expand(p) for p in cfg["watch_dirs"] if isinstance(p, str)]
    else:
        locs = [_expand("~/Downloads")]
    packs_dir = _expand(cfg["packs_dir"]) if isinstance(cfg.get("packs_dir"), str) else None
    return locs, packs_dir


def is_capture_zip(z: Path) -> bool:
    """True if the zip looks like a capture bundle (has the marker files at root).
    Cheap: reads only the central directory, not the contents."""
    try:
        with zipfile.ZipFile(z) as zf:
            names = set(zf.namelist())
    except (zipfile.BadZipFile, OSError):
        return False
    return any(m in names for m in BUNDLE_MARKERS)


def pack_path_for(z: Path, packs_dir: Path | None) -> Path:
    """Destination pack dir for a zip: under packs_dir if configured, else beside it."""
    base = packs_dir if packs_dir else z.parent
    return base / f"{z.stem}-pack"


def find_unpacked(location: Path, packs_dir: Path | None) -> list[tuple[Path, Path]]:
    """(zip, pack_dir) pairs for capture zips in `location` that aren't packed yet."""
    if not location.is_dir():
        return []
    out = []
    for z in sorted(location.glob("*.zip")):
        dest = pack_path_for(z, packs_dir)
        if dest.exists():
            continue  # already packed — idempotent
        if is_capture_zip(z):
            out.append((z, dest))
    return out


def pack_zip(z: Path, dest: Path, blocklist: list[str] | None = None,
             transcribe: bool = True) -> None:
    """Extract a capture zip to a temp bundle and build its pack at `dest`."""
    import tempfile
    with tempfile.TemporaryDirectory(prefix="autopack-") as tmp:
        bundle = Path(tmp)
        with zipfile.ZipFile(z) as zf:
            # Guard against path traversal in a hostile zip (Zip Slip): only extract
            # members that stay inside the temp dir.
            for member in zf.namelist():
                target = (bundle / member).resolve()
                if not str(target).startswith(str(bundle.resolve())):
                    raise ValueError(f"unsafe path in zip: {member}")
            zf.extractall(bundle)
        dest.parent.mkdir(parents=True, exist_ok=True)
        build_pack(bundle, dest, blocklist, transcribe=transcribe)


def run(locations: list[Path], packs_dir: Path | None, *, transcribe: bool = True) -> dict:
    """One pass: pack every new capture zip across all locations. Returns a summary;
    a failing zip is recorded and skipped (never aborts the batch)."""
    blocklist = load_blocklist()
    packed, failed, skipped = [], [], 0
    for loc in locations:
        todo = find_unpacked(loc, packs_dir)
        for z, dest in todo:
            try:
                pack_zip(z, dest, blocklist, transcribe)
                packed.append(str(dest))
                print(f"✓ packed {z.name} → {dest}", file=sys.stderr)
            except Exception as e:  # noqa: BLE001 — one bad zip mustn't stop the batch
                failed.append({"zip": str(z), "error": f"{type(e).__name__}: {e}"})
                print(f"✗ failed {z.name}: {type(e).__name__}: {e}", file=sys.stderr)
    return {"packed": packed, "failed": failed, "skipped": skipped}


def main() -> None:
    ap = argparse.ArgumentParser(description="Build analysis packs for new capture zips in a location.")
    ap.add_argument("locations", nargs="*", help="folder(s) to scan (default: config or ~/Downloads)")
    ap.add_argument("--watch", action="store_true", help="poll the location(s) forever")
    ap.add_argument("--interval", type=float, default=30.0, help="seconds between polls in --watch (default 30)")
    ap.add_argument("--no-transcribe", action="store_true", help="skip the local ASR step")
    args = ap.parse_args()

    locations, packs_dir = resolve_locations(args.locations)
    print(f"autopack: scanning {', '.join(str(p) for p in locations)}"
          + (f" → packs in {packs_dir}" if packs_dir else " → packs beside each zip"),
          file=sys.stderr)

    def one_pass():
        s = run(locations, packs_dir, transcribe=not args.no_transcribe)
        if not s["packed"] and not s["failed"]:
            print("autopack: nothing new to pack.", file=sys.stderr)
        return s

    if args.watch:
        print(f"autopack: watching every {args.interval:g}s (Ctrl-C to stop)…", file=sys.stderr)
        try:
            while True:
                one_pass()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\nautopack: stopped.", file=sys.stderr)
    else:
        one_pass()


if __name__ == "__main__":
    main()
