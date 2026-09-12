"""Auto-pack: turn every new capture zip in a location into an analysis pack.

Point it at a folder (where the extension downloads captures) and it builds a
pack for every capture zip that doesn't have one yet — so "record → hand off the
pack" needs no manual `pack.py` step per recording. It's idempotent (skips zips
already packed) and best-effort per zip (one bad zip doesn't stop the rest), so a
scheduler (launchd / Task Scheduler / a systemd timer)
can just call it on a timer, or a person can run it by hand.

    python analyze/autopack.py                 # one pass over configured/default location(s)
    python analyze/autopack.py ~/Downloads      # pack new capture zips in a folder
    python analyze/autopack.py --once           # one pass + exit (what the OS scheduler runs)
    python analyze/autopack.py --watch          # poll the location(s) forever
    python analyze/autopack.py --status         # report last run + outstanding failures (read-only)

Each pass that does work appends a line to a rotating activity log at
`<config>/browser-activity-capture/autopack.log`, and records its time + counts in
the state file so `--status` can report liveness and what failed.

Per-user locations live in `analyze/autopack.config.json` (git-ignored, written
by setup): {"watch_dirs": ["~/Downloads"], "packs_dir": "~/captures/packs"}.
With no config and no argument it defaults to ~/Downloads, packs written beside
each zip as `<name>-pack/`.

Built to run UNATTENDED as a background service, so it guards the failure modes a
human-watched manual run survives but a silent service does not:
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
# Rotate the activity log once it passes this size, keeping one prior generation
# (`autopack.log.1`). A service running every 60s for years must never grow the
# log without bound.
MAX_LOG_BYTES = 1 * 1024 * 1024


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


def log_path() -> Path:
    return state_dir() / "autopack.log"


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
        if 0 < min_age_s and age < min_age_s:
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
                if not target.is_relative_to(bundle.resolve()):
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


# ---- activity log + status ---------------------------------------------------

def _isoformat(ts: float) -> str:
    """Local-time ISO8601 (to the second) for a log/status timestamp."""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ts))


def append_log(line: str, *, path: Path | None = None,
               max_bytes: int = MAX_LOG_BYTES) -> None:
    """Append one line to the rotating activity log. Best-effort — a logging
    failure must never crash the service. When the log would pass max_bytes it's
    rotated to `<log>.1` (one generation kept), then the line starts a fresh log."""
    path = path or log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        if size and size + len(line) + 1 > max_bytes:
            os.replace(path, path.with_name(path.name + ".1"))
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def _summary_line(ts: float, summary: dict) -> str:
    """One grep-able line describing a pass that did something."""
    parts = [f"packed={len(summary['packed'])}",
             f"failed={len(summary['failed'])}",
             f"gaveup={len(summary['gaveup'])}"]
    line = f"{_isoformat(ts)} " + " ".join(parts)
    if summary["packed"]:
        line += "; packed " + ", ".join(Path(p).name for p in summary["packed"])
    if summary["failed"]:
        line += "; failed " + ", ".join(
            f"{Path(f['zip']).name} ({f['error']})" for f in summary["failed"])
    if summary["gaveup"]:
        line += "; gave up on " + ", ".join(Path(z).name for z in summary["gaveup"])
    return line


def _ago(seconds: float) -> str:
    """Coarse human duration for status output."""
    seconds = max(0.0, seconds)
    if seconds < 90:
        return f"{seconds:.0f}s"
    if seconds < 5400:
        return f"{seconds / 60:.0f}m"
    if seconds < 172800:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


def status_report(locations: list[Path], packs_dir: Path | None, *,
                  state: dict | None = None, now: float | None = None) -> str:
    """Human-readable status from the state file: where we're watching, when the
    service last ran and with what result, and any zips still failing / given up
    on. Read-only — `--status` calls this without taking the lock."""
    state = load_state() if state is None else state
    now = time.time() if now is None else now
    lines = ["autopack status"]
    dest = f"packs in {packs_dir}" if packs_dir else "packs beside each zip"
    lines.append(f"  watching: {', '.join(str(p) for p in locations)} ({dest})")
    for loc in locations:
        if not loc.is_dir():
            lines.append(f"  ⚠ {loc} — folder does not exist")
            continue
        caps = [z for z in loc.glob("*.zip") if CAPTURE_NAME_RE.match(z.name)]
        if not caps:
            lines.append(f"  {loc}: no capture zips seen yet")
            continue
        try:
            newest = max(caps, key=lambda z: z.stat().st_mtime)
            age = _ago(now - newest.stat().st_mtime)
            lines.append(f"  {loc}: {len(caps)} capture zip(s), newest {age} ago")
        except OSError:
            lines.append(f"  {loc}: {len(caps)} capture zip(s)")

    last = state.get("last_run")
    if isinstance(last, dict):
        lines.append(
            f"  last run: {last.get('at', '?')} — {last.get('packed', 0)} packed, "
            f"{last.get('failed', 0)} failed, {last.get('gaveup', 0)} given up")
    else:
        lines.append("  last run: no record yet")

    failures = state.get("failures")
    failures = failures if isinstance(failures, dict) else {}
    if not failures:
        lines.append("  no failures recorded")
        return "\n".join(lines)
    lines.append(f"  outstanding ({len(failures)}):")
    for key, rec in failures.items():
        rec = rec if isinstance(rec, dict) else {}
        attempts = rec.get("attempts", 0)
        tag = "GIVEN UP" if attempts >= MAX_ATTEMPTS else f"attempt {attempts}/{MAX_ATTEMPTS}"
        name = Path(str(key).split("|", 1)[0]).name
        lines.append(f"    ✗ {name} [{tag}] {rec.get('last_error', '')}".rstrip())
    return "\n".join(lines)


# ---- the pass ----------------------------------------------------------------

def run(
    locations: list[Path],
    packs_dir: Path | None,
    *,
    transcribe: bool = True,
    min_age_s: float = 0.0,
    now: float | None = None,
    state_file: Path | None = None,
    log_file: Path | None = None,
) -> dict:
    """One pass: pack every new capture zip across all locations. Returns a summary.
    A zip that fails is recorded (never aborts the batch); after MAX_ATTEMPTS it's
    given up on instead of retried every poll. Records the pass (time + counts) in
    the state file's `last_run` so `--status` can report it, and — when log_file is
    given — appends a line to the rotating activity log for any pass that did work."""
    ts = time.time() if now is None else now
    blocklist = load_blocklist()
    sweep_stale_temps(locations, packs_dir)
    st = load_state(state_file)
    failures = st.setdefault("failures", {})
    packed, failed, gaveup, skipped = [], [], [], 0
    for loc in locations:
        for z, dest in find_unpacked(loc, packs_dir, min_age_s=min_age_s, now=ts):
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
    summary = {"packed": packed, "failed": failed, "gaveup": gaveup, "skipped": skipped}
    # Stamp the pass so --status can report liveness + result; only commit a log
    # line for a pass that actually did something (else a 60s idle service spams it).
    st["last_run"] = {"at": _isoformat(ts), "packed": len(packed),
                      "failed": len(failed), "gaveup": len(gaveup)}
    save_state(st, state_file)
    if log_file is not None and (packed or failed or gaveup):
        append_log(_summary_line(ts, summary), path=log_file)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Build analysis packs for new capture zips in a location.")
    ap.add_argument("locations", nargs="*", help="folder(s) to scan (default: config or ~/Downloads)")
    ap.add_argument("--watch", action="store_true", help="poll the location(s) forever")
    ap.add_argument("--once", action="store_true",
                    help="run a single pass and exit (the default; explicit for the OS scheduler)")
    ap.add_argument("--status", action="store_true",
                    help="report what was packed/failed/given-up and when, then exit (read-only)")
    ap.add_argument("--interval", type=float, default=60.0, help="seconds between polls in --watch (default 60)")
    ap.add_argument("--min-age", type=float, default=STABILIZE_SECONDS,
                    help=f"ignore zips younger than this many seconds (default {STABILIZE_SECONDS:g})")
    ap.add_argument("--no-transcribe", action="store_true", help="skip the local ASR step")
    args = ap.parse_args()

    if args.watch and args.once:
        ap.error("--watch and --once are mutually exclusive")

    locations, packs_dir = resolve_locations(args.locations)

    # --status is read-only: never take the lock (so it works while the service
    # is mid-pass), just print the state-file report.
    if args.status:
        print(status_report(locations, packs_dir))
        return

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
            s = run(locations, packs_dir, transcribe=not args.no_transcribe,
                    min_age_s=args.min_age, log_file=log_path())
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
