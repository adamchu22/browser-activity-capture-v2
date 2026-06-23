// Self-driving documentation embedded in every exported Capture Bundle.
//
// The goal (P0): a bundle zip must work when handed to ANY agent for another
// process, with no access to our analyze/ pipeline and nobody from this project in
// the loop. So every export carries:
//   - README.md    — what the bundle is + a file list
//   - CLAUDE.md     — full analysis instructions, addressed to Claude agents
//   - AGENTS.md     — the same instructions, AGENTS.md convention, for any agent
//   - agent-skills/documentation/SKILL.md — how to produce illustrated documentation
//     (screenshots + highlights) from the bundle; included in every zip
//
// CLAUDE.md and AGENTS.md share one body (agentGuideBody) so they never drift. Keep
// this in sync with analyze/skills/analyze-capture/SKILL.md and analyze/BRIEF.md —
// those are the pack-path equivalents of the same procedure. documentationSkill() below
// mirrors analyze/skills/documentation/SKILL.md — keep the two in sync.
//
// Pure functions of the manifest object; no chrome / DOM deps, so they unit-test in
// plain node (see tests/test_bundle_docs.mjs).

// Why the user recorded — the reading LENS and the deliverable. Mirrors the PURPOSES
// map in analyze/pack.py; keys match the popup checkboxes.
export const PURPOSES = {
  skill: { label: "Build a skill / automation", read: "Focus on replayable mechanics — exact selectors, URLs, API endpoints, required inputs, and the success signal (confirming response or redirect). Flag what's safe to automate vs. must stay human-in-the-loop.", make: "`SKILL.md` (a reusable skill) + `automation-suggestions.md`" },
  docs: { label: "Documentation / SOP", read: "Focus on a clear human-followable procedure — preconditions, the happy path, decision points and eligibility checks the narrator mentioned, and the why behind each step.", make: "one illustrated doc (`documentation.md` or `SOP.md`) with screenshots embedded from `frames/` — follow `agent-skills/documentation/SKILL.md`" },
  ux: { label: "UX / product feedback", read: "Focus on friction — hesitation and long pauses, backtracking, dead-ends, repeated attempts, confusing labels, error/empty states, slow steps. Cite the frame and timestamp for each.", make: "`feedback.md` — issues with severity and where they occurred" },
  ui: { label: "Propose UI changes", read: "Find friction (as for UX feedback), then prescribe concrete UI changes grounded in the captured element (selector + accessible name) and the frame.", make: "`ui-changes.md` — proposed changes ranked by impact" },
  improve: { label: "Find a better / faster way", read: "Focus on inefficiency — redundant or manual steps, repeated navigation, things doable in fewer clicks or via an API instead of the UI, rekeying that could be batched.", make: "`improvements.md` — concrete suggestions ranked by time saved" },
  research: { label: "Competitive / product research", read: "This is another product worth learning from. Extract how it works — UX patterns from the frames, the flow from the timeline, and the architecture / data model from the network (HAR). Learn patterns and principles, never copy proprietary assets.", make: "`research.md` — a competitive teardown with takeaways for your own version" },
  general: { label: "General capture", read: "No single lens — capture the full picture.", make: "`notes.md` only by default — do NOT auto-generate SOP/skill/suggestions; then ask the user which other outputs they want" },
};

export function renderPurpose(purposes) {
  const keys = (purposes || []).filter((p) => PURPOSES[p]);
  if (!keys.length) {
    return "No purpose was selected at capture time. Default to `notes.md` only and ask the user which other outputs they want — see **What to produce** below.\n";
  }
  let out = "The user recorded this specifically to do the following — read the capture through these lenses and produce these outputs (always add `notes.md`):\n\n";
  for (const k of keys) {
    const p = PURPOSES[k];
    out += `- **${p.label}** — ${p.read} → produce ${p.make}.\n`;
  }
  return out;
}

