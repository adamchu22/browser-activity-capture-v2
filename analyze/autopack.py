"""Auto-pack: turn every new capture zip in a location into an analysis pack.

Point it at a folder (where the extension downloads captures) and it builds a
pack for every capture zip that doesn't have one yet — so "record → hand off the
pack" needs no manual `pack.py` step per recording. It's idempotent (skips zips
already packed) and best-effort per zip (one bad zip doesn't stop the rest), so a
scheduler (launchd / Task Scheduler / a systemd timer — see PLAN-autopack-install.md)
can just call it on a timer, or a person can run it by hand.

    python analyze/autopack.py                 # use configured/default location(s)
    python analyze/autopack.py ~/Downloads      # pack new capture zips in a folder
    python analyze/autopack.py --watch          # poll the location(s) forever

Per-user locations live in `analyze/autopack.config.json` (git-ignored, written
by setup): {"watch_dirs": ["~/Downloads"], "packs_dir": "~/captures/packs"}.
With no config and no argument it defaults to ~/Downloads, packs written beside
each zip as `<name>-pack/`.

Built to run UNATTENDED as a background service, so it guards the failure modes a
human-watched manual run survives but a silent service does not (see
PLAN-autopack-install.md R1–R6 / D4b):
  • atomic builds — build into a `.tmp` sibling, then os.replace into place, so an
    interrupted build (sleep/kill/timeout) never leaves a half-pack that the
    idempotency check would skip forever;
  • single-instance lock — only one autopack runs per machine (service + a manual
    --watch can't race on the same zip);
  • failure memory + backoff — a corrupt/aborted download is retried a few times
    then given up on, not re-attempted every poll forever;
  • skip-fresh — a zip still being written is left to settle;
  • zip-bomb size cap on extraction; and tightened capture detection (filename
    pattern + a real manifest) so it doesn't process arbitrary downloaded zips.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import sys
import time
import zipfile
from pathlib import Path

# pack.py / install_pointer.py live beside this file; analyze/ is on sys.path when
# run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack import build_pack, load_blocklist  # noqa: E402
import install_pointer  # noqa: E402 — config_home() for the XDG-aware lock/state dir

CONFIG = Path(__file__).resolve().parent / "autopack.config.json"

# The extension names every export `capture-<ISO8601>.zip` (background.js
# exportFilename). Watching a low-trust Downloads folder, we only consider zips
# matching that name AND carrying a real manifest (is_capture_zip), so a random
# downloaded zip with a stray manifest.json isn't auto-extracted and processed.
CAPTURE_NAME_RE = re.compile(r"^capture-.*\.zip$", re.IGNORECASE)
# Refuse to fully decompress a zip whose uncompressed size blows past this (zip
# bomb / runaway disk). A real capture is at most a few hundred MB.
MAX_UNCOMPRESSED_BYTES = 4 * 1024 ** 3
# manifest.json is tiny; refuse to read a hostile multi-MB one into memory.
MAX_MANIFEST_BYTES = 8 * 1024 * 1024
# Leave a just-downloaded zip alone until its mtime is at least this old, so we
# never grab a file mid-write (defense in depth — Chrome renames *.crdownload→*.zip
# only on completion, but other browsers may differ).
STABILIZE_SECONDS = 10.0
# Give up on a zip that fails to pack this many times (corrupt/aborted download),
# rather than retrying it every poll forever.
MAX_ATTEMPTS = 3


# ---- per-user config + the machine-local state/lock dir ----------------------

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


def state_dir() -> Path:
    """Machine-local home for the lock + failure-memory state (XDG-aware, shared
    with install_pointer so a redirected XDG_CONFIG_HOME moves both)."""
    return install_pointer.config_home() / "browser-activity-capture"


def lock_path() -> Path:
    return state_dir() / "autopack.lock"


def state_path() -> Path:
    return state_dir() / "autopack.state.json"


# ---- discovery ---------------------------------------------------------------

def is_capture_zip(z: Path) -> bool:
    """True if the zip carries a real capture manifest (a dict with capture_id +
    t0_wall). Cheap: reads only manifest.json from the central directory, and
    refuses a hostile oversized manifest."""
    try:
        with zipfile.ZipFile(z) as zf:
            try:
                info = zf.getinfo("manifest.json")
            except KeyError:
                return False
            if info.file_size > MAX_MANIFEST_BYTES:
                return False
            data = json.loads(zf.read("manifest.json"))
    except (zipfile.BadZipFile, OSError, ValueError):
        return False
    return isinstance(data, dict) and bool(data.get("capture_id")) and bool(data.get("t0_wall"))


def pack_path_for(z: Path, packs_dir: Path | None) -> Path:
    """Destination pack dir for a zip: under packs_dir if configured, else beside it."""
    base = packs_dir if packs_dir else z.parent
    return base / f"{z.stem}-pack"


def find_unpacked(
    location: Path,
    packs_dir: Path | None,
    *,
    min_age_s: float = 0.0,
    now: float | None = None,
) -> list[tuple[Path, Path]]:
    """(zip, pack_dir) pairs for capture zips in `location` that aren't packed yet.
    Skips zips younger than min_age_s (still settling) and anything not matching the
    extension's `capture-*.zip` name."""
    if not location.is_dir():
        return []
    now = time.time() if now is None else now
    out = []
    for z in sorted(location.glob("*.zip")):
        if not CAPTURE_NAME_RE.match(z.name):
            continue
        dest = pack_path_for(z, packs_dir)
        if dest.exists():
            continue  # already packed — idempotent (dest exists ⇒ a COMPLETE pack, see pack_zip)
        try:
            age = now - z.stat().st_mtime
        except OSError:
            continue
        if age < min_age_s:
            continue  # still being written / settling — leave it for a later pass
        if is_capture_zip(z):
            out.append((z, dest))
    return out


