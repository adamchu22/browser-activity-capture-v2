"""Bundle integrity report — health.json (the "self-validating finalize" step).

The capture manifest's frame list can drift from what's actually on disk: a
service-worker restart mid-recording can leave `manifest.frames` indexing only
the frames captured AFTER the restart, while every frame still gets written to
disk. An agent that trusts the manifest then silently loses visual ground truth
for the dropped span and never knows it (`errors.json` says "state recovered" —
which was true for state, not for the frame index).

The fix is cheap because a frame's filename IS its ms offset
(`frames/0000012345.png` → t=12345 — see background.js `captureFrame`), so the
full frame set is always recoverable from disk. This module rebuilds the index
from disk, reconciles it against the manifest, flags large gaps between
consecutive frames (a likely pause / restart / stall), and echoes the
partial-capture flags. The result makes the bundle self-VALIDATING, not just
self-describing: `health.json` plus the rebuilt frame list go into the pack so
the next agent starts from "here is what to trust," not raw streams.

Everything here is best-effort and never raises on a malformed/partial bundle
(the analyze-side "never crash" contract); a bad input yields an empty/“unknown”
report, not an exception.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# Two consecutive frames more than this far apart is a visual gap worth flagging.
# Normal cadence is the ~3s frame timer plus event-triggered frames, so 15s (5×
# the timer) is well clear of healthy spacing and points at a pause / restart /
# stall where the screen wasn't sampled.
FRAME_GAP_MS = 15_000

_FRAME_STEM = re.compile(r"^(\d+)$")


def _load_json(path: Path, default):
    """Best-effort load with a top-level type check (mirrors pack.py's chokepoint)."""
    try:
        val = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:  # noqa: BLE001 — missing / malformed / non-UTF-8 must not raise
        return default
    return val if isinstance(val, type(default)) else default


def frames_on_disk(bundle: Path) -> list[dict]:
    """The canonical frame list, rebuilt from `bundle/frames/*.png`. Each frame's
    `t` (ms since t0) is parsed from its filename, so this is complete even when
    `manifest.frames` under-indexes. Returns `[{"t": int, "file": "frames/…png"}]`
    sorted by t; filenames that aren't a pure-integer stem are skipped."""
    fdir = bundle / "frames"
    if not fdir.is_dir():
        return []
    out: list[dict] = []
    try:
        names = list(fdir.iterdir())
    except OSError:
        return []
    for p in names:
        if p.suffix.lower() != ".png":
            continue
        m = _FRAME_STEM.match(p.stem)
        if not m:
            continue
        out.append({"t": int(m.group(1)), "file": f"frames/{p.name}"})
    out.sort(key=lambda f: f["t"])
    return out


def canonical_frames(bundle: Path, manifest: dict | None = None) -> list[dict]:
    """Disk is the source of truth for which frames exist; fall back to the
    manifest's list only when there's no `frames/` directory (e.g. a stripped
    bundle). This is what every frame-consuming step should use instead of
    `manifest.get("frames")`."""
    disk = frames_on_disk(bundle)
    if disk:
        return disk
    manifest = manifest or {}
    return [f for f in (manifest.get("frames") or []) if isinstance(f, dict)]


def _frame_gaps(frames: list[dict], threshold_ms: int = FRAME_GAP_MS) -> list[dict]:
    """Spans between consecutive frames longer than `threshold_ms` — where the
    screen wasn't sampled (pause / restart / stall)."""
    gaps = []
    for a, b in zip(frames, frames[1:]):
        gap = b["t"] - a["t"]
        if gap > threshold_ms:
            gaps.append({"from_t": a["t"], "to_t": b["t"], "gap_ms": gap})
    return gaps


PARTIAL_FLAGS = {
    "storage_full": "storage filled mid-recording — timeline/events/frames/network are "
                    "TRUNCATED past that point (video may still be complete)",
    "narration_truncated": "the mic track ended before the recording did — narration stops short",
    "video_ended_early": "screen sharing stopped before Finish — video.webm ends early",
}


def build_health(bundle: Path) -> dict:
    """Reconcile manifest vs disk and report what to trust. Never raises."""
    manifest = _load_json(bundle / "manifest.json", {})
    disk = frames_on_disk(bundle)
    disk_files = {f["file"] for f in disk}

    man_frames = [f for f in (manifest.get("frames") or []) if isinstance(f, dict)]
    man_files = {f.get("file") for f in man_frames if isinstance(f.get("file"), str)}
    # Normalise manifest file refs to the bare `frames/<name>` shape disk uses.
    man_files = {("frames/" + Path(f).name) if not f.startswith("frames/") else f
                 for f in man_files}

    missing_from_disk = sorted(man_files - disk_files)     # manifest claims, not on disk
    missing_from_manifest = sorted(disk_files - man_files)  # on disk, manifest never indexed

    gaps = _frame_gaps(disk)
    flags = {k: bool(manifest.get(k)) for k in PARTIAL_FLAGS}

    warnings: list[str] = []
    if missing_from_manifest:
        warnings.append(
            f"manifest under-indexed its frames: {len(missing_from_manifest)} of "
            f"{len(disk)} frames on disk are NOT in manifest.frames (likely a "
            f"service-worker restart). The index was rebuilt from disk, so all "
            f"{len(disk)} are usable here — but a tool trusting manifest.frames "
            f"alone would lose them."
        )
    if missing_from_disk:
        warnings.append(
            f"manifest lists {len(missing_from_disk)} frame(s) that are not on disk."
        )
    if gaps:
        biggest = max(g["gap_ms"] for g in gaps)
        warnings.append(
            f"{len(gaps)} gap(s) over {FRAME_GAP_MS // 1000}s between consecutive frames "
            f"(largest {biggest // 1000}s) — the screen wasn't sampled there (pause / "
            f"restart / stall)."
        )
    for flag, msg in PARTIAL_FLAGS.items():
        if flags[flag]:
            warnings.append(f"{flag}: {msg}")

    # Video segments: a multi-segment video.webm (the user re-shared after
    # "Stop sharing") has gaps where no video was captured. Informational, not a
    # hard partial flag — events/network/mic still captured during the gaps, and
    # video_ended_early is false if the take was recovered. Surface it so a
    # reader knows to consult manifest.video_segments for the gap offsets.
    segments = manifest.get("video_segments") or []
    if isinstance(segments, list) and len(segments) > 1:
        warnings.append(
            f"video_segments: video.webm is stitched from {len(segments)} segments "
            f"(user re-shared after the screen share stopped). Events between segment "
            f"offsets have no corresponding video — see manifest.video_segments."
        )

    # Recompute ok: multi-segment is informational (the take was recovered), so
    # it doesn't flip ok to false by itself. video_ended_early (unrecovered) still
    # does, via the partial_flags loop above.
    return {
        "ok": not missing_from_disk and not any(flags.values()),
        "frames": {
            "on_disk": len(disk),
            "in_manifest": len(man_frames),
            "usable": len(disk) or len(man_frames),
            "missing_from_disk": missing_from_disk,
            "missing_from_manifest_count": len(missing_from_manifest),
        },
        "frame_gaps": gaps,
        "partial_flags": flags,
        "duration_ms": manifest.get("duration_ms"),
        "warnings": warnings,
    }
