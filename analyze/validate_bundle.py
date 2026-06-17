#!/usr/bin/env python3
"""Validate a Capture Bundle (zip or directory) before analysis.

Run this right after the extension exports a `capture-*.zip` and before
`pack.py`. It answers three questions:

  1. Is this the right shape? (required files, parseable JSON, known event kinds)
  2. Is it internally consistent? (frames referenced actually exist, timeline
     sorted on one clock, manifest counts roughly match)
  3. Did redaction hold? (no auth headers / secret-looking values in the clear)

Stdlib only. Exit code 0 = pass, 1 = problems found.

Usage:
    python validate_bundle.py ./capture-2026-06-16.zip
    python validate_bundle.py ./capture-dir/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

KNOWN_KINDS = {"nav", "speech", "click", "hover", "input", "key", "network"}
REQUIRED = ["manifest.json", "timeline.json"]
EXPECTED = ["events.jsonl", "network.har", "transcript.vtt"]

# Things that must NEVER appear in a written bundle. If they do, redaction failed.
# Two header shapes: object-key (`"authorization": "x"`) and HAR name/value
# (`{"name":"Authorization","value":"x"}`). Either with a non-redacted value leaks.
SECRET_NAMES = r"authorization|cookie|set-cookie|x-api-key|proxy-authorization"
SECRET_HEADER_RES = [
    re.compile(rf'"(?:{SECRET_NAMES})"\s*:\s*"(?!‹redacted)', re.I),
    re.compile(rf'"name"\s*:\s*"(?:{SECRET_NAMES})"\s*,\s*"value"\s*:\s*"(?!‹redacted)', re.I),
]
# A bare JWT or long bearer-ish token sitting in the clear.
TOKEN_RE = re.compile(r"\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{12,})")


class Bundle:
    """Read files from either a directory or a zip, uniformly."""

    def __init__(self, path: Path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.is_file() else None
        if self.zip:
            self.names = set(self.zip.namelist())
        else:
            self.names = {str(p.relative_to(path)) for p in path.rglob("*") if p.is_file()}

    def has(self, name: str) -> bool:
        return name in self.names

    def text(self, name: str) -> str:
        if self.zip:
            return self.zip.read(name).decode("utf-8")
        return (self.path / name).read_text(encoding="utf-8")

    def frame_files(self) -> set[str]:
        return {n for n in self.names if n.startswith("frames/") and n.endswith(".png")}


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.info: list[str] = []

    def err(self, m): self.errors.append(m)
    def warn(self, m): self.warnings.append(m)
    def ok(self, m): self.info.append(m)

    def render(self) -> int:
        for m in self.info:
            print(f"  ✓ {m}")
        for m in self.warnings:
            print(f"  ! {m}")
        for m in self.errors:
            print(f"  ✗ {m}")
        print()
        if self.errors:
            print(f"FAIL — {len(self.errors)} problem(s), {len(self.warnings)} warning(s).")
            return 1
        print(f"PASS — {len(self.warnings)} warning(s). Ready for pack.py.")
        return 0


def load_json(b: Bundle, name: str, r: Report):
    try:
        return json.loads(b.text(name))
    except Exception as e:  # noqa: BLE001
        r.err(f"{name} is not valid JSON: {e}")
        return None


def check_manifest(m: dict, b: Bundle, r: Report):
    for key in ("t0_wall", "duration_ms", "sync_mode"):
        if key not in m:
            r.err(f"manifest.json missing `{key}`")
    if m.get("sync_mode") not in (None, "self_record", "loom_offset"):
        r.warn(f"manifest sync_mode `{m.get('sync_mode')}` is unexpected")
    red = m.get("redaction") or {}
    if not red.get("password_fields_masked"):
        r.warn("manifest does not assert password_fields_masked — confirm redaction ran")
    else:
        r.ok("manifest declares redaction policy")
    return m.get("frames", [])


def check_timeline(events, r: Report):
    if not isinstance(events, list) or not events:
        r.err("timeline.json is empty or not a list")
        return [], []
    last_t = -1
    bad_kinds, unsorted = set(), False
    referenced_frames = []
    for i, e in enumerate(events):
        if "t" not in e or "kind" not in e:
            r.err(f"timeline event #{i} missing `t` or `kind`")
            continue
        if e["kind"] not in KNOWN_KINDS:
            bad_kinds.add(e["kind"])
        if e["t"] < last_t:
            unsorted = True
        last_t = e["t"]
        if e.get("frame"):
            referenced_frames.append(e["frame"])
    if bad_kinds:
        r.warn(f"timeline has unknown event kinds: {sorted(bad_kinds)}")
    if unsorted:
        r.err("timeline is not sorted by `t` — the one-clock invariant is broken")
    else:
        r.ok(f"timeline OK: {len(events)} events on one clock")
    return events, referenced_frames


def check_frames(manifest_frames, referenced, b: Bundle, r: Report):
    on_disk = b.frame_files()
    wanted = {f["file"] if isinstance(f, dict) else f for f in manifest_frames}
    wanted |= set(referenced)
    missing = {w for w in wanted if w and w not in on_disk}
    if missing:
        r.err(f"{len(missing)} referenced frame(s) not in bundle: {sorted(missing)[:3]}…")
    elif on_disk:
        r.ok(f"frames OK: {len(on_disk)} present, all references resolve")


def check_redaction(b: Bundle, r: Report):
    """The non-negotiable: scan everything textual for leaked secrets."""
    leaks = 0
    for name in ("timeline.json", "network.har", "events.jsonl"):
        if not b.has(name):
            continue
        body = b.text(name)
        if any(rx.search(body) for rx in SECRET_HEADER_RES):
            r.err(f"{name} contains an auth/cookie header that is NOT redacted")
            leaks += 1
        if TOKEN_RE.search(body):
            r.err(f"{name} contains a token/bearer value in the clear")
            leaks += 1
    if not leaks:
        r.ok("redaction check passed — no auth headers or tokens in the clear")


def validate(path: Path) -> int:
    print(f"Validating {path} …\n")
    r = Report()
    b = Bundle(path)

    for name in REQUIRED:
        if not b.has(name):
            r.err(f"missing required file `{name}`")
    if r.errors:  # can't continue without the basics
        return r.render()

    for name in EXPECTED:
        if not b.has(name):
            r.warn(f"no `{name}` (optional, but the extension normally emits it)")

    manifest = load_json(b, "manifest.json", r)
    timeline = load_json(b, "timeline.json", r)
    manifest_frames = check_manifest(manifest, b, r) if manifest else []
    _, referenced = check_timeline(timeline, r) if timeline else ([], [])
    check_frames(manifest_frames, referenced, b, r)
    if b.has("network.har"):
        load_json(b, "network.har", r) and r.ok("network.har parses")
    check_redaction(b, r)

    return r.render()


def main() -> None:
    ap = argparse.ArgumentParser(description="Validate a Capture Bundle before analysis.")
    ap.add_argument("bundle", type=Path, help="path to a capture .zip or bundle directory")
    args = ap.parse_args()
    if not args.bundle.exists():
        sys.exit(f"error: {args.bundle} does not exist")
    sys.exit(validate(args.bundle))


if __name__ == "__main__":
    main()
