# Learnings — v2

Dated findings specific to v2. v1's learnings (MV3 gotchas, redaction, ASR, the
unique-selector algorithm, etc.) live in the v1 repo and still apply — v2 inherits
that code unchanged.

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
