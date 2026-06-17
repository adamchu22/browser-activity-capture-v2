# Learnings — v2

Dated findings specific to v2. v1's learnings (MV3 gotchas, redaction, ASR, the
unique-selector algorithm, etc.) live in the v1 repo and still apply — v2 inherits
that code unchanged.

## 2026-06-17 (SCOPE CHANGE — capture only tabs the user enters, not every open tab)

A clean live run revealed v2's "all-tabs instrumentation" captured **every open tab**, not
just the ones used. A 3-tab task produced a 16-tab bundle: URLs+titles of all open tabs
(incl. a **1Password signin** and **Telegram**) plus background network from Calendar/Notion/
Hermes. That's a privacy problem — bundles get handed to other agents.

- **Decision (Adam):** instrument only the tab recording starts in, then lazily instrument
  each tab **as the user focuses it** (`tabs.onActivated`). Tabs never entered are left
  completely alone.
- **Why it doesn't weaken capture:** the content script reads the **live DOM in place** at
  click/hover time and rrweb snapshots on entry — no reload, no heavy fetch. Selectors,
  semantic context, and rrweb all work identically from the moment you enter a tab. The only
  thing given up is pre-focus activity in a tab (e.g. background network before you looked at
  it) — exactly what "record what I'm doing" should drop.
- **How:** `start()` instruments only the active tab (was `chrome.tabs.query({})` over all).
  `tabs.onActivated` → `instrumentTab` (idempotent). `is-recording` (content→worker) now
  answers **per tab** (`state.recording && tabIds.has(senderTabId)`), so a never-entered tab's
  manifest-injected content script stays inert — no DOM snapshot of a password-manager page.
  `nav-policy.js` updated: only reattach tracked tabs; instrument only the *active* untracked
  tab on load (covers the recording tab leaving a chrome:// page). The cross-tab use case is
  intact — switching into a tab instruments it.

## 2026-06-17 (CAPTURE BUG — content script dies on navigation; only network survives)

**The most serious capture bug found so far.** A real session
(`distru-freemium/feedback-sessions/capture-…16-12-14-616Z`) ran 6 min but clicks, hovers,
rrweb DOM, and frames all stopped at **1:43** — while network kept recording to 5:53. The
bundle still "validated" (video present, 0 errors, 659 events) because the events were almost
all network. ~4.5 min of the most important part (error states, the `/fixes?filter=…` views)
had no DOM capture and no frames.

- **Root cause.** The app is server-rendered: every click is a full-page `text/html`
  navigation. A navigation destroys the content script — but the **CDP debugger stays attached
  to the tab**, so network keeps flowing while the page-side capture is gone. Re-attachment
  depended entirely on the fresh content script's single fire-and-forget `is-recording` check,
  with no retry and no worker-side re-push; `instrumentTab()` even early-returns for an
  already-tracked tab, so the worker never re-armed it. One lost message = capture dead for the
  rest of that tab's life, silently (errors.json empty).
- **Why it hid:** SPAs don't trigger it (the content script isn't torn down on pushState), and
  the dev-time test pages were SPA-ish. Server-rendered apps — which is most of Distru's own
  tooling — trigger it on the very first click.
- **Fix.** (A) The worker now re-arms the content script on EVERY navigation: `tabs.onUpdated`
  with `status==="complete"` (or an in-place `changeInfo.url`) on a tracked tab →
  `reattachTab()` → `ensureContentScript` + re-send `start`. The debugger is left attached
  (it survived). Gating is a pure, unit-tested module (`nav-policy.js`, `navActions()`).
  (B) The content script's self-attach now retries on transient failure instead of
  fire-and-forget. Both together = belt and suspenders; `startCapture` is idempotent so whoever
  wins first is fine.
