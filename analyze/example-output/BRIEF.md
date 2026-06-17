# Analysis brief — Capture Bundle → asset package

You are analyzing a **Capture Bundle**: a multimodal, timestamped recording of
one person performing one task in their web browser. Your job is to turn it into
a small package of reviewable assets. This brief is provider-neutral — any agent
or LLM can follow it.

## What you're given (in `context.md`, plus raw files in `bundle/`)

All aligned on one millisecond clock (`t`):

- **timeline** — the merged event stream (`nav`, `speech`, `click`, `input`, `key`, `network`)
- **transcript** — the person narrating what they're doing and why
- **network** — the HTTP requests their actions triggered (HAR)
- **frames** — screenshots at key moments (in `frames/`, filename = ms offset)

Sensitive values are already redacted (shown as `‹redacted›`). Never invent the
underlying secret, and never suggest bypassing redaction.

## What to produce

Write these files into the pack directory:

1. **`SOP.md`** — a numbered standard operating procedure a new teammate could
   follow. Capture preconditions, the happy path, and any decision points or
   eligibility checks the narrator mentioned. Use the narration for *intent*
   ("why") and the events/network for *mechanics* ("what"). Mark anything you
   inferred rather than observed with `(inferred)`.

2. **`skills/<name>/SKILL.md`** — a skill that would let an agent reproduce this
   workflow. `<name>` is a short kebab-case id. Start the file with YAML
   front-matter (`name`, `description` — one line on when to use it), then the
   trigger, the ordered steps, the key selectors/URLs/API endpoints observed,
   required inputs, and the success signal (e.g. the confirming network response
   or redirect). Be concrete — cite the real selectors, URLs, and endpoints.

3. **`automation.suggestions.md`** — for this workflow, call out (a) steps safe to
   fully automate, (b) steps that should stay human-in-the-loop and why
   (judgment, eligibility, irreversibility), and (c) the single highest-leverage
   automation. Reference the observed API endpoints where a step could be done
   via API instead of the UI.

4. **`notes.md`** — a one-paragraph summary, then an `Open questions` list: things
   a human should confirm before relying on these assets (ambiguities, gaps,
   steps that happened off-screen).

## Ground rules

- Ground every claim in the bundle. Prefer `(inferred)` over confident invention.
- The output is a starting point a human will review — not a finished,
  auto-published artifact.