export function bundleReadme(m) {
  return `# Capture Bundle — ${m.capture_id}

Portable recording of one browser task, aligned on one clock (ms since t0).

**This bundle is self-driving.** Hand the whole folder to any agent and point it at
**CLAUDE.md** (Claude agents) or **AGENTS.md** (any agent) — those carry the full
instructions for reading it and what to produce. No external pipeline is required.
(Optional convenience: ../analyze/pack.py pre-flattens a bundle into a single context.md.)

- CLAUDE.md / AGENTS.md — how to analyze this bundle (read these first)
- agent-skills/documentation/SKILL.md — how to produce illustrated docs (screenshots + highlights)
- manifest.json — metadata, redaction policy, frame index
- timeline.json — merged event stream (nav/speech/click/input/key/network)
- events.jsonl — raw rrweb DOM stream
- network.har  — HTTP requests (auth/cookies redacted)
- transcript.vtt — narration (a stub if none was transcribed; recover it from video.webm — see CLAUDE.md/AGENTS.md)
- frames/ — screenshots at key moments
${m.video ? `- video.webm — screen recording${m.narration_in_video ? " (includes microphone narration, aligned to t0)" : " (no microphone narration)"}\n` : ""}`;
}

// The shared body — identical guidance regardless of which agent reads it.
export function agentGuideBody(m) {
  const task = m.task ? `"${m.task}"` : "(none stated — infer it from the narration + actions)";
  const narr = m.narration_in_video
    ? "video.webm contains the microphone narration on the same clock."
    : `no microphone narration was captured${m.narration_error ? ` (reason: ${m.narration_error})` : ""}.`;
  return `You've been handed a **Capture Bundle**: a multimodal, timestamped recording of one
person doing one task in their web browser, aligned on a single millisecond clock.
**This file is the whole instruction set — the bundle is self-driving.** You do not need
any external tool or pipeline to use it.

## The clock
Every \`t\` in every file is **milliseconds since t0**. \`t0_wall\` in manifest.json is the
wall-clock start. All streams (events, narration, frames, video) share this clock.

## Files
- **manifest.json** — metadata: the stated \`task\`, the \`purposes\` (your lens), the \`tabs\`
  legend (map each event's \`tab\` id to its page), \`redaction\` policy, \`frames\` index, counts.
- **timeline.json** — the merged event stream and the spine of the recording: \`nav\`,
  \`speech\`, \`click\`, \`input\`, \`key\`, \`network\`, each tagged with a \`tab\` id. Clicks/inputs
  carry a unique CSS \`selector\` (for replay), a semantic \`label\`, and \`ctx\` (accessible
  name / role / section) — so an action reads as \`click button "Issue refund" in "Order actions"\`.
- **transcript.vtt** — the narration (what was said, and why). May be a stub — see below.
- **events.jsonl** — the raw rrweb DOM stream (full DOM + mutations) for deep replay. Heavy; optional.
- **network.har** — HTTP the actions triggered (auth headers + cookies already redacted).
- **frames/** — screenshots at key moments; filename = ms offset (e.g. \`frames/0000012345.png\`).
- **video.webm** — the full screen recording${m.video ? "" : " (NOT present in this bundle)"}, narration mixed in on the same clock.

## If transcript.vtt is a stub — recover the narration (do this; don't skip it)
For this recording, ${narr}
A stub looks like \`NOTE No narration captured\`. The words are **not lost** — when
narration was recorded they live as an **Opus audio track inside video.webm**, aligned to t0.
Recover them yourself, no external help needed:
1. Extract audio: \`ffmpeg -i video.webm -ac 1 -ar 16000 audio.wav\`
2. Transcribe locally. **Default to Parakeet** (Parakeet-TDT via mlx-audio on Apple Silicon) —
   it was the most accurate engine for this audio, so prefer it. If \`mlx-audio\` isn't
   installed yet, set up a throwaway env first (the model weights download on first run, or
   load from the local Hugging Face cache if already present — no path needed, just the repo id):
   \`uv venv .venv-asr && uv pip install --python .venv-asr mlx-audio\`
   then transcribe (\`--output-path\` is REQUIRED — without it the command errors):
   \`.venv-asr/bin/python -m mlx_audio.stt.generate --model mlx-community/parakeet-tdt-0.6b-v3 --audio audio.wav --output-path transcript --format vtt\`
   (writes \`transcript.vtt\`). Only fall back to Whisper if Parakeet isn't available: \`whisper audio.wav --model small.en --output_format vtt\`.
3. The audio starts within ~1s of t0 — treat the cue times as t0-aligned.
Then use the transcript as the user's account of intent.

## Read it in this order
1. **Purpose & task** — manifest.json. Task: ${task}. See **Purpose of this recording** below for the lens.
2. **Narration** — transcript.vtt (or the audio you just recovered): intent, decision points, the rules they follow.
3. **Timeline** — timeline.json: the actions that carried out the task, described semantically, with selectors for replay.
4. **Visual ground truth** — frames/ and video.webm: resolve any "what did they actually click/see" ambiguity.
5. **Mechanics** — network.har: exact endpoints, request bodies, and the success signal (confirming response/redirect).

## Purpose of this recording
${renderPurpose(m.purposes)}
## What to produce
- If a **specific purpose** is named above (skill / docs / ux / ui / improve / research), produce that purpose's deliverable, plus \`notes.md\`.
- If the purpose is **General capture** (or none was set), **produce only \`notes.md\` by default — do NOT auto-generate SOP, a skill, or suggestions.** Then **ask the user which other outputs they want** before generating anything else.

The outputs you can offer (write them into this bundle's folder):
- **notes.md** — a one-paragraph summary, then an \`Open questions\` list (ambiguities, gaps, off-screen steps). Always produce this.
- **SOP.md** — a numbered procedure a new teammate could follow. Narration for *intent* ("why"), events/network for *mechanics* ("what"). Mark inferences \`(inferred)\`.
- **documentation.md** — for the **docs** purpose: one illustrated how-it-works doc or SOP with screenshots embedded from \`frames/\` and the user's on-screen highlights. Follow \`agent-skills/documentation/SKILL.md\` (it also explains the optional Notion-import packaging — don't do that by default).
- **SKILL.md** — a reusable skill: YAML front-matter (\`name\`, one-line \`description\`), trigger, ordered steps, the real selectors/URLs/API endpoints, required inputs, and the success signal.
- **automation-suggestions.md** — what's safe to fully automate, what must stay human-in-the-loop (and why), and the single highest-leverage automation. Reference observed API endpoints.
- **feedback.md** / **ui-changes.md** / **improvements.md** / **research.md** — per the purpose lens above.

## Ground rules
- One clock: every \`t\` is ms since t0.
- Secrets are already redacted (shown as \`‹redacted›\`) in the structured streams (timeline, network.har, the DOM stream, URLs). Never invent the underlying value, and never suggest bypassing redaction. NOTE: \`video.webm\` and \`frames/*.png\` are NOT pixel-redacted — a secret visible on screen during recording is visible there. Don't surface or transcribe an on-screen secret you happen to see in the video/frames.
- Ground every claim in the bundle; prefer \`(inferred)\` over confident invention.
- Your output is a starting point a human will review — be honest about gaps.`;
}

