# Learnings — v2

Dated findings specific to v2. v1's learnings (MV3 gotchas, redaction, ASR, the
unique-selector algorithm, etc.) live in the v1 repo and still apply — v2 inherits
that code unchanged.

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
