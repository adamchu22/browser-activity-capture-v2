---
name: analyze-capture
description: Read a Browser Activity Capture analysis pack and produce the outputs its Purpose block asks for. Use whenever you're handed a capture pack (a folder/zip with context.md, frames/, and bundle/), or asked to turn a browser recording into a skill, SOP, UX feedback, or UI changes.
---

# Analyze a Capture Bundle

You've been given an **analysis pack**: a multimodal, timestamped recording of one
person doing one task in their browser, flattened into `context.md` (+ `frames/`,
`frames-annotated.html`, and raw files in `bundle/`). Your job is to understand what
happened and why, then produce the deliverables the recording was made for.

## Read it in this order — do not skip ahead

1. **Purpose** — the `## Purpose of this recording` block at the top of `context.md`.
   This is the lens. It names what to produce and how to read. **Everything you output
   is governed by it.** If it's absent (older bundle), follow `BRIEF.md`'s full menu.
2. **Task** — the one-line goal the user stated (the callout at the very top). The
   *what*.
3. **Narration** — the `🗣` lines in the Steps section and the full transcript. This is
   the user's own account of *why* — their intent, decision points, and the rules they
   follow ("always start from the order, never the customer"). Trust it for intent.
4. **Steps (narrated procedure)** — the auto-segmented procedure. This is your draft.
   Each step pairs the narration with the actions that carried it out.
5. **Visual ground truth** — open `frames-annotated.html` to see exactly what was
   clicked (a ring on the click point, a box on the element). Use it to resolve any
   "what did they actually click" ambiguity. Each click in the steps links its frame.
6. **Mechanics** — the raw `## Timeline` and `## Network` for exact selectors, URLs,
   API endpoints, request bodies, and the success signal (the confirming response or
   redirect). Use these for anything that must be reproducible.

## Then: identify, analyze, produce

- **Identify what's happening.** In 2–3 sentences, state the workflow, the actor, the
  system(s) involved, and where it starts/ends. Ground it in the capture.
- **Analyze under the purpose's lens.** Read every step asking the question the purpose
  implies (reproducibility? friction? inefficiency? a UI change?).
- **Produce exactly the outputs the Purpose block lists**, plus `notes.md`. Write them
  into the pack directory. Their shapes are defined in `BRIEF.md`.

## Use the bundled activity skills

If this pack ships other skills in `agent-skills/` (e.g. `ui-improvement`), they teach
the method for that purpose — read and follow them. They were included because the
recording's purpose calls for them.

## Ground rules

- Ground every claim in the bundle. Mark anything you inferred `(inferred)`.
- Secrets are already redacted (`‹redacted›`). Never invent the underlying value or
  suggest bypassing redaction.
- The output is a starting point a human will review — be honest about gaps and list
  open questions in `notes.md`.
