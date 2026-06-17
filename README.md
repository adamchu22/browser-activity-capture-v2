# Browser Activity Capture

Capture what you do in Chrome — narration/transcript, screen, timestamped
clicks/keystrokes/navigation, and network requests — aligned on one timeline and
exported as a single portable **Capture Bundle**. Then hand it to *any* agent,
harness, or LLM to produce **skills, SOPs, and automation suggestions**.

The bundle is the product, and it's **LLM-agnostic** — generated docs/skills are
derived from it deliberately, by whatever model you choose, not automatically and
not locked to one provider.

## Why this exists

The capture, video, transcription, and even auto-doc problems are already solved
products (rrweb, Loom, Whisper, Scribe/Tango). The missing piece is the layer
that **aligns all of them on one clock and packages them into a portable,
agent-ready bundle** aimed at producing skills/automation — not just a human help
article locked in a vendor's cloud.

## Status

Architecture locked. The **analysis step** (bundle → portable pack → any agent) is
built and runs against a hand-crafted **sample bundle**. The Chrome extension that
produces real bundles is next — it will emit the same bundle shape.

Decisions taken: self-record the tab (perfect sync), full HAR with bodies,
in-browser + downloadable zip, analysis-first, **LLM-agnostic** (no provider lock-in).

## Layout

- [`docs/01-landscape.md`](docs/01-landscape.md) — what's already solved, build vs. reuse.
- [`docs/02-design.md`](docs/02-design.md) — architecture, the "one clock" sync principle,
  the Capture Bundle format, MVP scope, and decisions.
- [`sample-bundle/`](sample-bundle/) — a realistic example of what the extension will emit
  (a refund workflow), used to develop the analysis step against.
- [`analyze/`](analyze/) — `pack.py` turns a bundle into a portable, provider-neutral
  analysis pack any agent can consume. `validate_bundle.py` checks a bundle before
  analysis. Optional reference runners live in `analyze/adapters/` (e.g. Claude).
- [`extension/`](extension/) — the MV3 Chrome extension that produces real bundles
  (loadable scaffold). See [`extension/FIRST-CAPTURE.md`](extension/FIRST-CAPTURE.md).
- [`EXTRACT.md`](EXTRACT.md) — how to move this self-contained folder into another repo.

## Pipeline

```
[Chrome extension] ─► Capture Bundle ─► pack.py ─► analysis-pack/ ─► [ any agent / LLM ] ─► SOP.md
  (next to build)     (sample-bundle/)  (stdlib)   BRIEF + context              ▲           skills/<name>/SKILL.md
                                                    + frames + raw    Claude Code / chat LLM / automation.suggestions.md
                                                                      your own harness        notes.md
```

The bundle and the pack are the stable contract. Swap models, run it in several
harnesses, compare outputs — the recording underneath doesn't change.
