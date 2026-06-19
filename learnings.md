# Learnings — v2

Dated findings specific to v2. v1's learnings (MV3 gotchas, redaction, ASR, the
unique-selector algorithm, etc.) live in the v1 repo and still apply — v2 inherits
that code unchanged.

## 2026-06-19 (HARDENING Track B — redaction leaks into STRUCTURED sinks)

Closed the three Track B items from the failure-mode review — secrets/PII reaching
the structured outputs (events.jsonl, timeline.json) that get handed to other
agents. Built + unit-tested (3 bisected commits, 93 node / 125 python green);
needs a live verify. Durable lessons:

- **rrweb `maskAllInputs` does NOT cover rich editors.** It masks `<input>`/
  `<textarea>` values only — contenteditable and ARIA textboxes (Gmail, Slack,
  Notion, most modern app bodies) record their text verbatim into `events.jsonl`,
  including anything the user types. Fix: pass rrweb `maskTextSelector`
  (`[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"]`)
  + a `maskTextFn`. Verified against the vendored rrweb that this masks **both** the
  initial snapshot and every incremental typing mutation: the characterData path
  re-runs the selector via `closest()` per change, and `needsMask` inherits to
  descendants — so a match on an editor root covers its whole subtree. `maskTextFn`
  only fires on already-masked text, so returning a clean `‹redacted›` marker is
  safe and more legible than rrweb's default char-by-char `*`. Lesson: a library's
  "mask inputs" flag is scoped to real form controls; rich editors are a separate
  surface you must opt in for. (Pure bits in `src/mask-text.js`, mirrored into
  `content.js` like the redact/annotate helpers.)
- **Semantic context (`ctx`) is another URL/secret sink — enumerate its fields.**
  `describe()` builds a ctx per event; `accessibleName()` follows `aria-labelledby`
  to a referenced node's `textContent` and `sectionFor()` reads a landmark label /
  nearest heading — any of which can carry a token. Only `ctx.href` was being
  scrubbed. Fix: one `redactCtx()` (href+name+section) at the `appendTimeline`
  chokepoint, plus `content.js` suppressing `ctx.name` entirely on a secret input
  (so a labelledby on a password field can't leak its referenced text at all). Same
  recurring lesson as the URL-sink and form-body leaks: **a value lands in more
  fields than the obvious one — scrub them all at one chokepoint.**
- **`tabs.onUpdated` is the worker-side signal for SPA navigation.** content.js
  listens only for `popstate`, so `history.pushState`/`replaceState` and hash
  changes emitted no `nav` event — the timeline's URL context drifted across a whole
  SPA session and those URLs skipped `redactUrl`. Monkeypatching `history` from the
  content script wouldn't work (isolated world — the page keeps its own `history`
  reference). The clean fix is worker-side: Chrome fires `tabs.onUpdated` with
  `changeInfo.url` and **no status transition** for an in-place URL change, so
  `navActions` returns `emitnav` for that case and the worker appends a redacted nav
  (going through the canonical `redactUrl`). Gated on the *absence* of
  `changeInfo.status` because a full-page nav (status:loading/complete) is already
  nav'd by the reloaded content script — gating on status avoids a double-log.

## 2026-06-19 (HARDENING PASS — a deep failure-mode review + Track A fixes; the "looks healthy while losing data" class)

A focused 4-angle review (capture worker, content script, analyze pipeline,
AI-usability) to find where the tool breaks/loses data. Findings cluster around the
two things the tool exists for — **long/large recordings** and **AI-usable output** —
and the worst ones are SILENT: the recording shows REC and the keepalive runs while
data is quietly lost. Track A (silent data-loss) was built + unit-tested this session
(5 bisected commits, 82 node / 125 python green). Durable lessons:

- **A STORE zip writer is 32-bit unless you build Zip64.** `zip.js` wrote every
  size/offset with `setUint32` and the file count with `setUint16`, while a comment
  claimed a "Zip64 … only if needed" path that **did not exist**. Past 4 GiB (a
  multi-hour capture) the fields wrap mod 2³² → a silently-corrupt zip that reports
  `ok:true`, after which the caller clears the take. Fix: a pure `zipOverflow()` guard;
  `makeZip` throws `ZIP_TOO_LARGE` before writing so the loss guard keeps the take.
  Lesson: a "handles large files" claim in a comment is not code — verify the field
  widths. Real Zip64 is the eventual fix; fail-loud is the bulletproof interim.
- **Never pin a whole media Blob in the JS heap to zip it.** Offscreen assembly did
  `new Uint8Array(await video.arrayBuffer())` — the entire video resident on top of the
  disk-backed Blob and again in the output Blob (~2–3× the capture), OOMing large
  captures inside the try (take kept but un-exportable; every retry OOMs). Fix:
  `makeZip` is async and accepts a **Blob part**, streaming it in 8 MiB slices to fold
  the CRC32 (one slice resident) and handing the original disk-backed Blob to the
  output. Deliberately did NOT use FSA `createWritable` — it reintroduces the save
  dialog Adam removed (Downloads-only). Residual: frame PNGs still load together
  (`streamFiles`); video dominates size in a normal screen capture. (Wiki candidate:
  pairs with the MV3 "assemble large artifacts in a Window context" lesson.)
- **Swallowed write failures hide a truncating capture.** Once IndexedDB hits quota,
  EVERY write (frames/timeline/rrweb/HAR) fails, but the catches were
  `console.debug`/`.catch(()=>{})` — so capture silently stops while the UI says REC.
  Fix: one `noteWriteFailure()` chokepoint trips a sticky `storageFull`, logs to
  errors.json, flips the badge, and surfaces `manifest.storage_full`. Lesson: a
  swallowed catch on a persistence path is a silent-data-loss bug; quota errors must be
  surfaced, not absorbed.
