# Analysis brief — Capture Bundle → asset package

You are analyzing a **Capture Bundle**: a multimodal, timestamped recording of
one person performing one task in their web browser. Your job is to turn it into
a small package of reviewable assets. This brief is provider-neutral — any agent
or LLM can follow it.

## What you're given (in `context.md`, plus raw files in `bundle/`)

All aligned on one millisecond clock (`t`):

- **Task** — a one-line goal the user stated at the start (top of `context.md`), when
  present. This is the strongest signal of intent; let it frame everything.
- **Steps (narrated procedure)** — the recording auto-segmented into steps, each with
  the narration spoken during it bound to it. Read this first: it's the draft of your
  SOP. The raw timeline below it has the full detail.
- **Tabs** — if the capture spans multiple tabs, a legend (`#1`, `#2`, …) and
  `━━━ tab #N ━━━` markers in the timeline show when the user moved between them.
- **timeline** — the merged event stream (`nav`, `speech`, `click`, `input`, `key`,
  `network`). Actions are described semantically — `click button "Issue refund" in
  "Order actions"` — with the unique CSS selector in `[...]` for replay.
- **transcript** — the person narrating what they're doing and why.
- **network** — the HTTP requests their actions triggered (HAR). Analytics/ad/tracking
  noise is collapsed in `context.md`; the full HAR is in `bundle/`.
- **frames** — screenshots at key moments (in `frames/`, filename = ms offset). Each
  click in the steps view links to its frame (`→ frames/x.png @(x%,y%)`). Open
  **`frames-annotated.html`** to see the click point and target element drawn on each
  screenshot.

Sensitive values are already redacted (shown as `‹redacted›`). Never invent the
underlying secret, and never suggest bypassing redaction.

## What to produce

**If `context.md` opens with a "Purpose of this recording" block, that governs.** Read
the capture through the lenses it names and produce the outputs it lists (always add
`notes.md`). The descriptions below define those outputs. If there's no purpose block
(older bundles), produce the full set.

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

5. **`feedback.md`** (UX purpose) — observed friction as a ranked list: each item with a
   severity, what happened (hesitation, backtrack, dead-end, confusing label, error/empty
   state, slow step), and the `timestamp` + frame where it occurred. Ground every item in
   the recording; don't invent problems.

6b. **`ui-changes.md`** (propose-UI-changes purpose) — concrete UI changes grounded in
   the captured element (selector + accessible name) and the frame, ranked by impact;
   when the app's source is available, the applied changes too. Follow the bundled
   `agent-skills/ui-improvement` skill for the format and method.

6. **`improvements.md`** (better/faster purpose) — concrete ways to do the task in less
   time or fewer steps, ranked by estimated time saved: redundant/manual steps, repeated
   navigation, things doable via an observed API instead of the UI, batchable rekeying.
   Cite the steps/endpoints each suggestion is based on.

7. **`research.md`** (competitive-research purpose) — a teardown of the other product:
   product & flow, UX patterns to learn from (with frame refs), architecture & data model
   inferred from the network (with endpoint cites), what they do well, gaps to
   differentiate on, and a "for your version" takeaways list. Learn patterns/principles,
   never copy proprietary assets. Follow the bundled `agent-skills/competitive-research`
   skill.

## Ground rules

- Ground every claim in the bundle. Prefer `(inferred)` over confident invention.
- The output is a starting point a human will review — not a finished,
  auto-published artifact.
