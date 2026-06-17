# Landscape: what's already solved

Before building anything, here's a survey of existing tools so we only build the
glue that's genuinely missing. The short version: **the hard parts (capture,
video, transcription, even auto-docs) are solved products. The missing piece is
the alignment + packaging layer that turns all of it into one AI-ready bundle.**

## The pipeline, broken into layers

| Layer | What it does | Best existing tool(s) | Build or reuse? |
|---|---|---|---|
| Rich event capture | DOM, mouse, clicks, scroll, keypress — timestamped JSON | **rrweb** (open source) | **Reuse** |
| Replayable action script | Records a flow → exports Puppeteer/Playwright/JSON | **Chrome DevTools Recorder** (built into Chrome) | **Reuse** |
| Network capture | URLs, methods, status, timing, bodies | **chrome.debugger / CDP → HAR** (standard format) | **Reuse (thin wrapper)** |
| Screen video | Polished recording + hosting | **Loom** (you have it) | **Reuse** |
| Transcript | Audio → timestamped text | **Loom transcript / Whisper / Granola** (you have these) | **Reuse** |
| Auto step-by-step docs | Clicks → annotated SOP w/ screenshots | **Scribe, Tango, Guidde, Trupeer** | Reuse *optionally* |
| **Alignment + packaging** | Merge all of the above on one timeline into a portable bundle | **— nothing does this for AI —** | **BUILD (this is us)** |
| AI synthesis | Bundle → skill / SOP / automation plan | Claude + a prompt/skill | Build (thin) |

## What each tool actually gives us

### rrweb — the capture engine (don't rebuild this)
- Open-source JS library; takes a full DOM snapshot then records every mutation,
  mouse move, click, scroll, and keypress as a compact, **timestamped JSON
  stream**. ~1–5 MB gzipped per 30 min (orders of magnitude smaller than video).
- It is the foundation under FullStory, PostHog, LogRocket, Microsoft Clarity,
  Hotjar — i.e. this problem is *thoroughly* solved.
- Network requests aren't in core yet (fetch/XHR plugin is on the roadmap; a
  console plugin already exists), so we add a thin network capture ourselves.
- Because output is plain JSON, we can store/repackage it however we want.

### Chrome DevTools Recorder — free automation output
- Built into Chrome since v92. Records a user flow and exports a
  **framework-agnostic JSON** plus Puppeteer / `@puppeteer/replay` / Playwright.
- This basically hands us the "turn it into automation" output for free — a
  replayable script of the exact flow.

### Scribe / Tango / Guidde / Trupeer — the auto-doc category already exists
- Browser extension → start capture → do the workflow → get an annotated,
  screenshot-by-screenshot SOP. Scribe alone has 5M+ users and a $1.3B valuation.
- **Why we still build:** these produce a *polished human help-article* and keep
  the raw signal locked in their cloud. They do **not** emit a portable,
  multimodal, **AI-ready** bundle (transcript + network + rich events + DOM), and
  they don't target *skills/automation* as an output — only human docs. We can
  use one of them as a bonus human-facing output, but they can't be the core.

### Loom / Whisper / Granola — you already own the video+transcript layer
- No need to build recording or ASR. We just need to **align** their timeline to
  our event stream (see the "one clock" principle in the design doc).

### Agent-trajectory research — confirms the value, no friendly tool exists
- The AI-agent world is desperate for exactly this data ("trajectories"):
  manually annotating it cost one project >$32k over 6 months. There's strong
  research interest in turning human demonstrations into structured action
  traces — but there is **no consumer/individual tool** that produces a clean
  bundle from your own browser. That's the opening.

## Conclusion

We are **not** building a recorder, a transcriber, or a video tool. We're
building a thin Chrome extension that wraps **rrweb + CDP network + tab
screenshots**, stamps everything against **one master clock**, and emits a single
**Capture Bundle**. A separate offline step feeds that bundle to Claude to
produce skills / SOPs / automation suggestions. Reuse everywhere; build only the
alignment + packaging glue.

## Sources

- rrweb — https://github.com/rrweb-io/rrweb · https://rrweb.com/
- rrweb plugins / network roadmap — https://github.com/rrweb-io/rrweb/issues/552 · https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/plugin.md
- Chrome DevTools Recorder — https://developer.chrome.com/docs/devtools/recorder/overview · https://developer.chrome.com/blog/extend-recorder
- Scribe — https://scribe.com/ · Tango — https://www.tango.ai/ · Guidde — https://www.guidde.com/ · Trupeer — https://www.trupeer.ai/
- Auto-doc-from-recording overview — https://www.howdoiuseai.com/blog/2026-02-07-7-ai-tools-that-create-sops-and-workflow-documenta
- Agent trajectory data cost/scarcity — https://arxiv.org/pdf/2505.13909 · https://arxiv.org/pdf/2510.04673