- **The crash-recovery snapshot can itself overflow storage and disarm recovery.** The
  `chrome.storage.local` session snapshot carried unbounded `errors`+`urls`; on a long
  session the `set()` rejected and `.catch(()=>{})` hid it, so a later worker death
  rehydrated stale/empty state. Fix: cap errors→50 / urls→1000, add `unlimitedStorage`,
  and surface the failed `set()` (NOT via logError — that re-calls persistSession →
  spin on a full disk). Lesson: the thing that protects you from data loss can be the
  thing that loses it; bound what you persist and never silence its failure.
- **Two more silent gaps:** goLive could go live with **no instrumented tab** (Start
  tab closed during the picker → video-only, nothing logged) — now logged. A **mic
  track ending mid-recording** was undetected (only the video track had an `ended`
  listener) — now surfaced as `manifest.narration_truncated` + errors.json. Lesson:
  every track/stream that can end independently needs its own `ended` handler.
- **Still OPEN (backlog in to-do-current.md):** Track B (structured-sink redaction
  leaks: contenteditable→rrweb, aria-labelledby→ctx, SPA pushState nav), Track C
  (analyze never-crash: guard build_context loads, subprocess timeouts, O(n²)
  nearest_frame, validator type guards, TOKEN_RE lockstep drift), Track D (AI-usability:
  HAR response bodies for the migration outcome, one API-calls table, de-dup
  Steps/Timeline/transcript, demote raw events.jsonl).

## 2026-06-19 (DATA-LOSS BUG — a 17-min recording never saved: the 64MiB message cap)

Adam recorded 17 min (no pauses), hit Finish — nothing saved/downloaded. A 1-sec test
right after downloaded fine. Two errors in `chrome://extensions`:
- `bundle export failed: TypeError … runtime.sendMessage … Message exceeded maximum
  allowed size of 64MiB.` (background.js, the export) — **the cause of the loss.**
- `offscreen microphone capture failed (recording video only)` — separate, non-fatal
  (mic grant unavailable → video-only). Not what lost the file.

- **Root cause: the whole bundle was moved through `chrome.runtime.sendMessage`, which
  Chrome hard-caps at 64MiB.** The export had TWO binary-over-message hops: the offscreen
  doc sent the video back to the worker as a base64 data URL (`offscreen-video`), and the
  worker sent the assembled zip to the offscreen doc to write into the chosen folder
  (`offscreen-save-file`). Both base64-inflate (~+33%). A 1-sec clip is a few hundred KB →
  fine; a 17-min capture blew past 64MiB → the send threw, the error was only
  `console.error`'d, and Finish silently produced nothing.
- **Why recovery was impossible:** after the failed export the data was still in IndexedDB
  + the offscreen doc — but the next recording's `start()` runs `db.clearAll()` +
  `closeOffscreen()`, so the 1-sec test **overwrote** the 17-min take. (Same destruction
  pattern as the 2026-06-18 lost-recording bug.)

**Fix — assemble + save the zip WHERE the bytes already live, never message them:**
- **Offscreen documents can only use `chrome.runtime` messaging** — NOT `chrome.downloads`
  (verified: developer.chrome.com/docs/extensions/reference/api/offscreen). And a service
  worker has no `URL.createObjectURL`. So the only context that both holds the video and
  can write a large file is the **offscreen document** (a Window: it has
  `URL.createObjectURL` + a DOM for a programmatic `<a download>`).
- **New flow:** the video Blob stays in the offscreen doc. On Finish the worker sends
  `offscreen-finalize` (offscreen stops the recorder, keeps the Blob, replies only
  `{mic, micError, hasVideo}` — no bytes). The worker builds the SMALL text files
  (manifest/network.har/transcript/errors/README/CLAUDE/AGENTS) and sends them via
  `offscreen-save`. The offscreen doc reads the BULK streams (timeline.json, events.jsonl,
  frames) straight from IndexedDB, adds its video Blob, `makeZip`s, and **downloads via an
  object-URL `<a download>`** (Downloads folder, no size limit). Only small text crosses a
  message. Shared pure `bundle-streams.js` (`streamFiles`/`frameMeta`/`dataUrlToBytes`,
  tested) is used by BOTH the offscreen path and the worker's salvage path so they can't
  drift. The worker keeps `state.frames` (metadata only, `{t,file}`) so it builds the
  manifest without ever loading frame PNGs into the SW — the bloat that this bug was.
- **LIVE-VERIFIED (Adam, 2026-06-19): a 109 MB capture downloaded.** Confirms both that the
  offscreen object-URL `<a download>` works from an offscreen doc (the one bit I was unsure
  of) and that a bundle far over 64MiB now exports fine.
