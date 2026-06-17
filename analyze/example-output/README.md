# Analysis pack — sample-bundle

Hand this whole folder to any agent or LLM. There is no provider lock-in here.

- **Coding agent (Claude Code, etc.):** point it at this directory and tell it to
  follow `BRIEF.md`. It will read `context.md` + `frames/` and write `SOP.md`,
  `skills/<name>/SKILL.md`, `automation.suggestions.md`, and `notes.md` here.
- **Any chat LLM:** paste `BRIEF.md` then `context.md`. Attach the `frames/`
  images if the model supports vision.
- **Your own harness:** see `../adapters/` for optional reference runners.

Everything the agent needs is self-contained: `BRIEF.md` (the task),
`context.md` (the flattened recording), `frames/` (screenshots), `bundle/` (raw
structured files).
