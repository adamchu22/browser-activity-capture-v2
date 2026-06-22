---
name: documentation
description: Turn a Browser Activity Capture into illustrated documentation — a single how-it-works doc or SOP with embedded screenshots and the user's on-screen highlights. Use when the capture's purpose is "docs", or when asked to document a tool/process from a recording. Optionally package the result for Notion import.
---

# Document a tool or process from a capture

You're turning one recording into documentation a human can follow: an internal
"how it works" doc or an SOP, **with screenshots**. The recording carries everything you
need — the narration is the *why*, the timeline is the *what*, and the frames are the
visual ground truth. Use all three.

## What to produce (default)

**One** Markdown document — `documentation.md` (or `SOP.md` for a strict procedure) —
plus an `images/` folder of screenshots referenced inline. One doc, not many. **Do NOT
build a Notion zip by default** — that's an optional packaging step (last section).

The document should contain:

- A title and a one–two sentence summary callout.
- A **properties block** near the top: a small table of key facts (product, owner,
  status, app URL, hosting/stack, last updated, source). These map cleanly onto Notion
  page properties later.
- Sections that follow the **actual flow** of the recording (see read order). Use
  headings, tables (endpoints, assets), checkboxes for future work, and `> emoji`
  blockquote callouts for warnings and notes.
- **Screenshots at each meaningful step** (see below) — this is the point of the skill.
- An **Open questions** section for anything not stated. Leave gaps explicit; don't
  invent.

## Read it in this order (one clock — every `t` is ms since t0)

1. **Purpose & task** — the purpose block / `manifest.json`. This is your lens.
2. **Narration** — `transcript.vtt` (in a pack, the `🗣` lines in Steps). The user's own
   account of intent, decisions, and rules. If the transcript is a stub, recover it from
   `video.webm` first (see the bundle's CLAUDE.md / AGENTS.md).
3. **Timeline / Steps** — `timeline.json` (in a pack, the `## Steps` + `## API calls`):
   the actions, described semantically with selectors and accessible names.
4. **Visual ground truth** — `frames/` and `video.webm` (in a pack, also
   `frames-annotated.html`): what was actually on screen.

## Screenshots — include them

1. **Pick the moments.** Walk the timeline and choose one shot per section: page loads
   (`nav` events), each distinct screen/state, decision points, and anything the narrator
   pointed at.
2. **Find the nearest frame.** Frame filenames are ms offsets (`frames/0000012345.png`).
   For each moment, pick the frame file with the closest `t` — a second or two **after** a
   `nav`, so the page has rendered (avoid mid-transition frames; spot-check by opening it).
3. **Crop the capture overlay out.** Frames include the recorder's red border and the
   control pill at the bottom. Crop ~8px off the edges and ~70px off the bottom, e.g.:
   `ffmpeg -i in.png -vf "crop=iw-16:ih-78:8:8" out.png`.
4. **Save and embed.** Put them in `images/` with ordered, descriptive names
   (`01-scanner-home.png`) and embed inline: `![caption](images/01-scanner-home.png)`.
5. **Highlights.** The capture records the user's own annotations — `annotation:select`
   (an element they marked) and `annotation:draw` (a freeform circle) — in the timeline,
   drawn onto `frames-annotated.html` in a pack. Use an annotated frame when a step needs
   the exact element called out; otherwise describe the element by its accessible name.
   Caveat: if the user was in Select/Draw mode, some frames carry a stray highlight box or
   a "click an element to mark it" tooltip — prefer a clean frame unless the highlight adds
   clarity.

## Ground rules

- **Frames and video are NOT pixel-redacted.** They show whatever was on screen —
  including real names, emails, and phone numbers. That's expected for internal docs, but
  add a callout flagging the page contains real data, and never transcribe an on-screen
  secret you happen to see.
- Ground every claim in the capture; mark inferences `(inferred)`. Quote spoken
  model/tool/version names **as said**, and list exact versions under Open questions rather
  than guessing.
- Respect any "don't include this part" aside in the narration.
- Secrets in the structured streams are already `‹redacted›` — never invent the value.

## Optional: package for Notion import (only if the user asks)

Don't do this by default. When the user wants it in Notion:

- **Pasting Markdown text into Notion will NOT carry local images** — paste only fetches
  images from public URLs. To keep the screenshots private, use Notion's
  **Import → Markdown & CSV** with a zip instead of pasting.
- **Make it import as exactly one page:** put the single `.md` at the **root of the zip**
  with the `images/` folder beside it. Do **not** nest them inside a wrapper subfolder — a
  wrapper folder makes Notion create an extra parent page. Keep image links relative
  (`images/...`).
- **Never upload the screenshots to a public host** to make paste work — they contain
  internal data.