# ---- packing -----------------------------------------------------------------

def pack_zip(z: Path, dest: Path, blocklist: list[str] | None = None,
             transcribe: bool = True) -> None:
    """Extract a capture zip to a temp bundle and build its pack at `dest`,
    atomically. Guards Zip-Slip and a decompression bomb; an interrupted build
    leaves a `.tmp` sibling (swept later), never a half-built `dest`."""
    import tempfile
    with tempfile.TemporaryDirectory(prefix="autopack-") as tmp:
        bundle = Path(tmp)
        bundle_root = str(bundle.resolve())
        with zipfile.ZipFile(z) as zf:
            total = 0
            for member in zf.infolist():
                total += member.file_size
                if total > MAX_UNCOMPRESSED_BYTES:
                    raise ValueError(
                        f"zip decompresses to > {MAX_UNCOMPRESSED_BYTES} bytes: {z.name}")
                # Zip Slip: only extract members that stay inside the temp dir.
                target = (bundle / member.filename).resolve()
                if not str(target).startswith(bundle_root):
                    raise ValueError(f"unsafe path in zip: {member.filename}")
            zf.extractall(bundle)
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Build into a temp sibling, then atomically swap it in. So a build killed
        # mid-way (sleep / logout / the 30-min transcribe timeout) leaves a `.tmp`
        # dir — never a half-built `dest` that find_unpacked would skip forever.
        staging = dest.parent / f".{dest.name}.tmp-{os.getpid()}"
        shutil.rmtree(staging, ignore_errors=True)
        try:
            build_pack(bundle, staging, blocklist, transcribe=transcribe)
            os.replace(staging, dest)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise


def sweep_stale_temps(locations: list[Path], packs_dir: Path | None) -> None:
    """Remove orphaned `.<name>-pack.tmp-*` staging dirs from interrupted builds.
    Safe under the single-instance lock: no other autopack is mid-build, so every
    `.tmp` dir is an orphan."""
    bases = {packs_dir} if packs_dir else set()
    if not packs_dir:
        bases.update(locations)
    for base in bases:
        try:
            for d in base.glob(".*-pack.tmp-*"):
                if d.is_dir():
                    shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


# ---- failure memory ----------------------------------------------------------