- **Then simplified to Downloads-only (Adam's call):** the first cut also kept a File System
  Access "save to a chosen folder" path + an "ask where to save" native dialog. Adam: drop
  both, "just keep it bulletproof to Downloads." So `fsdir.js` is deleted and `saveMode` /
  the folder picker are gone — every export object-URL-downloads to Downloads. Lesson: the
  object-URL `<a download>` from the offscreen doc is the simplest reliable large-file sink;
  FSA's only edge (arbitrary folder) wasn't worth the picker + lapsed-permission complexity.
- **Loss guard (Adam's call):** the take is **only cleared after a save is confirmed**. On
  failure the worker keeps IndexedDB + sets `unsavedTake`/`pendingExport` + badge `!`; the
  next `start()` is **blocked** so it can't overwrite the take; the popup shows a Retry /
  Discard banner (`retry-export` re-saves from IndexedDB; `discard-take` deletes). Salvage
  (offscreen gone) still assembles a video-less bundle in the worker via `chrome.downloads`.
  Still needs a live check (force a failure → badge `!`, Retry/Discard work, next Start blocked).
- **Durable lesson (wiki candidate):** in MV3, never move large binary through
  `chrome.runtime.sendMessage` (64MiB cap) or a base64 data: URL. Assemble/write large
  artifacts in a Window context (offscreen/page) that has `createObjectURL`; the SW
  coordinates with small messages only. Pairs with the existing MV3 lesson that an offscreen
  MediaRecorder survives a worker death — the offscreen doc is also the right place to hold
  and write the bytes.

## 2026-06-18 (CAPTURE BUG — a 30-min recording was lost when the service worker died mid-pause)

The most serious data-loss bug yet. Adam recorded ~30 min sharing a single window,
**paused** to work in another window while waiting on a load, and came back to: the
overlay dead on the original tab (Pause/Finish did nothing), the overlay showing in a
different window, the share "source changed," and the recording gone. Console showed
`message channel closed before a response was received`, `Error in event handler`, and
`offscreen video capture failed: [object DOMException]`.

- **Root cause: ALL recording state lived in the MV3 service worker's in-memory `state`
  object, and the worker was terminated during the pause.** MV3 workers are killed after
  ~30s idle. During *active* recording, network + the 3s frame timer keep it warm — but
  **Pause stops the frame timer and drops event ingest, so nothing wakes the worker** and
  Chrome reclaims it. That wiped `t0`, the frame buffer, the HAR map, and the tab list
  (only `timeline`/`rrweb` were in IndexedDB), and reset `recording` to false. Every
  symptom follows: overlay commands early-return on `!state.recording` ("couldn't pause/
  finish"); the worker lost the tab id so it stopped syncing the original overlay while
  `onActivated` mounted a fresh one in the next window; the async-listener + "event
  handler" errors are the classic in-flight-message-during-termination signature.
- **What actually destroyed the data:** with the worker reset to idle, a *second* Start
  ran (the `DOMException` is `getDisplayMedia` being re-invoked — "source changed"), and
  `start()` calls `closeOffscreen()` (kills the still-live take-1 stream) + `db.clearAll()`
  (wipes the persisted timeline). So a *recoverable* loss became total.
- **Key realization that made recovery cheap:** the **offscreen document is a separate
  context from the worker** — its `MediaRecorder` keeps recording the video even while the
  worker is dead. So the video was never the problem; the worker losing its bookkeeping and
  its ability to stop was. That also means the offscreen doc is the reliable place to keep
  the worker alive, AND its keepalive ping doubles as the thing that wakes a dead worker.

**Fix — three independent layers (commits bisected):**
1. **Keepalive (prevent death).** The offscreen doc pings the worker every 20s while
   armed→recording, resetting the worker's idle timer through the pause window. No new
   permission (offscreen-ping, not `chrome.alarms`).
2. **Persist + rehydrate (survive death anyway).** Durable `state` slice (t0, pause
   accounting, tab legend, blocklist, urls, errors) → `chrome.storage.local` on every
   transition via the pure, unit-tested `session.js`; frames and the HAR moved into
   IndexedDB. On cold start `rehydrate()` restores the recording: if the offscreen doc is
   still alive (worker-only death) it re-attaches debuggers + resumes; if it's gone
   (browser restart) it **salvages** the IDB data into a video-less bundle so nothing is
   lost. Commands `await` a `rehydrated` promise so the first Pause/Finish after recovery
   isn't dropped.
3. **Second-Start guard.** Because rehydrate restores `recording=true` before a queued
   Start runs, the existing "already recording" guard now catches the second Start instead
   of letting it `clearAll()` the take. Net: a re-Start can't nuke a live/recovered recording.
4. Also added a `getDisplayMedia` video-track `onended` handler: a share that stops on its
   own (closed window / "Stop sharing") is reported to `errors.json` + `manifest.video_ended_early`
   instead of silently going mute.

**Durable lesson (wiki candidate):** in MV3, never hold unrecoverable state only in the
service worker — it WILL be terminated, and a long idle/pause is the exact trigger. Keep a
keepalive from a Document context (offscreen/port) AND persist enough to rehydrate. A
separate-context MediaRecorder survives a worker death; the worker's bookkeeping does not.

**Needs a live-Chrome verify** (lifecycle is chrome.*-dependent, no unit test): record,
Pause, leave it idle several minutes (or kill the worker from `chrome://serviceworker-internals`),
return → overlay still controllable, Resume + Finish yields a complete bundle.

## 2026-06-18 (popup UI redesign — Ethereal Glass dark theme + narration-first context)

Redesigned the extension UI (popup + mic-permission window) to a dark "Ethereal Glass"
look. Decisions worth keeping:

- **Geist is bundled locally** at `extension/src/fonts/Geist-Variable.woff2` (variable,
  MIT/Vercel, ~57KB, validated `wOF2` magic). Both `popup.html` and `mic-permission.html`
  `@font-face` it via a relative `fonts/…` URL — **no network calls** (the default MV3
  `extension_pages` CSP allows `'self'` resources). Don't switch to a CDN/Google Fonts link.
- **`[hidden]` needs `!important`.** `.row`/`#rec` set `display:flex`, and author display
  rules outrank the UA `[hidden]{display:none}` rule — so `popup.js` toggling `.hidden`
  silently no-ops without `[hidden]{display:none!important}` in the stylesheet. This was a
  latent bug on the live row even before the redesign.
- **Mic grant: detect silently, grant via a real page, remember with a flag (2026-06-18).** Two
  bugs, two lessons.
  1. **"Asks every time"** came from gating Start on `navigator.permissions.query({name:"microphone"})`,
     which is **unreliable in an extension popup** — it returned not-granted even though the grant had
     persisted (recordings DID get narration), so the window re-opened each Start. Lesson: don't use
     `permissions.query` for the mic in a popup.
  2. **First attempt over-corrected** to a pure-inline popup `getUserMedia` grant and **broke in
     Comet** — the popup probe does nothing there, so Enable-mic was dead and recording was blocked.
     Lesson: **requesting `getUserMedia` straight from an action popup is not portable** (no prompt in
     some Chromium forks; the popup can also close when the bubble appears). Use a real extension PAGE
     to grant.
  3. **A separate grant window is unwanted too.** Adam: it opened in its own window and didn't
     dismiss after enabling ("you have to leave it open to record") — he wants the prompt IN the tab
     he's on.
  - **Final design (commit ba06356):** prompt for the mic via the MV3-standard **in-page iframe
    pattern** — inject an invisible **extension-origin** iframe with `allow="microphone"`
    (`request-mic.html`/`js`, web-accessible) into the ACTIVE TAB via `chrome.scripting.executeScript`;
    its getUserMedia makes Chrome's prompt anchor to that tab, grants to the EXTENSION origin (so the
    offscreen recorder can use the mic), and the iframe removes itself once the user chooses (nothing
    lingers). It also doubles as a silent check (resolves with no prompt when already granted). A
    persisted **`micGrantedOnce`** flag (set by the iframe or the fallback page) is the fast path so a
    granted user is NEVER re-asked, in any browser. The old `type:"popup"` `mic-permission.html` window
    is now only the fallback for when the tab can't host the iframe (a `chrome://` page —
    `executeScript` throws). The worker clears the flag if a recording's mic fails (revoked) →
    self-heals. **Lessons:** (a) don't `permissions.query` the mic in a popup; (b) don't request
    getUserMedia from the action popup (closes / no-op in Comet); (c) the portable in-tab prompt is an
    extension-origin iframe with `allow="microphone"` injected into the page. `mic-permission.*` and
    `request-mic.*` are BOTH in use — don't delete.
- **Context is now narration-first.** The typed "What are you doing in this recording?" field
  is a collapsed `<details>` toggle (`#whatBox`), no longer prominent; `#task` still flows to
  the worker if filled. The primary intent capture is **spoken**: the pre-roll countdown
  overlay (`content.js`) now shows a caption — "Say out loud what you're about to do / Your
  narration gives the AI the most context" — to prompt the user to narrate during the 3-2-1.
  Start CTA moved to the top of the popup; the old "On Start, Chrome asks…" foot hint removed.

## 2026-06-18 (overlay mic level meter — "is the mic hearing me?")

Added a live mic level meter (green equalizer bars) to the on-screen recording
overlay so the user can confirm narration is being picked up while recording.

- **Where the level is measured vs shown.** The mic stream only exists in the
  offscreen document (`offscreen.js`), but the overlay lives in each tab's content
  script. So: `offscreen.js` taps the mic with a Web Audio `AnalyserNode` (NOT
  connected to any output — no echo; never touches the recorded audio), samples RMS
  every 80ms (~12/sec), and posts `{type:"mic-level", level}` to the worker.
  `background.js` fans it out to every instrumented tab (like `broadcastOverlay`),
  guarded by `state.recording && state.micActive`. `content.js` `overlay.setMicLevel()`
  drives 5 bars via `transform: scaleY()` (GPU-friendly, per the UI guardrails).
- **mic on/off plumbing.** `offscreen.js` reports `mic: micRecorded` in
  `offscreen-armed`; the worker stores `state.micActive` and includes it in
  `overlayClock()`, so every `start` / `overlay-state` / `is-recording` payload
  carries it (a tab joining mid-recording renders the right state). When the mic
  isn't live the overlay shows a dimmed, amber-slashed mic glyph and no bars.
- **Rest behaviour.** The offscreen loop posts `level:0` whenever
  `recorder.state !== "recording"` (pre-roll / paused), so the bars fall to a flat
  baseline instead of freezing. The loop + AudioContext are torn down in
  `releaseStreams()` (stop/cancel), so there's no traffic once recording ends.

## 2026-06-18 (popup i18n — manual EN/ES/PT language toggle)

Added an in-UI language switch (header, next to the title) for the first three
audiences: English, Spanish, Portuguese. Notes:

- **NOT `chrome.i18n` / `_locales`.** That follows the *browser's* UI locale and
  can't be toggled from inside the popup — the whole point here is a user-picked
  toggle. Instead: a shared string table in `extension/src/i18n.js` (a classic
  script that sets `window.BAC_I18N` with `t(lang, key, vars)`), `data-i18n` /
  `data-i18n-ph` / `data-i18n-html` attributes on static elements, and `applyLang()`
  in `popup.js` that swaps text + lights the active segment. Choice persists in
  `chrome.storage.local` under `lang`; first-run default is `BAC_I18N.detect()`
  (browser language narrowed to en/es/pt, else en).
- **Load order matters.** `i18n.js` is a plain `<script>` loaded *before* the
  `type="module"` `popup.js`, so `window.BAC_I18N` exists when the module runs.
  Same pattern on `mic-permission.html`.
- **Three string surfaces, three mechanisms.** (1) popup + mic-permission share
  `i18n.js`. (2) `content.js` (the countdown caption) can't import `i18n.js`
  without adding it to the `content_scripts` array, so it keeps an **inline**
  `CD_STRINGS` map (en/es/pt) and reads `lang` via `chrome.storage` +
  `onChanged` — keep `cdBold`/`cdSmall` in `i18n.js` and `CD_STRINGS` in
  `content.js` in sync. (3) JS-driven strings (status, mic state, folder, pause)
  route through `T()` and are re-rendered by `applyLang()`.
- **Rich strings use `data-i18n-html`** (blocklist hint with `<code>`, mic body
  with `<b>`). Safe because they're authored translations, never user input.
- Verified: 51 keys, full en/es/pt parity, every `data-i18n*` key defined
  (node parity check), all four JS files pass `node --check`, and the live
  toggle was exercised end-to-end in Chromium (EN→ES→PT re-renders correctly).

## 2026-06-18 (live-run #2 findings + fixes — blocklist, pause clock, ASR, annotation fusion)

A second live run (`outputs/capture-2026-06-18T12-45-56-384Z.zip`) surfaced four things:

- **The blocklist silently failed and 1Password was fully captured** — the auth flow in
  `network.har` (auth/start, confirm-key, complete; SRP/AES-GCM blobs, not the master password)
  AND the vault wide open in a frame (card + every item name). Two root causes: (1) settings were
  only written to storage **on Start**, so a blocklist typed and left unsubmitted never persisted;
  (2) `hostBlocked` did an **exact** `blocklist.includes(hostname)`, so `1password.com` never
  matched `my.1password.com`. Fixes: popup now **saves on edit** (debounced, "Saved ✓"); matching
  moved to a pure, suffix-aware, input-tolerant `extension/src/blocklist.js` (tested).
- **A host blocklist CANNOT protect the whole-screen video by itself** — even blocked for
  instrumentation, a sensitive tab still shows up in `video.webm`/frames (the documented
  "visual_streams_redacted: false"). Real fix per Adam: **auto-pause** the entire recording (video +
  events + frames) the instant the active tab is blocklisted, auto-resume on leaving — driven from
  `tabs.onActivated` / `windows.onFocusChanged` / `onUpdated`. The blocklisted tab has no overlay
  (it's uninstrumented), so the icon tooltip carries the reason.
- **Pause leaked time into the clock.** The overlay clock and event/frame stamps used
  `Date.now() - t0`, which counts paused seconds — so on resume the timer **jumped forward** by the
  pause length, and (worse) frames/events stamped after a pause drifted past the pause-excluding
  `video.webm`. Fixed with a paused-aware clock (`extension/src/clock.js`, tested): worker banks
  `pausedAccum` and the overlay subtracts it. This is load-bearing now that the blocklist auto-pauses
  on every sensitive-tab visit.
- **Auto-transcribe didn't "use what I have."** The machine had the weights cached
  (parakeet + faster-whisper) and the packages in the uv cache, but no `.venv`, and `pack.py`
  hardcoded the MLX-only `parakeet` engine via the *invoking* python — so it failed on bare
  `python3`. `pack.py` now finds the repo `.venv` (or any interpreter with an engine), auto-selects
  parakeet → faster-whisper, and runs `transcribe.py` as a subprocess; it transcribes on bare
  `python3` now. Added `analyze/setup.sh` / `setup.ps1` / `requirements.txt` for Mac/Windows.
- **Annotations now fuse all three modalities.** The `## ✦ Annotations` section binds each
  Select/Draw mark to the narration spoken around its timestamp (🗣) and its frame, so a recipient
  agent connects mark + words + frame at one timestamp instead of cross-referencing transcript.vtt.
- Also: stale content scripts spewed "Extension context invalidated" after a reload — content.js
  sends now go through a `safeSend` guard (`chrome.runtime?.id` check + try/catch). The CSP
  `frame-ancestors`/`report-uri`-via-meta warnings are from recorded sites, not our code.

### Known limitation — redaction does NOT cover secrets in page content (documented, not fixed)

Live-run #3 (`Downloads/capture-2026-06-18T14-20-08-292Z`) verified the blocklist fix: a
1Password tab visited during the run was correctly excluded (no `1password.com` host in
`urls_visited`/`tabs`/`network.har`; the only "1Password" string is the extension's autofill
tooltip injected into an *allowed* page — no vault content). Recorder + mic also healthy that
run (`video.webm` present, `narration_in_video: true`, empty `errors.json`).

But that prompted the real boundary, worth stating plainly so users know what to expect:

- **Redaction is field-and-network scoped, not content scoped.** It masks (1) secret-shaped
  *form fields* (`isSecretInput`/`maskValue` in `content.js`: `password` type or
  `password|secret|token|api_key|auth|ssn|card|cvv` name/id), (2) *network* secrets
  (`Authorization`/`Cookie` headers; JWT/`Bearer`/`AIza…`/`sk-…`/`ghp_…` shapes in URLs/bodies
  via `redact.js`), and (3) rrweb is `maskAllInputs: true` only — **no `maskAllText`**.
- **So a secret written into page *body* text is NOT redacted.** Example: an API key saved in a
  Google Doc. It's not a form field and not a network value, so no masker touches it. It would
  appear verbatim in any captured DOM text, and — regardless of DOM — **in `video.webm` and
  `frames/` in the clear** (`visual_streams_redacted: false`; AGENTS.md already warns on-screen
  secrets are visible there).
- **Google Docs specifically:** body text is canvas-rendered (rrweb isn't recording canvas), so it
  likely won't land in `events.jsonl` at all — but it's still fully visible in the video/frames.
- **The only protection for content secrets is tab exclusion** (Settings → "Never record on" /
  auto-pause), the same path that excluded 1Password. Decision (Adam, 2026-06-18): **document this
  expectation; do not build content-level redaction.** Treat it as "don't record tabs holding
  secrets in their content," not "the tool will scrub them."

### Transcription portability — make "install once, automatic forever" trustworthy on someone else's machine

The recipient model: they clone the full repo, install once, likely have an AI agent, and record
*their own* captures. Transcription is always post-download (the extension can't run ASR — needs a
native ML runtime + ffmpeg it can't host). Two paths already existed (one-time `.venv` install →
`pack.py` auto-transcribes every future bundle; or hand the self-driving bundle to an agent via
`AGENTS.md`). What was missing was making the *install* trustworthy on a machine unlike Adam's.
Four gaps, all fixed this session:

- **ffmpeg was a silent failure.** `setup.sh`/`setup.ps1` only *warned* if ffmpeg was missing, then
  built the venv and reported success — so transcription silently skipped forever. Now a **hard
  gate**: setup exits non-zero with the per-OS install command if ffmpeg isn't on PATH.
- **No proof it worked.** Added `transcribe.py --selftest`: synth 1s of silence via ffmpeg → run the
  installed engine → report pass/fail with the exact missing piece. setup runs it at the end and only
  claims success if it passes. `--selftest` needs no bundle and **auto-detects** the installed engine
  (parakeet on Apple Silicon, faster-whisper elsewhere) unless `--engine` is forced.
- **Surprise model download mid-task.** The selftest's first engine run downloads/loads weights, so
  setup **pre-warms** the model — the user's first real capture is fast and offline. (One mechanism
  covers verify + pre-warm.)
- **Discoverability.** The export-time stub `transcript.vtt` now names the command that fills it
  (`pack.py`/`transcribe.py` + the one-time setup), and `analyze/README.md` states the
  "install once → automatic, stub is filled by pack.py not by opening the file" flow. Kept the
  `No narration captured` marker so `pack._transcript_is_stub` detection is unchanged.

Tests: `tests/test_selftest.py` (engine auto-detect, ffmpeg-missing → rc 2, no-engine → rc 3,
explicit-engine not overridden, success path). 125 python / 55 node green.

### Save-to-a-chosen-folder (File System Access) — the constraints that shaped it

Adam wanted an in-extension folder picker that auto-saves there. Key constraints found:

- **`chrome.downloads` can only write into the browser's Downloads tree** (filename is relative;
  absolute paths / `..` are rejected). It CANNOT silently save to an arbitrary folder. So
  "auto-save anywhere, no dialog" is impossible via the downloads API. (`saveAs: true` opens the
  native dialog but prompts every time — that's the "ask" mode.)
- The way to do it: **File System Access API** — `showDirectoryPicker()` in the popup (needs a user
  gesture; popups have one on click), persist the returned handle in **IndexedDB** (it isn't JSON,
  so it can't go in `chrome.storage`; kept in its own `bac-fs` DB via `fsdir.js`, separate from the
  capture DB so `clearAll()` can't wipe it).
- **The write must happen in a Window context, not the service worker** — SWs can't reliably
  `createWritable()`. So the **offscreen document** (already alive at export time) loads the handle,
  `queryPermission({mode:'readwrite'})`, and writes the bundle. The worker coordinates via a
  message round-trip (`offscreen-save-file` → `offscreen-saved {ok,reason}`).
- **Permission can lapse across a browser restart** (`queryPermission` → `'prompt'`, and there's no
  gesture at export time to `requestPermission`). Handled gracefully: on any failure the worker
  falls back to a normal Downloads download (never lose a recording) and sets
  `exportDirNeedsRegrant` so the popup tells the user to re-pick the folder.
- popup.js + offscreen.js became `type="module"` so they can import `fsdir.js`. **Needs a live
  Chrome verify** (FSA is browser-API, no unit test).

## 2026-06-17 (security scan — adversarial review of redaction + egress + injection)

Two independent adversarial audits (redaction-bypass hunt; egress/permissions/injection). The
extension is **verified local-only** — no `fetch`/WebSocket/beacon/native-messaging anywhere; the
only outbound is `chrome.downloads` (a local file) and the offscreen doc. The one egress path is
the optional `analyze/adapters/run_claude.py` (explicit, API-keyed handoff). `innerHTML` uses only
static strings; `executeScript` injects fixed file paths. Findings fixed:

- **Redaction's value-shape backstop knew ONLY JWT + Bearer**, so AWS/Stripe/GitHub/Google/Slack/
  OpenAI/Anthropic keys + PEM blocks leaked when they sat under an innocuous key name (and a
  non-JSON/multipart body or a custom header only got the JWT/Bearer scrub). Added high-confidence
  provider-prefix shapes to `TOKEN_VALUE_RE` (and the validator's `TOKEN_RE` in lockstep). Lesson:
  a value-shape backstop is only as good as the shapes it knows — enumerate the common providers,
  keep the prefixes high-precision to avoid over-redacting page content.
- **`redactUrl` skipped the `#fragment` and `user:pass@` userinfo** — OAuth implicit flow returns
  the token in the fragment, and basic-auth creds sit before the `@`. Both now masked.
- **`ctx.href` was the one URL field that escaped redaction** — `describe()` copies a link's raw
  href into the event ctx, and `appendTimeline` only scrubbed `event.url`. A secret in an
  `<a href="…?token=…">` leaked into timeline.json. Now scrubbed at the same chokepoint. Lesson
  (again): enumerate EVERY field a URL lands in.
- **The validator gate skipped manifest.json / errors.json / transcript.vtt** — the two biggest URL
  collections (urls_visited + tab titles) lived in the one required file the redaction check didn't
  scan, giving false confidence. Now scanned. Also `tab.title` is scrubbed (a "Reset password:
  <token>" page title).
- **Path traversal on the untrusted-bundle analyze side:** `manifest["video"]` was joined raw, so a
  hostile bundle could make ffmpeg read an arbitrary file (`"video":"../../.ssh/id_rsa"`); and
  `frames-annotated.html` emitted `<img src="<raw frame file>">`, a `../`-traversal local-file read
  when opened. Both now basename-stripped (`Path(...).name`). `_esc` also escapes `'` now.
- **Visual streams are NOT redacted** (frames/video are pixels) — `password_fields_masked:true` could
  imply otherwise. Documented in the in-zip docs + `manifest.redaction.visual_streams_redacted:false`.

Residual (recommended, NOT done — flagged to Adam): remove `web_accessible_resources` for
`offscreen.html` (createDocument doesn't need it; untestable here so left for a live check); record
a SHA-256 of vendored `rrweb.min.js` (2.0.0 is advisory-clean per Snyk; latest is 2.0.1); pin the
optional analyze deps (mlx-audio/faster-whisper/anthropic) + `pip-audit`; drop the likely-redundant
`activeTab` permission. _(Redaction sink-enumeration + value-shape lessons are wiki candidates.)_

## 2026-06-17 (hardening pass — bugs found by independent review, fixed)

A fan-out review of the new P2/P3/P4 code (three independent passes) surfaced real bugs. The
durable lessons:

- **Redaction sinks must share ONE secret-name list, or the narrowest one leaks.** The form-body
  branch of `redactBody` used `(pass|secret|token|key|auth)` while the URL/JSON sinks used the
  broader `SECRET_KEY_RE`/`SECRET_PARAM_RE` — so `card=`, `cvv=`, `ssn=`, `jwt=`, `sig=` in a
  form POST leaked into `network.har`. Fix: derive every matcher from shared `SECRET_KEY_WORDS` /
  `SECRET_PARAM_WORDS` constants. Also: `TOKEN_VALUE_RE` was case-sensitive (lowercase `bearer …`
  slipped) and didn't handle a URL-encoded space (`Bearer%20…` in a query value) — added the `i`
  flag + `(?:\s|%20|\+)`. `validate_bundle.py`'s `TOKEN_RE` updated in lockstep. Bare `key` also
  over-matched `monkey`/`turnkey` → use `api[-_]?key`. This is the same lesson as the original JWT
  leak: **enumerate EVERY sink and run them all through the SAME rule.** _(Wiki candidate.)_
- **"Never record on" must block instrumentation, not just HAR rows.** `hostBlocked` was only
  consulted in the network handler, so a blocklisted host (e.g. a webmail/bank tab) still got the
  debugger, content script, rrweb DOM, clicks, and screenshots — only its HAR entries were
  dropped. Real privacy leak against the exact contract the UI promises. Fix: `hostBlocked` now
  feeds `isEligible` (no attach at all), a tracked tab that navigates INTO a blocklisted host is
  torn down, and `captureFrame` skips a blocklisted active tab.
- **Claim a lock BEFORE the first await.** `start()` set `state.arming=true` only after
  `await getSettings()/clearAll()`, so two rapid Starts both passed the guard → two pickers, and
  the second `clearAll()` wiped the first take. Set the flag synchronously. Also: the user can
  close/switch the Start tab during the picker/countdown, so `goLive()` re-resolves the active tab
  (else it instruments a dead tab and captures nothing); and a worker killed mid-arming orphans the
  getDisplayMedia stream (stuck "sharing" indicator) — `start()` now `closeOffscreen()`s first.
- **Generated HTML/SVG must coerce numeric fields too, not just escape strings.** The
  `frames-annotated.html` label/role/selector paths were `_esc`-escaped, but the coordinate fields
  (`xpct`, `points[i]`) went in raw — a tampered bundle could inject `<script>` via a coord. Coerce
  to float (`_num`). Relevant because "analyze someone else's capture" means the bundle is untrusted.
- **A best-effort step's input reads must be inside the try.** `maybe_transcribe`'s "never fatal"
  contract was broken by reading `manifest.json`/`transcript.vtt` BEFORE the try — a malformed
  manifest or non-UTF-8 transcript crashed the whole pack build. Moved the reads in.
- Validators must know new event kinds: `KNOWN_KINDS` (else spurious "unknown kind" warning) and
  `check_coverage`'s `CONTENT_KINDS` (else an annotation-only tab's coverage gap goes undetected).

## 2026-06-17 (P3 — popup redesign, preset download folder, pre-recording countdown)

Three UX items. Two non-obvious things worth not relearning:

- **A truthful countdown requires deferring capture-start, not just a pre-roll animation.**
  The picker (getDisplayMedia in offscreen) resolves seconds before recording should begin
  (the user is choosing a window). To make "3-2-1 → begin" honest, the worker now holds
  `state.recording = false` and `t0 = 0` through an **arming** phase: offscreen creates the
  MediaRecorder but does NOT `.start()`, sends `offscreen-armed`, and waits; the worker runs the
  countdown overlay in the active tab, then `goLive()` sets t0, flips `recording` on, instruments
  the active tab, and sends `offscreen-go` so the recorder starts on the SAME t0 as the
  event/network streams. Because everything gates on the `recording` flag, the pre-roll captures
  nothing (no events, frames, network, or video) — no half-started state. The cancelled-picker
  path sends `offscreen-armed{video:false}` so the worker still counts down and goes live
  data-only (fallback preserved). Capture-start is the most fragile part of the system (see the
  P1b nav bug), so the gating is deliberately a single boolean.
- **A preset download folder can only be a subfolder of Downloads.** `chrome.downloads.download`
  rejects absolute paths and `..`, so the "save exports to" setting is a *relative* subdir
  (`captures` → `Downloads/captures/capture-….zip`), sanitised in BOTH the popup and the worker
  (`cleanSubfolder`). `saveAs:false` (default) skips the Save dialog so export doesn't prompt each
  time — that's the actual ask ("so it doesn't prompt"). An "Ask where to save each time" toggle
  restores the prompt.
- Popup: collapsible `<details>` is the cheapest "dropdown" — purpose stays open + prominent
  (it seeds the agent's context), blocklist + folder move into a collapsed Settings section.

## 2026-06-17 (P4 — auto-transcribe at pack time, best-effort)

`pack.maybe_transcribe()` runs at the start of `build_pack`: a stub `transcript.vtt` + narration
audio → it calls the local transcriber so the pack has narration without a manual step (the gap
that left an earlier run's transcript empty). The discipline that matters: it must **never break
a pack build**. So it's gated on `shutil.which("ffmpeg")`, and the call is wrapped to swallow both
`SystemExit` (transcribe.py `sys.exit()`s when an engine isn't installed) and any other exception —
on failure it warns and leaves the stub (the zip is still self-driving via CLAUDE.md/AGENTS.md).
Stays local: only runs with ffmpeg present, reuses cached weights. On Adam's default `python3`
(no mlx-audio) it warns + leaves the stub; the `.venv` is where it actually transcribes. Mockable
seam (`import transcribe` lazily inside the function), so `tests/test_autotranscribe.py` covers all
the gates with no ffmpeg/engine. `--no-transcribe` opts out.

## 2026-06-17 (P4 — rendering the annotation events on the analyze side)

Wired the P2 `annotation:select` / `annotation:draw` events through `pack.py` so they're
legible to the analyzing agent (before this they fell through to the raw-JSON `else` branch):
- **Three places, one signal.** A dedicated `## ✦ Annotations` section up top in `context.md`
  (the high-signal "user explicitly means THIS" list), plus inline rendering in the Steps
  procedure and the raw Timeline. Selector reuses `action_label()` so it reads
  `button "Issue refund" in "Order actions"` like a click; Draw shows its bbox as
  `@(x%,y%) w×h%` via the new `_draw_region()` helper.
- **`frames-annotated.html`:** refactored the card builder into `_point_card()` (click / hover /
  `annotation:select`) and `_draw_card()` (freeform). A selection is drawn in **blue** (the
  in-extension Select tool's colour, `#0a84ff`, via a `.sel` CSS class on the existing box/dot)
  to distinguish a deliberate mark from an incidental click. The freeform stroke is an **SVG
  polyline** with `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` — because the points are
  already viewport-% (`drawGeom`), they map straight onto the screenshot at any size with no
  per-point arithmetic, and `vector-effect:non-scaling-stroke` keeps the line a constant pixel
  width. Pure HTML/CSS/SVG, no image library (consistent with the v1 "draw on screen without
  Pillow" lesson).
- The events flow without any extension/worker change — they're plain timeline events tagged
  with `tab`, so the multi-tab markers and step segmentation already disambiguate them.

## 2026-06-17 (P2 — Selector + Draw annotation tools; three non-obvious gotchas)

Built the two on-overlay annotation tools (`annotate` IIFE in `content.js`), both usable
mid-recording, both emitting structured timeline events AND drawing on-screen so the mark
also lands in `video.webm` and the frame grabbed at emit time:
- **Selector** — element pick; reuses `selectorFor()` + `describe()`; emits `annotation:select`
  (selector + semantic label + element rect) so user and agent align on the same element.
- **Draw** — freeform stroke (not element-bound); emits `annotation:draw` (a %-coord path +
  bbox via `drawGeom`) so the analyst gets "user circled here", not just pixels.

Things that aren't obvious and would bite a re-implementation:
- **Annotation pointer events bubble to `document` and get logged as fake workflow
  clicks/hovers.** The catcher is a shadow-DOM element with `pointer-events:auto`; a click on
  it still propagates to the page's `document`, where our capture-phase `onClick`/dwell
  listeners fire — retargeted to the annotation host — and would record a spurious
  `click #__bac_annotate__`. Fix: guard `onClick` and `emitDwell` with `if (annotate.mode())
  return;`. (Capture-phase order means our page `onClick` fires *before* the catcher's own
  handler, so you can't rely on `stopPropagation` from the tool to suppress it.)
- **To hit-test the page element *under* a full-viewport catcher**, momentarily set the
  catcher's `pointer-events:none`, call `document.elementFromPoint(x,y)`, then restore — else
  elementFromPoint just returns the catcher. (`pageElAt` in `content.js`.)
- **Annotations are visible-AND-structured by design.** They render on a `<canvas>` (strokes)
  + an outline div (the picked element box) that fade after ~3s — long enough to show in the
  video and in the frame the worker grabs (`annotation:*` added to the click/nav frame
  trigger), short enough not to obscure the page. The structured event is the deliverable for
  the agent; the on-screen mark is for the human watching the video.
- **`drawGeom` is duplicated.** The %-coord/bbox math lives in `extension/src/annotate-geom.js`
  (tested, `tests/test_annotate.mjs`) and is copied verbatim into `content.js` (a classic
  content script can't `import`) — same keep-in-sync arrangement as the `redact.js` helpers.
- pack.py already tolerates unknown event kinds (its `else` branch JSON-dumps them), so the new
  `annotation:*` events render raw today; making them pretty is P4 (analyze side).

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
