#!/usr/bin/env python3
"""Glossary post-pass: fix domain terms in a transcript.vtt that general ASR gets wrong.

No speech model is trained on Distru, METRC, Eaze, Stiiizy, BioTrack, or myrcene, so
both Parakeet and Qwen mishear them ("dispute"/"this true" → Distru, "stizzy" → Stiiizy,
"micrine" → myrcene…) and Qwen's --context flag didn't help. A deterministic find/replace
keyed on an editable dictionary (glossary.json) is the reliable fix.

Two safety properties keep it from corrupting unrelated text:
  - Replacements are case-insensitive but matched on WORD BOUNDARIES, so "increase" is
    never touched by the "ease" rule and "metrics" is never touched by "metric".
  - A variant that is also ordinary English (ease, metric, dispute) carries a `context`
    list; that rule only fires when one of those domain words appears in the same cue.
  - Only cue BODY lines are rewritten — WEBVTT, NOTE, blank, and timestamp lines pass
    through untouched.

Applied automatically by transcribe.py after writing the VTT. Run it standalone to fix a
transcript that was dropped in by hand:

    python glossary.py <bundle-dir|transcript.vtt>
    python glossary.py <path> --glossary my-glossary.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_GLOSSARY = Path(__file__).parent / "glossary.json"
_VTT_TIME = re.compile(r"\d{2}:\d{2}:\d{2}\.\d{3}\s*-->")


def load_glossary(path: Path | None = None) -> list[dict]:
    """Read the term list from glossary.json. The top-level `_comment` and any other
    non-`terms` keys are ignored, so the file can carry documentation inline."""
    path = path or DEFAULT_GLOSSARY
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data.get("terms", []) if isinstance(data, dict) else list(data)


def _compile(term: dict) -> tuple[str, list[re.Pattern], list[str]]:
    """Pre-compile one term into (canonical, [variant patterns], [lowercased context])."""
    canonical = term["canonical"]
    pats = []
    for v in term.get("variants", []):
        # Join multi-word variants with \s+ so "this true" matches across any whitespace,
        # and bracket with \b so we only ever replace whole words.
        body = r"\s+".join(re.escape(w) for w in v.split())
        pats.append(re.compile(rf"\b{body}\b", re.IGNORECASE))
    context = [c.lower() for c in term.get("context", [])]
    return canonical, pats, context


def _rewrite_cue(body_lines: list[str], compiled: list) -> list[str]:
    """Apply every term to a single cue's body lines. Context is judged against the whole
    cue body (joined + lowercased) so a guard word on any line enables the replacement."""
    haystack = " ".join(body_lines).lower()
    out = []
    for line in body_lines:
        for canonical, pats, context in compiled:
            if context and not any(c in haystack for c in context):
                continue
            for pat in pats:
                line = pat.sub(canonical, line)
        out.append(line)
    return out


def apply_glossary(vtt_text: str, glossary: list[dict]) -> str:
    """Return `vtt_text` with glossary fixes applied to cue bodies only. Idempotent:
    re-running on already-fixed text is a no-op because canonical forms don't match the
    variant patterns. Header, NOTE, blank, and timestamp lines are preserved verbatim."""
    compiled = [_compile(t) for t in glossary]
    if not compiled:
        return vtt_text
    lines = vtt_text.splitlines()
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        if _VTT_TIME.search(line):
            out.append(line)  # timestamp line — never rewritten
            i += 1
            body = []
            while i < n and lines[i].strip():
                body.append(lines[i])
                i += 1
            out.extend(_rewrite_cue(body, compiled))
        else:
            out.append(line)  # WEBVTT / NOTE / cue-id / blank — pass through
            i += 1
    return "\n".join(out) + ("\n" if vtt_text.endswith("\n") else "")


def apply_to_file(vtt_path: Path, glossary: list[dict]) -> int:
    """Rewrite a transcript.vtt in place. Returns the number of cue lines changed."""
    text = vtt_path.read_text(encoding="utf-8")
    fixed = apply_glossary(text, glossary)
    if fixed != text:
        vtt_path.write_text(fixed, encoding="utf-8")
    # Count changed lines for a useful log without re-deriving per-term stats.
    return sum(1 for a, b in zip(text.splitlines(), fixed.splitlines()) if a != b)


def main() -> None:
    ap = argparse.ArgumentParser(description="Apply the domain glossary to a transcript.vtt.")
    ap.add_argument("target", type=Path, help="a bundle directory or a transcript.vtt path")
    ap.add_argument("--glossary", type=Path, default=None, help="glossary JSON (default: glossary.json)")
    args = ap.parse_args()

    vtt = args.target / "transcript.vtt" if args.target.is_dir() else args.target
    if not vtt.exists():
        sys.exit(f"error: no transcript at {vtt}")

    changed = apply_to_file(vtt, load_glossary(args.glossary))
    print(f"✓ glossary applied to {vtt} — {changed} line(s) changed")


if __name__ == "__main__":
    main()