def failure_key(z: Path) -> str:
    """Identity of a zip for retry-tracking. Includes size+mtime so a re-download
    (same name, new content) is treated as a fresh file and retried from zero."""
    try:
        s = z.stat()
        return f"{z.resolve()}|{s.st_size}|{int(s.st_mtime)}"
    except OSError:
        return str(z)


def load_state(path: Path | None = None) -> dict:
    """Failure-memory state. Never raises (missing/malformed ⇒ empty)."""
    path = path or state_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def save_state(state: dict, path: Path | None = None) -> None:
    """Persist state atomically. Best-effort — never crash the service over it."""
    path = path or state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


# ---- single-instance lock ----------------------------------------------------

def acquire_lock(path: Path):
    """Best-effort cross-process lock. Returns an open file handle to HOLD (close
    it to release), or None if another instance already holds it. The OS releases
    it automatically if this process dies, so there's no stale-lock problem."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        f = open(path, "w")
    except OSError:
        return None
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


# ---- the pass ----------------------------------------------------------------

def run(
    locations: list[Path],
    packs_dir: Path | None,
    *,
    transcribe: bool = True,
    min_age_s: float = 0.0,
    now: float | None = None,
    state_file: Path | None = None,
) -> dict:
    """One pass: pack every new capture zip across all locations. Returns a summary.
    A zip that fails is recorded (never aborts the batch); after MAX_ATTEMPTS it's
    given up on instead of retried every poll."""
    blocklist = load_blocklist()
    sweep_stale_temps(locations, packs_dir)
    st = load_state(state_file)
    failures = st.setdefault("failures", {})
    packed, failed, gaveup, skipped = [], [], [], 0
    for loc in locations:
        for z, dest in find_unpacked(loc, packs_dir, min_age_s=min_age_s, now=now):
            key = failure_key(z)
            rec = failures.get(key)
            if rec and rec.get("attempts", 0) >= MAX_ATTEMPTS:
                gaveup.append(str(z))
                continue
            try:
                pack_zip(z, dest, blocklist, transcribe)
                packed.append(str(dest))
                failures.pop(key, None)  # success clears any prior failure record
                print(f"✓ packed {z.name} → {dest}", file=sys.stderr)
            except Exception as e:  # noqa: BLE001 — one bad zip mustn't stop the batch
                attempts = (rec.get("attempts", 0) if rec else 0) + 1
                err = f"{type(e).__name__}: {e}"
                failures[key] = {"attempts": attempts, "last_error": err}
                failed.append({"zip": str(z), "error": err, "attempts": attempts})
                print(f"✗ failed {z.name} (attempt {attempts}/{MAX_ATTEMPTS}): {err}",
                      file=sys.stderr)
    save_state(st, state_file)
    return {"packed": packed, "failed": failed, "gaveup": gaveup, "skipped": skipped}


def main() -> None:
    ap = argparse.ArgumentParser(description="Build analysis packs for new capture zips in a location.")
    ap.add_argument("locations", nargs="*", help="folder(s) to scan (default: config or ~/Downloads)")
    ap.add_argument("--watch", action="store_true", help="poll the location(s) forever")
    ap.add_argument("--interval", type=float, default=60.0, help="seconds between polls in --watch (default 60)")
    ap.add_argument("--min-age", type=float, default=STABILIZE_SECONDS,
                    help=f"ignore zips younger than this many seconds (default {STABILIZE_SECONDS:g})")
    ap.add_argument("--no-transcribe", action="store_true", help="skip the local ASR step")
    args = ap.parse_args()

    locations, packs_dir = resolve_locations(args.locations)

    # One autopack per machine: a second instance (e.g. the service + a manual
    # --watch) exits quietly rather than racing on the same zip.
    lock = acquire_lock(lock_path())
    if lock is None:
        print("autopack: another instance is already running — exiting.", file=sys.stderr)
        return

    with contextlib.closing(lock):
        print(f"autopack: scanning {', '.join(str(p) for p in locations)}"
              + (f" → packs in {packs_dir}" if packs_dir else " → packs beside each zip"),
              file=sys.stderr)

        def one_pass():
            s = run(locations, packs_dir, transcribe=not args.no_transcribe, min_age_s=args.min_age)
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