// The documentation skill, shipped in every zip at agent-skills/documentation/SKILL.md.
// Mirrors analyze/skills/documentation/SKILL.md (the pack-path copy) — keep the two in
// sync. It teaches an agent to turn this bundle into an illustrated doc (screenshots +
// the user's highlights), and explains the optional Notion-import packaging without
// making it the default.
export function documentationSkill() {
  return `---
name: documentation
description: Turn a Browser Activity Capture into illustrated documentation — a single how-it-works doc or SOP with embedded screenshots and the user's on-screen highlights. Use when the capture's purpose is "docs", or when asked to document a tool/process from a recording. Optionally package the result for Notion import.
---

# Document a tool or process from a capture

You're turning one recording into documentation a human can follow: an internal
"how it works" doc or an SOP, **with screenshots**. The narration is the *why*, the
timeline is the *what*, and the frames are the visual ground truth. Use all three.

## What to produce (default)

**One** Markdown document — \`documentation.md\` (or \`SOP.md\` for a strict procedure) —
plus an \`images/\` folder of screenshots referenced inline. One doc, not many. **Do NOT
build a Notion zip by default** — that's an optional packaging step (last section).

The document should contain:

- A title and a one–two sentence summary callout.
- A **properties block** near the top: a small table of key facts (product, owner,
  status, app URL, hosting/stack, last updated, source). These map onto Notion page
  properties later.
- Sections that follow the **actual flow** of the recording (see read order). Use
  headings, tables (endpoints, assets), checkboxes for future work, and \`> emoji\`
  callouts for warnings and notes.
- **Screenshots at each meaningful step** (see below) — this is the point of the skill.
- An **Open questions** section for anything not stated. Don't invent.

## Read it in this order (one clock — every \`t\` is ms since t0)

1. **Purpose & task** — \`manifest.json\`. This is your lens.
2. **Narration** — \`transcript.vtt\`. The user's own account of intent, decisions, and
   rules. If the transcript is a stub, recover it from \`video.webm\` first (see CLAUDE.md /
   AGENTS.md in this bundle).
3. **Timeline** — \`timeline.json\`: the actions, described semantically with selectors and
   accessible names.
4. **Visual ground truth** — \`frames/\` and \`video.webm\`.

## Screenshots — include them

1. **Pick the moments.** Walk the timeline and choose one shot per section: page loads
   (\`nav\` events), each distinct screen/state, decision points, and anything the narrator
   pointed at.
2. **Find the nearest frame.** Frame filenames are ms offsets (\`frames/0000012345.png\`).
   For each moment pick the frame file with the closest \`t\` — a second or two **after** a
   \`nav\`, so the page has rendered. Spot-check it; avoid mid-transition frames.
3. **Crop the capture overlay out.** Frames include the recorder's red border and the
   control pill at the bottom. Crop ~8px off the edges and ~70px off the bottom, e.g.:
   \`ffmpeg -i in.png -vf "crop=iw-16:ih-78:8:8" out.png\`.
4. **Save and embed.** Put them in \`images/\` with ordered, descriptive names
   (\`01-scanner-home.png\`) and embed inline: \`![caption](images/01-scanner-home.png)\`.
5. **Highlights.** The capture records the user's own annotations — \`annotation:select\`
   (an element they marked) and \`annotation:draw\` (a freeform circle) — in
   \`timeline.json\`. Use them to call out the exact element a step refers to, or describe
   the element by its accessible name. Caveat: if the user was in Select/Draw mode, some
   frames carry a stray highlight box or a "click an element to mark it" tooltip — prefer a
   clean frame unless the highlight adds clarity.

## Ground rules

- **Frames and video are NOT pixel-redacted.** They show whatever was on screen —
  including real names, emails, and phone numbers. Expected for internal docs, but add a
  callout flagging the page contains real data, and never transcribe an on-screen secret.
- Ground every claim in the capture; mark inferences \`(inferred)\`. Quote spoken
  model/tool/version names **as said**, and list exact versions under Open questions rather
  than guessing.
- Respect any "don't include this part" aside in the narration.

## Optional: package for Notion import (only if the user asks)

Don't do this by default. When the user wants it in Notion:

- **Pasting Markdown text into Notion will NOT carry local images** — paste only fetches
  images from public URLs. To keep screenshots private, use Notion's
  **Import → Markdown & CSV** with a zip instead of pasting.
- **Make it import as exactly one page:** put the single \`.md\` at the **root of the zip**
  with the \`images/\` folder beside it. Do **not** nest them inside a wrapper subfolder — a
  wrapper folder makes Notion create an extra parent page. Keep image links relative
  (\`images/...\`).
- **Never upload the screenshots to a public host** to make paste work — they contain
  internal data.
`;
}

export function bundleClaudeMd(m) {
  return `# Analyze this Capture Bundle (for Claude)

This is the same guidance as AGENTS.md, addressed to you, Claude. Read this whole file,
then analyze the bundle in this folder and write your outputs here.

${agentGuideBody(m)}
`;
}

export function bundleAgentsMd(m) {
  return `# AGENTS.md — analyze this Capture Bundle

Instructions for any agent handed this bundle (AGENTS.md convention). The CLAUDE.md
beside this file carries the same guidance for Claude agents.

${agentGuideBody(m)}
`;
}