- **Frames were also coupled to DOM events** (`captureFrame` only ran on click/nav/hover), so
  when the content script died, frames died too. Added a **3s periodic frame timer** in the
  worker (`startFrameTimer`/`stopFrameTimer`, wired to start/pause/resume/restart/stop/cancel),
  decoupled from events. Kept PNG — `validate_bundle.py` only counts `frames/*.png`. Dropped
  the per-hover frame (timer covers it; avoids Chrome's ~2/sec captureVisibleTab quota).
- **`network.har` has no response bodies** — only method/url/status/headers/mimeType. The
  worker never calls `Network.getResponseBody`. So you cannot recover rendered HTML / error
  text from the HAR; the late error states live only in `video.webm`. (Capturing bodies is a
  separate task — needs response-body redaction, which we don't do yet. Flagged in to-do P4c.)
- **New diagnostic:** `analyze/check_coverage.py` flags this signature on any bundle (per-tab:
  network continuing >45s past the last content-script event). It FAILs the original bad bundle
  and is the one-command sign-off for the fix on a fresh recording. Unit-tested
  (`tests/test_check_coverage.py`).

## 2026-06-17 (P1 — on-screen overlay; two non-obvious gotchas)

Built the injected recording overlay (Finish/Pause/Restart/Cancel), worker-synced across
tabs. Two things that aren't obvious and would bite a re-implementation:

- **Restart must re-init rrweb, not just clear the buffers.** `rrweb.record()` emits a full
  DOM snapshot *once* at start, then only incremental mutations. So wiping `events.jsonl`
  mid-stream (what Restart does) leaves the new take with mutations but no base snapshot —
  unreplayable. Fix: on Restart the worker sends each tab a `restart` message; `content.js`
  stops and re-starts rrweb so a fresh full snapshot lands against the new t0. (Reset t0 in
  the worker *before* messaging tabs, so the snapshot stamps correctly.)
- **Restart reuses the live getDisplayMedia tracks — don't release them.** To restart the
  video without a second "Choose what to share" prompt, `offscreen.js` keeps the screen+mic
  tracks live (`activeTracks`) and just swaps in a new `MediaRecorder`. Clearing the old
  recorder's `onstop` first prevents the discarded take from shipping bytes back as a finished
  video. Cancel is the opposite: stop recorder, `releaseStreams()`, send nothing back.
- **Overlay sync model:** the worker is the source of truth. `broadcastOverlay()` pushes
  `{recording, paused, t0}` to every instrumented tab so the pill is correct regardless of
  focus; pause/resume route through the worker (which also pauses the MediaRecorder), not just
  a local popup flag. The overlay is shadow-DOM isolated and styled deliberately unlike
  Chrome's "is debugging this browser" bar (whose Cancel detaches the debugger).
- Also patched the embedded audio-recovery docs (`bundle-docs.js`): they now tell the agent to
  `uv pip install mlx-audio` first — Parakeet *weights* are cached locally
  (`~/.cache/huggingface/hub/models--mlx-community--parakeet-tdt-0.6b-v3`) but the *runner*
  isn't installed by default.

## 2026-06-17 (P0 — the raw zip was NOT self-driving; the audio never reached the pack)

Reviewing the entire-screen run revealed the handoff story was weaker than assumed:

- **The raw `capture-*.zip` was not self-driving.** Its `README.md` was a one-line file
  list that told the recipient to "hand it to ../analyze/pack.py" — a path a recipient
  who only has the zip doesn't have. The actual self-driving layer (the `analyze-capture`
  skill + `BRIEF.md`) was only ever produced by `pack.py` *into the pack*, never in the zip.
- **Narration could silently vanish.** Transcription never auto-ran (the extension can't
  run a Python ASR; it writes a stub `transcript.vtt` and embeds the audio as an Opus
  track in `video.webm`). And `pack.py`'s `RAW_FILES` does **not** copy `video.webm` into
  the pack — so packing a stub-transcript bundle dropped *both* the transcript text and the
  audio to recover it. A handed-off recording could lose its narration entirely.
- **Fix (P0): make the zip carry its own brain.** Every export now embeds `CLAUDE.md` +
  `AGENTS.md` (generated by `extension/src/bundle-docs.js`, shared `agentGuideBody` so they
  can't drift). They state the one-clock model, the file map, the analysis procedure (ported
  from analyze-capture + BRIEF, with the purpose lens), and — the core fix — that if
  `transcript.vtt` is a stub the narration is an Opus track in `video.webm`, recoverable with
  `ffmpeg` + any local ASR. Locked by `tests/test_bundle_docs.mjs` (13 tests). Decision:
  **embed** the procedure, don't ship separate skill files — the zip stays one self-contained folder.
- Note: `bundle-docs.js` mirrors the `PURPOSES` map and BRIEF output spec from `analyze/`.
  If you change the purposes or deliverables in `analyze/pack.py` / `BRIEF.md`, update
  `bundle-docs.js` too — they're intentionally duplicated for self-containment.

## 2026-06-17 (first v2 live test — picker fails, multi-tab works, URL leak)

First real-Chrome run of v2 (Adam's machine; bundle `outputs/v2-test-1-switching-pages.zip`,
3 tabs, ~5.5 min, 1391 events). Three findings:

- **For MV3 whole-screen recording, use `getDisplayMedia()` inside the offscreen
  document — NOT `desktopCapture` + a streamId.** Our original path (worker mints a
  `chooseDesktopMedia` streamId → offscreen consumes it via
  `getUserMedia(chromeMediaSource:"desktop")`) is a dead end two ways: (1) from a
  service worker `chooseDesktopMedia` needs a `targetTab` — without it you get
  `"A target tab is required…"` (this is what killed RISK 1 in run 1, picker never
  opened); and (2) even if you mint the streamId elsewhere, a desktopCapture streamId
  is **not consumable in an offscreen document** — `getUserMedia` throws
  `DOMException: Invalid state`. Chrome DevRel confirmed this is unsupported, was NOT
  fixed the way `tabCapture` was in Chrome 116, and won't be prioritized; they steer
  you to `getDisplayMedia()`. **The blessed pattern (Chrome's own docs):** create the
  offscreen doc with reason **`DISPLAY_MEDIA`** (which *waives the user-gesture
  requirement* there), call `navigator.mediaDevices.getDisplayMedia({video:true})`
  inside it, and run `MediaRecorder` in the same context. This is simpler than the
  streamId dance and means the **popup can start** (no gesture/dedicated-page needed).
  A first fix attempt (a dedicated recorder page to give `chooseDesktopMedia` a page
  gesture) was the wrong layer — it'd still have hit "Invalid state" at offscreen
  consumption — and was reverted. _Found by studying Screenity (a real MV3 recorder)
  and the Chromium-extensions thread; classic Search-Before-Building catch._
  Sources: Chrome "Audio recording and screen capture" docs;
  groups.google.com/a/chromium.org/g/chromium-extensions/c/3RanHldyp9c.
  **Confirmed live (run 2, 2026-06-17):** getDisplayMedia-in-offscreen runs
  gesture-free — Start in the popup → macOS screen-record permission prompt → Chrome's
  "Choose what to share" dialog → a 12 MB `video.webm` in the bundle, `errors.json`
  empty. No dedicated page or gesture relay needed. _(Cross-project candidate for the
  LLM Wiki.)_

- **Redaction has THREE URL-bearing sinks, and rrweb (`events.jsonl`) is the sneaky
  one.** Run 1 leaked a `?jwt=` token in `timeline.json` + `network.har` (fixed with
  `redactUrl` at the worker URL sinks). Run 2 then leaked the SAME token a third way:
  rrweb serializes the live DOM, so an `<img src=…?jwt=…>` carried it straight into
  the raw DOM stream, which bypasses every per-field scrubber. Fix: scrub the rrweb
  node at the worker chokepoint — `JSON.parse(scrubTokens(JSON.stringify(node)))` in
  the `rrweb-event` handler — which catches a token shape anywhere in the DOM tree
  (attribute, text, nested), same net as `redactBody`, lockstep with the validator's
  `TOKEN_RE`. Verified on the real `events.jsonl` (3 leaked lines → 0, all 527 lines
  still valid JSON) and regression-tested in `tests/test_redact.mjs`. Lesson: enumerate
  EVERY sink a value lands in (timeline, HAR, urls_visited, tab legend, AND the rrweb
  DOM snapshot) — a value-shape rule only protects the sinks you actually route through
  it. _(Cross-project candidate for the LLM Wiki.)_

- **Multi-tab / all-tabs instrumentation works (RISK 2 passed).** All 3 tabs were
  tagged (`tab` field) and instrumented — clicks, navs, network, hovers — and a tab
  opened mid-recording got full instrumentation, confirming the `tabs.onUpdated`
  attach path. `pack.py`'s tab legend + `━━━ tab #N ━━━` markers render from this.

- **Redaction missed tokens in URL query strings.** GitHub serves private images as
  `…png?jwt=eyJ…`; that JWT leaked verbatim into `timeline.json` AND `network.har`
  (21×) because URLs were recorded raw — the value-shape scrubber only ran over header
  values, JSON/form bodies, and array leaves, never URLs. `validate_bundle.py`'s
  `TOKEN_RE` caught it and FAILED the bundle (the gate worked). Fix: a `redactUrl()` in
  `redact.js` (mask secret-keyed query params by name — incl. `jwt`/`sig`/`access_token`
  — then `scrubTokens` the whole URL), applied at every URL sink in `background.js`
  (`instrumentTab`, the CDP `requestWillBeSent`, the nav handler, and a chokepoint in
  `appendTimeline`). Host/path are preserved; only the query secrets are masked. This
  extends the run-3 v1 lesson ("redact by value SHAPE, not key name") to a sink that
  rule had skipped — URLs. Regression-locked in `tests/test_redact.mjs` (`node --test`).
  _(Cross-project candidate for the LLM Wiki.)_

## 2026-06-17 (self-driving pack — ship the consumption skill with the data)

- **A portable artifact should carry its own instructions as a loadable skill, not
  just prose.** The pack now bundles `agent-skills/analyze-capture/SKILL.md` (the
  read-order + analyze-under-the-purpose procedure) so a receiving agent is told how to
  use the pack without external context — matches the project's self-contained-bundle
  ethos. BRIEF.md remains the neutral output spec for chat-LLM paste.
- **Purpose → bundled activity skills is the extension point.** `SKILLS_FOR_PURPOSE`
  maps a capture purpose to skills copied into the pack (e.g. ux/ui → `ui-improvement`).
  Adding a capability = drop `analyze/skills/<name>/SKILL.md` + a mapping; it then
  travels with every pack of that purpose. Keep the shipped skills in `agent-skills/`
  separate from the agent's OUTPUT `skills/<name>/` to avoid collision.
- **"Make UI changes" = give the agent the capture's selectors as the bridge to code.**
  The capture already records a unique selector + accessible name per element; the
  ui-improvement skill tells the agent to grep the app's source for that
  id/test-id/text to find the component, implement the smallest fix for the observed
  friction, and verify — turning observation into an applied change. _(Cross-project
  candidate for the LLM Wiki.)_

## 2026-06-17 (intent capture — bind and structure, don't add raw signal)

- **The 10x for the analyzing model isn't more raw data — it's binding + structure.**
  The capture already had clicks, narration, network, frames. What made it legible was
  (1) tagging actions with semantic element context (accessible name / role / section)
  so "click div:nth-of-type(3)" became "click button 'Issue refund' in 'Order
  actions'"; (2) segmenting the flat stream into steps and binding the narration spoken
  in each to it (draft SOP); (3) a stated task goal at the top; (4) linking each action
  to its frame and drawing the click marker on it. None of these needed new sensors —
  just joining signals already on the one clock.

- **Narration forward-binds to the action it introduces.** A speech cue narrates what
  comes next, not what just happened. In step segmentation, give each speech event the
  *next* action's tab (forward-fill) and let a pre-action pause start a new step that
  opens with the cue — otherwise narration sticks to the previous step and detaches
  from the action it explains. _(Cross-project candidate for the LLM Wiki.)_

- **Semantic capture must never read `el.value`.** Accessible name from aria-label /
  aria-labelledby / associated `<label>` / text / placeholder is safe and intent-rich;
  `el.value` would leak a typed secret. Skip `textContent` for `<select>` (it's the
  concatenated option text) — use the chosen option instead.

- **"Draw on screen" without an image library.** Don't rasterize onto the PNG (needs
  Pillow). Generate an HTML view that layers a CSS-positioned marker over the frame
  `<img>` using the captured `%` coords + the element rect as `%` of the viewport —
  resolution-independent, pure stdlib, and it renders a real annotated view in a
  browser. _(Cross-project candidate for the LLM Wiki.)_

## 2026-06-17 (v2 capture rework — architecture, pending live verification)

- **Full-screen video uses `desktopCapture`, not `getDisplayMedia`.** For an MV3
  extension the clean path is `chrome.desktopCapture.chooseDesktopMedia(sources, cb)`
  → a single-use `streamId` → the offscreen doc's `getUserMedia({video:{mandatory:
  {chromeMediaSource:"desktop", chromeMediaSourceId: streamId}}}})`. Call
  `chooseDesktopMedia` with **no targetTab** (2-arg form) so the streamId is
  consumable by our own offscreen document — that's the pattern in Chrome's official
  offscreen screen-recording sample. `getDisplayMedia` would need a DOM gesture an
  offscreen doc can't provide. **Unverified live:** whether the worker can trigger the
  picker through the popup→message path, or whether it needs a real gesture
  (`action.onClicked` / popup handler). `LIVE-TEST.md` RISK 1 settles this.

- **All-tabs instrumentation = attach the debugger to each tab; let content scripts
  self-attach.** Content scripts already register for `<all_urls>` and self-start by
  asking the worker `is-recording` on load, so a new tab's DOM capture comes for free.
  The piece that does NOT auto-attach is the **CDP debugger** (network) — the worker
  must `chrome.debugger.attach` per tab. So v2 keeps a `state.tabIds` set, attaches at
  start across all eligible tabs, and a `tabs.onUpdated` (status "loading", real URL)
  listener attaches to tabs opened mid-recording. **Unverified live** (RISK 2).

- **Tag events with their tab at the worker, not in the page.** The content script
  doesn't know its own `tabId`; the worker reads it from `sender.tab.id` on each
  message and stamps `tab` onto the event. Network events get `source.tabId` from the
  CDP event. A manifest tab legend (id → url/title) turns the opaque ids into
  readable `#1/#2` ordinals in `pack.py`. Keeps the one-clock merged timeline
  disambiguable across tabs without threading tab context through the page code.

- **Keep v1 intact: fork to a new repo for a big core change.** v2 reworks the entire
  capture path; doing it in place would risk the one working pipeline. Forking to a
  separate repo (verbatim copy, fresh git) let v2 evolve while v1 stays runnable.
  Decision by Adam, 2026-06-17.

> When `LIVE-TEST.md` is run, record the result here: did the picker open from the
> worker? did new tabs get instrumented? any surprises in the multi-tab bundle?
