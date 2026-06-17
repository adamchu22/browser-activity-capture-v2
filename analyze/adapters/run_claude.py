#!/usr/bin/env python3
"""OPTIONAL reference adapter: run the analysis with Claude via the Anthropic SDK.

This is just *one* way to consume an analysis pack — the tool itself is LLM-
agnostic (see ../pack.py and ../BRIEF.md). Use this if you want a one-command run
against Claude; otherwise hand the pack to any agent/harness you like.

It reuses the shared, provider-neutral `BRIEF.md` as the system prompt and the
shared `context.md` builder, so there's no Claude-specific copy of the
instructions to drift.

Usage:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...
    python run_claude.py ../../sample-bundle --out ./out
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import anthropic

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pack  # noqa: E402  (shared, agnostic context builder)

MODEL = "claude-opus-4-8"
MAX_FRAMES = 20
BRIEF = (Path(__file__).resolve().parent.parent / "BRIEF.md").read_text()

# Structured output so the adapter can split the result into the files BRIEF.md
# asks for. Other harnesses can instead let the agent write files directly.
SCHEMA = {
    "type": "object",
    "properties": {
        "workflow_title": {"type": "string"},
        "summary": {"type": "string"},
        "sop_markdown": {"type": "string"},
        "skill": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "skill_md": {"type": "string"},
            },
            "required": ["name", "description", "skill_md"],
            "additionalProperties": False,
        },
        "automation_suggestions_markdown": {"type": "string"},
        "open_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "workflow_title", "summary", "sop_markdown", "skill",
        "automation_suggestions_markdown", "open_questions",
    ],
    "additionalProperties": False,
}


def build_user_content(bundle: Path) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": pack.build_context(bundle)}]
    frames_dir = bundle / "frames"
    if frames_dir.is_dir():
        for frame in sorted(frames_dir.glob("*.png"))[:MAX_FRAMES]:
            offset = frame.stem.lstrip("0") or "0"
            data = base64.standard_b64encode(frame.read_bytes()).decode("utf-8")
            content.append({"type": "text", "text": f"frame @ {offset} ms ({frame.name}):"})
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": "image/png", "data": data}})
    return content


def run(bundle: Path) -> dict:
    client = anthropic.Anthropic()
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=[{"type": "text", "text": BRIEF, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": build_user_content(bundle)}],
    ) as stream:
        message = stream.get_final_message()
    return json.loads(next(b.text for b in message.content if b.type == "text"))


def write(result: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "SOP.md").write_text(result["sop_markdown"].rstrip() + "\n", encoding="utf-8")
    (out / "automation.suggestions.md").write_text(
        result["automation_suggestions_markdown"].rstrip() + "\n", encoding="utf-8")
    skill = result["skill"]
    sd = out / "skills" / skill["name"]
    sd.mkdir(parents=True, exist_ok=True)
    (sd / "SKILL.md").write_text(
        f"---\nname: {skill['name']}\ndescription: {skill['description']}\n---\n\n"
        + skill["skill_md"].rstrip() + "\n", encoding="utf-8")
    (out / "notes.md").write_text(
        f"# {result['workflow_title']}\n\n{result['summary']}\n\n## Open questions\n"
        + "\n".join(f"- {q}" for q in result["open_questions"]) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="Optional: run pack analysis with Claude.")
    ap.add_argument("bundle", type=Path)
    ap.add_argument("--out", type=Path, default=Path("./out"))
    args = ap.parse_args()
    if not (args.bundle / "timeline.json").exists():
        sys.exit(f"error: no timeline.json in {args.bundle}")
    print(f"Analyzing {args.bundle} with {MODEL} ...", file=sys.stderr)
    result = run(args.bundle)
    write(result, args.out)
    print(f"✓ {result['workflow_title']} → {args.out}/ (SOP.md, skills/, automation.suggestions.md, notes.md)",
          file=sys.stderr)


if __name__ == "__main__":
    main()
