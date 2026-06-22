# Handoff (v2)

_Last updated: 2026-06-22 (HARDENING Track D analyze-side — D2/D3/D4/D6: AI-usability of the pack;
all in `pack.py`, built + unit-tested, 183 python / 93 node green, NO live verify needed. D1/D5/D7
remain. Prior: Track C analyze never-crash (done); Tracks A + B (built + unit-tested, NEED A LIVE
VERIFY); 64MiB fix LIVE-VERIFIED.)_

## ▶ NEXT — Track D leftovers (D1 / D5 / D7). Tracks A + B still need a LIVE VERIFY (interactive).

Track D analyze-side (D2/D3/D4/D6) is done (built + unit-tested, no Chrome). Remaining in
`to-do-current.md` → "HARDENING backlog":
- **D1 — HAR response bodies** (unlocks the migration outcome). **NEEDS A PLAN** — it's an extension
  capture-path change that adds a NEW sink where secrets can land (so it needs response-body
  redaction) AND a live-Chrome verify. The analyze side is already ready: the new `## API calls`
  table has a `response body` column that renders `—` until the HAR carries bodies.
- **D5** — guarantee narration into the self-driving zip; **D7** — regenerate `analyze/example-output/`
  from a v2 bundle (needs a real v2 capture on disk).
- **Live verify** Tracks A + B together when there's a Chrome session (both are interactive-only).

## ✅ DONE 2026-06-22 — HARDENING Track D analyze-side (D2/D3/D4/D6) — built + unit-tested (NO live verify)

The "totally usable, don't overload" ask — `context.md` was overloading the receiving AI with the
same info three ways. All four analyze-side items are in `pack.py`; 183 python / 93 node green.
Diagnosis + durable lessons in `learnings.md` 2026-06-22; new tests in `tests/test_ai_usability.py` (18).
- **D2** one authoritative `## API calls` table (method + full URL + status + request/response bodies
  on one clock; `t` derived from HAR `startedDateTime` − manifest `t0_wall`). Replaces the old lossy
  Timeline/Network split; the thin `## Network (HAR summary)` section is gone.
- **D3** de-dup: each modality gets ONE home. Narration → Steps (bound) + verbatim Narration block
  (dropped inline 🗣 from the Timeline); bodies → the API table only (dropped `body=` from the
  timeline network line, which keeps a brief line for causality). Headers say where each thing lives.
- **D4** `events.jsonl` (raw rrweb stream) dropped from the pack's `bundle/`; README states it's
  intentionally omitted and still lives in the original capture zip.
- **D6** `storage_full` / `narration_truncated` / `video_ended_early` now render in `## ⚠ Capture
  issues` so the AI knows the bundle is partial.

## ✅ DONE 2026-06-19 — HARDENING Track C (analyze never-crash) — built + unit-tested (NO live verify)

The analyze pipeline (`pack.py`, `validate_bundle.py`, `check_coverage.py`, `transcribe.py`) is now
hardened to never crash / never hang on a malformed or untrusted bundle. 5 bisected commits, 165
python / 93 node green. Diagnosis + durable lessons in `learnings.md` 2026-06-19.
- **C1** (`326af59`) `build_context`/`build_pack` used unguarded `json.loads`/`read_text`. New
  `_load_json` (load + top-level type check vs default) + `_read_text` (errors="replace") chokepoint;
  all sub-shapes (timeline/manifest/HAR/errors/urls/tabs/frames) sanitised; `ms()` coerces non-numeric.
- **C3** (`f1dd7d0`) `nearest_frame` was O(events × frames). Now a cached sorted `(times, files)` index
  (memoised by object identity) + bisect → O(log n) per call.
- **C2** (`42f8d91`) `timeout=` added to both transcribe subprocesses (pack.py 1800s, ffmpeg 900s) so
  "never fatal" also covers hangs; `TimeoutExpired` caught → keeps the stub transcript.
- **C4** (`eb94fc1` guards + `3de3f23` lockstep) validator/coverage type guards (non-dict manifest,
  non-dict/non-numeric/bool timeline elements, non-string frame file, unhashable tab, non-UTF-8 files);
  validator JWT pattern realigned to redact.js (`{6,}` + optional 3rd seg) so a short JWT slips past
  nothing.

## ✅ DONE 2026-06-19 — HARDENING Track B (structured-sink redaction leaks) — built + unit-tested; NEEDS LIVE VERIFY

The three Track B items — secrets/PII reaching the STRUCTURED outputs (events.jsonl, timeline.json)
that get handed to other agents. 3 bisected commits, 93 node / 125 python green. Diagnosis +
durable lessons in `learnings.md` 2026-06-19.
- **B1** rrweb's `maskAllInputs` misses contenteditable / role=textbox → free-form text typed into
  Gmail/Slack/Notion landed verbatim in events.jsonl. Now masked via `maskTextSelector` + `maskTextFn`
  (new `src/mask-text.js`, mirrored into content.js) — snapshot AND typing mutations.
- **B2** `describe()` could pull a secret into `ctx.name`/`section` via `aria-labelledby`→textContent.
  New `redactCtx()` scrubs href+name+section at the worker chokepoint; content.js drops `ctx.name` on
  secret inputs.
- **B3** SPA `pushState`/hash changes emitted no `nav` event (content.js is popstate-only). The worker
  now emits a redacted nav for an in-place URL change (`navActions` → `emitnav`, gated on no status).
- **Live verify:** type into a contenteditable editor → `‹redacted›` in events.jsonl; click SPA routes
  → a nav per route in timeline.json (URL redacted); a secret input with aria-labelledby → ctx has no
  name/token.

## ✅ DONE 2026-06-19 — HARDENING Track A (silent data-loss) — built + unit-tested; NEEDS LIVE VERIFY

A 4-angle review (capture worker / content / analyze / AI-usability) found that the remaining
failure surface is concentrated in LONG/LARGE recordings and several failures are SILENT (REC shows,
keepalive runs, data is quietly lost). Track A (the silent data-loss class) is fixed — 5 bisected
commits (A1 `d8c8fc2`, A3 `b3d9eb2`, A2 `8babffa`, A4 `4beb3a9`, A5 `807759f`). Full diagnosis +
durable lessons in `learnings.md` 2026-06-19; the live-verify checklist + the B/C/D backlog are in
`to-do-current.md`.
- **A1** zip.js was 32-bit-only with a false "Zip64" comment → silent corruption past 4 GiB then the
  take is cleared. Now `makeZip` throws `ZIP_TOO_LARGE` (loss guard keeps the take).
- **A3** assembly pinned the whole video in heap → OOM on large captures. `makeZip` is async + takes
  the video as a Blob part (streamed for CRC, disk-backed output). Did NOT reintroduce FSA.
- **A2** IndexedDB quota failures were swallowed → silent truncation. Now surfaced (errors.json +
  badge `!` + `manifest.storage_full`); a `FRAME_CAP` bounds runaway disk.
- **A4** the crash snapshot could overflow storage and disarm recovery → capped + `unlimitedStorage`.
- **A5** no-instrumented-tab go-live + a mid-recording mic loss are now diagnosed
  (`manifest.narration_truncated`).
- **Live verify:** record a long capture → exports OR fails loudly with the take kept (never a corrupt
  zip); a normal capture still exports; clean manifest has `storage_full:false`/`narration_truncated:false`.

## ✅ DONE + LIVE-VERIFIED (2026-06-19) — 17-min recording never saved (the 64MiB sendMessage cap)

Adam recorded 17 min, hit Finish, nothing saved. Error: `runtime.sendMessage … Message exceeded
maximum allowed size of 64MiB`. **Root cause:** the export shipped the whole bundle (video + frames,
base64) through `chrome.runtime.sendMessage`, hard-capped at 64MiB; short clips fit, a 17-min one
didn't. The throw was only `console.error`'d → silent loss. The later 1-sec test's `start()` then
`clearAll()`'d the take → unrecoverable. Full diagnosis in `learnings.md` 2026-06-19.

**Fix (built + unit-tested, 72 node / 125 python green; LIVE-VERIFIED — a 109 MB capture downloaded):**
- **Assemble + save the zip in the OFFSCREEN doc**, not the worker. The video Blob stays there; the
  offscreen reads the bulk streams (timeline/events/frames) from IndexedDB itself, zips, and downloads
  via an object-URL `<a download>` (no size limit). Only small text meta files cross a message. New
  handshake: `offscreen-finalize`→`offscreen-finalized` (status only, no bytes),
  `offscreen-save`→`offscreen-save-done`. (`offscreen.js`, `background.js`.)
- **Shared pure `bundle-streams.js`** (`streamFiles`/`frameMeta`/`dataUrlToBytes`, 7 tests) used by the
  offscreen path AND the worker salvage path so they can't drift. `state.frames` keeps frame metadata
  only, so the worker builds the manifest without loading any PNG bytes. `db.count()` added.
- **Save path SIMPLIFIED to Downloads-only (Adam, 2026-06-19):** removed the File System Access folder
  picker AND the "ask where to save" native dialog. Every export now object-URL-downloads to the
  browser's Downloads folder — bulletproof, no size limit, no dialog. Deleted `fsdir.js`; dropped
  `saveMode`/`exportDirName`/`exportDirNeedsRegrant`; the popup Settings now just says "saved to
  Downloads." (Salvage path, offscreen gone, still uses `chrome.downloads` with a data URL.)
- **Loss guard (Adam's call):** the take is cleared ONLY after a save is confirmed. On failure the
  worker keeps IndexedDB + sets `unsavedTake`/`pendingExport` + badge `!`; the next Start is **blocked**;
  the popup shows a Retry / Discard banner (`retry-export` / `discard-take` commands). Still needs a
  live check (force a failure → badge `!`, Retry/Discard work, next Start blocked).
  Files: `extension/src/{offscreen.js,background.js,bundle-streams.js,db.js,popup.js,popup.html,i18n.js}`,
  removed `fsdir.js`.



## ✅ DONE (2026-06-18) — feedback round after the recovery verify (scope, pause-network, mic)

From Adam's Test-1 narration + decisions. All built + tested (65 node / 125 python green); the new
behaviors are chrome.*/DOM-dependent so they need a load-unpacked verify. Details in `learnings.md`.
- **Capture + overlay scoped to the recorded surface** (commit `a415aa2`) — offscreen reports the
  video `displaySurface`; `capture-scope.js` (pure, 5 tests) gates `instrumentTab`/`captureFrame`:
  tab share → only that tab, window share → only that window, screen → everywhere (multi-monitor
  display-scoping staged). Fixes the menu leaking onto windows that aren't in `video.webm`.
- **Pause now suspends network too** (commit `e5d27cd`) — the CDP handler ignored `state.paused`;
  network kept hitting `network.har` while paused (privacy + false CAPTURE-GAP warning). Fixed.
- **Mic permission granted inline in the popup** (commit `41aba3a`) — no separate window; the old
  `permissions.query` gate was unreliable and re-opened the window every Start. `mic-permission.*`
  now unused.
- **Decision: live with Chrome's "Stop sharing" bar** (can't hide browser chrome without dropping
  full-screen capture).

## ✅ DONE (2026-06-18) — recording survives a service-worker restart (lost-capture bug)

Adam lost a ~30 min recording: he paused (sharing one window) to work elsewhere, came back to a dead
overlay (couldn't pause/finish), the overlay in another window, and the take gone. **Root cause: ALL
recording state lived in the MV3 worker's in-memory `state`, and the worker is terminated after ~30s
idle — Pause stops the frame timer + event ingest, so the pause window is exactly when nothing keeps
it warm.** Full diagnosis in `learnings.md` 2026-06-18. Fix in 4 bisected commits:
- **Keepalive** — offscreen doc pings the worker every 20s while recording (prevents the death). No
  new permission. `offscreen.js`.
- **Frames → IndexedDB** and **HAR → IndexedDB** (were memory-only). `db.js` (v2, +`put`/`har` store),
  `background.js`.
- **Persist + rehydrate** — `session.js` (pure, 5 unit tests) mirrors the durable `state` slice to
  `chrome.storage.local`; on cold start `rehydrate()` resumes the recording (or salvages a video-less
  bundle if the browser was restarted). Commands `await` rehydration; the second-Start that used to
  `clearAll()` the take is now blocked. `background.js`.
- **`track.onended`** — a share that stops on its own is reported (errors.json + `manifest.video_ended_early`).

**✅ LIVE-VERIFIED (2026-06-18, Adam):**
- Test 1 (keepalive through a gap) — `capture-…17-45-27-904Z`: paused, switched windows, waited
  minutes, "still hasn't broken." Validates PASS, `errors.json` empty (worker never died).
- Test 2 (forced worker kill mid-recording) — `capture-…18-18-44-905Z`: `errors.json` has the
  `worker-restart … state recovered, capture resumed` entry at ~17s, capture continued, validates
  **PASS, 0 warnings**. Recovery confirmed end-to-end.
- Test 3 (second-Start guard) — confirmed "Already recording." behavior (no bundle artifact).
Tests 60 node / 125 python green. NEW follow-ups from these runs live in `to-do-current.md` (overlay
on non-recorded windows; pause doesn't pause network; share bar; mic-permission window).

## ✅ DONE (2026-06-18) — transcription "install once, automatic forever" hardening

Made the local-transcription install trustworthy on a recipient's machine (they clone the repo,
install once, record their own captures). Four fixes — details in `learnings.md` 2026-06-18:
- ffmpeg is now a **hard gate** in `setup.sh`/`setup.ps1` (was a silent warning).
- New `transcribe.py --selftest` verifies the ffmpeg+engine chain end-to-end AND pre-warms the model;
  setup runs it and only reports success if it passes. Auto-detects the installed engine.
- Stub `transcript.vtt` + `analyze/README.md` now explain the install-once / pack.py-fills-it flow.
- Tests: `tests/test_selftest.py`; full suite **125 python / 55 node** green.
Not yet committed at time of writing — bisect into logical commits (background stub, transcribe
selftest, setup gates, README, tests).

## ✅ VERIFIED (2026-06-18, live-run #4) — password-field redaction

`Downloads/capture-2026-06-18T14-31-57-860Z.zip` (eulerapp.com signin, fake creds): a password
typed into an `inputType: password` field was masked everywhere —
- `timeline.json` input event → `value: "‹redacted:secret›"` (email field → `‹redacted:email›`);
- `network.har` → no cleartext password param (Euler encrypts login client-side; login failed anyway).
Field redaction (rrweb `maskAllInputs` + `content.js` `maskValue`/`isSecretInput`) confirmed working.

## ✅ DECIDED (2026-06-18) — Chrome's "Stop sharing" bar: live with it

Earlier Adam wanted Chrome's `getDisplayMedia` share bar gone. **Decision 2026-06-18: live with the
bar.** It's browser chrome the extension can't hide; the only way to drop it is to abandon full-screen
`getDisplayMedia` capture for a `tabCapture`/activeTab path, which loses the cross-window/full-screen
video that's the point of v2. Not worth it. (This also closes the `activeTab`-drop reconciliation.)
Current open feedback lives in `to-do-current.md`: scope capture/overlay to the recorded surface
(headline); rebuild mic-permission in-window + persist. (Pause-pauses-network is DONE, commit e5d27cd.)

## ✅ VERIFIED (2026-06-18, live-run #3) — blocklist + recorder/mic

`Downloads/capture-2026-06-18T14-20-08-292Z` confirmed the live-run #2 fixes:
- **Blocklist works.** A 1Password tab visited during the run was correctly excluded — no
  `1password.com` host in `urls_visited`/`tabs`/`network.har`, no vault content anywhere. (The lone
  "1Password" string is the extension's autofill tooltip on an *allowed* page, not the vault.)
- **Recorder + mic healthy.** `video.webm` present (VP8+Opus), `narration_in_video: true`, empty
  `errors.json` — the 64MiB handoff + mic-timeout failures from live-run #2 did NOT recur.
- Noted while here: redaction does NOT cover secrets in page *body* content (e.g. an API key in a
  Google Doc) — documented gap, not fixed by design. See `learnings.md` 2026-06-18.

## ▶ NEXT (2026-06-18) — verify typed passwords in a form field are NOT captured

This checks the **field-redaction** path (distinct from the tab-exclusion path verified above). In a
recorded run, type a password into a real `<input type=password>` (and/or a field named like
`password`/`secret`/`token`/`api_key`). Then confirm the typed value never appears in the bundle:
- `events.jsonl` / `timeline.json` — the input value shows as `‹redacted:secret›`, never the
  cleartext (rrweb `maskAllInputs` + `content.js` `maskValue`/`isSecretInput`).
- `network.har` — if the form submits, the password isn't in the request body/URL in the clear.
- Reminder: the visual streams are NOT redacted — if the field unmasks on screen (a "show password"
  toggle), the cleartext is still visible in `video.webm`/`frames`. That's the documented limit.

Background: live-run #2's other fixes (pause clock, auto-transcribe, annotation fusion) are built +
unit-tested (node 55 / python 116 green). Set up transcription once with `bash analyze/setup.sh`
(Mac) — the `.venv` already exists on this machine and works.

---

---

# 🧪 TEST & REVIEW CHECKLIST — verify this session's changes

**If Adam asks "what needs testing/reviewing," walk him through THIS section.** Everything below
was built/changed this session (P2 annotations, P3 popup+countdown+folder, P4 auto-transcribe +
annotation rendering, a bug-hardening pass, and a security scan). Unit tests cover the pure logic;
the items here need a real Chrome run or a human eyeball because they're shadow-DOM / `chrome.*` /
visual and can't be unit-tested. Do them in order.

### Step 0 — Pre-flight (sanity, ~10s)
- [ ] `python3 -m unittest discover -s tests` → **183 passed** (1 skipped).
- [ ] `node --test tests/test_*.mjs` → **93 passed**.
- [ ] Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
      (If rrweb is missing, vendor it — see `extension/FIRST-CAPTURE.md` §0.)

### Step 1 — ONE recording session covers most of it
Open ~3 tabs (include one SENSITIVE tab, e.g. webmail/1Password, and add its host to the popup's
**Settings → "Never record on"** before starting). Set a download subfolder in Settings too. Then
Start and work across the tabs while narrating. Watch for:

- [ ] **P3 popup** — compact: the purpose field is open/prominent at top; blocklist + download
      folder + "ask where to save" live in a collapsed **Settings** section.
- [ ] **P3 countdown** — after the "Choose what to share" picker, a **3-2-1** shows in the active
      tab, THEN recording begins. The recording clock/overlay starts at the END of the count (the
      countdown seconds must NOT appear inside `video.webm`).
- [ ] **P3 blocklist enforcement** — switch into the sensitive (blocklisted) tab. It must NOT get
      the "this tab is being debugged" banner, and nothing from it should be captured.
- [ ] **P2 Selector** — click **Select** on the overlay pill → hovering outlines the element under
      the cursor → click marks it (blue box + ring, fades after ~3s).
- [ ] **P2 Draw** — click **Draw** → drag to draw a freeform stroke (fades after ~3s).
- [ ] **P2 controls** — **Esc** exits a tool; switching Select↔Draw works; both tools are **disabled
      while Paused**.
- [ ] **Arming robustness** — (a) double-click Start fast → only ONE "Choose what to share" picker
      should open; (b) optional: switch tabs during the 3-2-1 → capture should still attach to the
      tab you end on (not silently capture nothing).
- [ ] Finish & export.

### Step 2 — Inspect the exported bundle
- [ ] **P3 download folder** — the `capture-*.zip` landed in `Downloads/<your subfolder>` with NO
      "Save as" dialog (because "ask where to save" was off).
- [ ] `python3 analyze/validate_bundle.py <zip>` → **PASS**, "redaction check passed", "capture
      coverage OK". (This also exercises the hardened validator + redaction.)
- [ ] **Tab-scope + blocklist** — open `manifest.json`: `tabs` and `urls_visited` list ONLY the tabs
      you actually entered, and NOT the blocklisted/sensitive tab.
- [ ] **P2 events present** — `timeline.json` contains `annotation:select` (with `selector` + `ctx`)
      and `annotation:draw` (with `points`/`bbox`); a `frames/*.png` shows your mark.

### Step 3 — Build the pack (P4 rendering + auto-transcribe)
- [ ] `python3 analyze/pack.py <bundle-dir> --out <pack>` then read `<pack>/context.md`:
      a **`## ✦ Annotations`** section lists what you marked; the marks also show in the **Steps**
      and **Timeline**. Open **`<pack>/frames-annotated.html`** — the selected element is boxed in
      BLUE and the freeform draw is traced as a blue line.
- [ ] **P4 auto-transcribe** — if the bundle's `transcript.vtt` is a stub: with the `.venv` active
      (so ffmpeg + the ASR engine exist) it should auto-fill the transcript; on bare `python3`
      (no engine) it should print a "skipping/failed — run transcribe.py" note and still build the
      pack (NEVER crash). Either outcome is correct.

### Step 4 — Review (no test, just decisions)
- [ ] **Security scan** — read `SECURITY-SCAN.md` (repo root, untracked). All code findings are
      fixed; 4 low-severity residual recommendations are in `to-do-current.md` → "Security
      follow-ups" (remove offscreen WAR, pin/audit deps, hash rrweb, drop `activeTab`). Decide which
      to action.
- [ ] **Mic prompt** — if Chrome asks for the mic every recording, that's the one-time grant not
      sticking (chrome://settings/content/microphone should list the extension as Allowed; macOS
      Privacy → Microphone → Chrome ON). The "Choose what to share" picker is separate and always
      appears. (Offer to harden the popup's permission pre-flight if it's nagging.)

**What's lower-risk (already unit-tested, but a live run confirms no regression):** the redaction
hardening (form-body/provider-key/fragment/`ctx.href`/`tab.title`), `drawGeom` math, nav-policy,
pack.py annotation rendering, auto-transcribe gating. **What has NO unit test (live is the only
check):** the overlay pill, Selector/Draw tools, the countdown, the popup, the arming handshake,
blocklist enforcement, the preset-folder download.

---

## ▶ NEXT — one live-Chrome run verifies P2 (Selector + Draw) + P3 (popup, countdown, preset download folder) + the tab-scope change. Then the only code left is P4's auto-transcribe + small follow-ups.

## ✅ P3 (popup → compact dropdown + Settings + countdown) — CODE DONE; needs live verify (2026-06-17)

- **Popup** compacted into collapsible `<details>` sections — purpose stays open/prominent (it
  seeds the agent's context), blocklist + a new **download folder** + **"ask where to save"**
  toggle moved into a collapsed **Settings** section. (`popup.html`/`popup.js`.)
- **Preset download folder:** export now drops into `Downloads/<subfolder>` with no Save dialog
  unless "Ask where to save each time" is on. Subfolder is sanitised (relative-only; no `..`) in
  both popup and worker (`cleanSubfolder`). (`background.js` `getSettings`/`stop`.)
- **Countdown:** a 3-2-1 in the active tab AFTER the picker, BEFORE capture goes live, via a
  picker→countdown→go handshake (offscreen `offscreen-armed` → worker holds `recording=false`,
  runs the countdown, then `goLive()` sets t0 + instruments + `offscreen-go` starts the recorder).
  Nothing is captured during the pre-roll; data-only fallback (cancelled picker) preserved.
  (`background.js` arming/`runCountdownThenGo`/`goLive`, `offscreen.js` deferred `start()`,
  `content.js` `countdown`.) Details + the two gotchas in `learnings.md`.

## ✅ P4 (analyze-side annotation rendering) — DONE + unit-tested (2026-06-17)

`pack.py` now renders the P2 `annotation:select` / `annotation:draw` events (before this they
were raw-JSON dumped). A dedicated `## ✦ Annotations` section in `context.md` surfaces them up
top; both also render in the Steps procedure and the raw Timeline. `frames-annotated.html` draws
the selected element's box+ring in blue and traces the freeform stroke as an SVG polyline (points
are already viewport-%, so they map straight onto the screenshot). Unit-tested:
`tests/test_annotations.py` (13). Details in `learnings.md`. The remaining P4 item (auto-run
`transcribe.py` at pack/export) is unrelated and still open. Possible small follow-up: mention the
`annotation:*` events in the in-zip `bundle-docs.js` self-driving docs (raw-zip path).

## ✅ P2 (Selector + Draw annotations) — CODE DONE + unit-tested (2026-06-17)

Two separate tools on the overlay pill (`Select` / `Draw` buttons), usable mid-recording, in
the `annotate` IIFE in `content.js`. Both render on-screen (canvas stroke + element outline,
fade after ~3s, so the mark shows in `video.webm`) AND emit a structured timeline event:
- **Selector** snaps to the DOM (`selectorFor()` + `describe()`) → `annotation:select`
  (selector + semantic label + element rect) so user & agent align on the same element.
- **Draw** is freeform → `annotation:draw` (`{points, bbox, viewport}` as %-coords via
  `drawGeom`) so the analyst gets "user circled here".
The worker grabs a frame at emit time (`annotation:*` added to the click/nav frame trigger) so
`frames/` holds the annotated screen. Pure geometry is `extension/src/annotate-geom.js`
(tested, `tests/test_annotate.mjs`, 7 tests) mirrored into `content.js`. Three gotchas captured
in `learnings.md`. **Live-Chrome verify is the sign-off** (see P2 in `to-do-current.md`).

## ✅ P1 + P1b live-verified (2026-06-17, `outputs/capture-…18-23-37-835Z.zip`)

Clean run: `validate_bundle.py` **PASS, 0 warnings, "capture coverage OK"**. 18 navs across
16 tabs; on the active tab content capture continued past the mid-session navs (1.25, 1.54min)
to the end (1.74min) — the nav bug is fixed. Frames regular (~2.5–3.6s, the 3s timer). Adam
confirmed the on-screen overlay (4-button pill) looked good. narration_in_video true.

## ⚙ SCOPE CHANGE done (capture only tabs the user enters) — RE-VERIFY AFTER P2

That same run exposed that v2 captured **all 16 open tabs**, not just the 3 used (incl. a
1Password signin + Telegram). Adam's call: capture only tabs the user **enters**. Implemented
(see `learnings.md`): `start()` instruments just the active tab; `tabs.onActivated` lazily
instruments tabs as you switch in; `is-recording` is now per-tab so untouched tabs stay inert.
Unit-tested (nav-policy), but **live re-verify is still pending — Adam will do it AFTER P2**:
record a 3-tab task with other sensitive tabs open → the bundle's `manifest.tabs` +
`urls_visited` should list only the tabs actually used (no 1Password/Telegram/etc.).

## ⚠ P1b — capture died on navigation (FIXED + live-verified above)

A real 6-min session lost ~4.5 min of DOM + visual capture: on a server-rendered app, the
first full-page navigation tore down the content script while the CDP debugger kept network
flowing — so clicks/rrweb/frames stopped at 1:43 but network ran to 5:53, and the bundle still
"validated." Root cause + fix in `learnings.md`. **Fix (done):** worker re-arms the content
script on every navigation (`reattachTab` via `tabs.onUpdated`; gating in pure `nav-policy.js`,
unit-tested); content-script self-attach now retries; frames moved to a 3s timer (decoupled
from DOM events). **Diagnostic:** `analyze/check_coverage.py` detects the signature on any
bundle (FAILs the original bad one). **Sign-off:** re-record the distru-freemium flow and run
`python3 analyze/check_coverage.py <bundle>` → must PASS. This shares the same live run as P1.

## ✅ P1 (overlay) — DONE + live-verified

Shadow-DOM pill (the `overlay` IIFE in `content.js`) shows Finish / Pause / Restart / Cancel
during recording, in every instrumented tab, kept in sync by the worker (`broadcastOverlay()`
pushes `{recording, paused, t0}`). Worker-side semantics in `background.js`
(`pause/resume/restart/cancel`), mirrored onto the offscreen MediaRecorder
(`offscreen-pause/-resume/-restart/-cancel`). Restart reuses the live getDisplayMedia tracks
(no re-prompt) and re-inits rrweb per tab so the new take keeps a base snapshot. Restart/Cancel
take a 2-click confirm. Adam confirmed it on screen and liked it.

## ▶ NEXT — live-verify P2, then build P3

P2 (Selector + Draw) is built + unit-tested (see the P2 section above). Next: the live-Chrome
sign-off for P2 (load unpacked, record, exercise both tools, confirm `annotation:select` /
`annotation:draw` land in `timeline.json` and the mark shows in a frame — full steps in the P2
block of `to-do-current.md`). Then build **P3** (popup → compact dropdown + Settings panel for
the host blocklist + preset download folder + countdown), then **P4** analyze-side rendering of
the annotation events. **Adam also live-re-verifies the tab-scope change** (see the SCOPE
CHANGE section above) — it can ride along with the P2 verification run.

**P0 (self-driving zip + audio fix) remains DONE + live-verified.** Every export embeds
`CLAUDE.md` + `AGENTS.md` (from `extension/src/bundle-docs.js`) with the read order, analysis
procedure, and the audio-recovery fallback (stub transcript → Opus track in `video.webm`,
recover with ffmpeg + local ASR; the docs now also include the `uv pip install mlx-audio`
setup step). Tests (whole repo): node 30 (redact + bundle-docs + nav-policy) + python 80
(incl. `test_check_coverage.py` + `test_validate_coverage.py`) all green.

Why P0 was needed (verified): the raw zip's README pointed at `../analyze/pack.py` (a path a
recipient won't have); the self-driving layer only existed in the *pack*, not the zip; and
`pack.py` doesn't copy `video.webm` into the pack (`RAW_FILES`, line 35), so a pack built from
a stub-transcript bundle lost the narration entirely. See `learnings.md` and P4b.

## ✅ Done — entire-screen + app-switch run verified, feedback captured

The entire-screen + app-switch test is **done and confirmed**: `outputs/capture-2026-06-17T14-36-28-587Z.zip`
**validates PASS** (263 events, `video.webm` 48 MB with an Opus mic-narration audio track,
`errors.json` empty). Frames confirm the video captured the **whole screen across both
Chrome and Comet** (a second browser without the extension). The app-switch is visible
in the video only — structured DOM/click/network capture covers instrumented browser
tabs, as designed.

**Adam's feedback on the tool is now captured** in `to-do-current.md` (the "🎯 ADAM'S
FEEDBACK" block) — transcribed from his narration. Headline asks: compact dropdown popup;
move blocklist + download-folder into Settings; countdown; face-cam bubble; an on-screen
overlay (Finish/Pause/Restart/Cancel, no rewind/trim); and — the big one — **two separate
annotation tools, Selector (element-snapping, for user↔agent alignment) and Draw (freeform
region highlight)**, plus an element-aware Blur. Reference UI he likes: the Loom extension.

_Transcription note: the v2 `.venv` was absent on this machine, so the narration was read
with a throwaway faster-whisper env. The product's `transcribe.py` (parakeet/qwen default)
is unchanged; it reuses model weights already on disk and does not depend on TypeWhisper running._

## What this is

v2 of `browser-activity-capture`, forked from the working v1 tool (which lives in
its own repo, untouched). Two things changed in v2:

**Capture model** — from **one pinned tab** to **full-screen video + all-tabs
instrumentation**: records the whole screen (follows you across tabs/windows) and
attaches the CDP debugger + content script to every eligible tab, including tabs
opened mid-recording. Events are tagged with their source tab; `pack.py` renders a
tab legend + tab-switch markers.

**Self-driving pack** — the analysis pack now ships the skills a receiving agent
uses, in `agent-skills/`: `analyze-capture` (the consumption procedure — read it
first) always, plus activity skills mapped to the recording's purpose. Seed skills: `ui-improvement` (friction → concrete UI changes, *implemented* when the
app's source is present) and `competitive-research` (teardown of another product — UX
patterns + architecture from the network → `research.md`). Extend by adding a skill to
`analyze/skills/<name>/` and a `SKILLS_FOR_PURPOSE` mapping in `pack.py`.

Purposes available: skill, docs, ux, ui, improve, research, general.

**Intent capture** — to make the bundle 10x more legible to the analyzing model:
a stated **task goal**; a required **purpose** (skill / docs / ux / improve / general)
that renders a steer block at the top of context.md so the *same* recording yields a
skill, a doc, UX feedback, or an efficiency teardown depending on why it was recorded;
**semantic element context** (accessible name / role / section, so "click button
'Issue refund' in 'Order actions'" not a selector); a **narrated procedure**
(`## Steps`, segmenting the timeline and binding narration to each step); and **frame
linking + a `frames-annotated.html`** drawing the click point + element box on each
screenshot.

The `analyze/` pipeline (validate → transcribe → glossary → pack) is inherited from
v1 and works the same; it now also renders the multi-tab data.

## Status — two live runs done (2026-06-17): capture + video work; redaction closed

Two real-Chrome runs in (Adam's machine). Results — see `learnings.md`:
1. **✅ Multi-tab / all-tabs instrumentation (RISK 2) works.** 3 tabs tagged +
   instrumented; a tab opened mid-recording got instrumented too.
2. **✅ Video works (RISK 1 fixed, confirmed run 2).** `desktopCapture`-from-worker
   was a dead end (no picker; streamId also not consumable in offscreen → "Invalid
   state"). Rebuilt on `getDisplayMedia()` inside the offscreen doc (reason
   `DISPLAY_MEDIA`) — Chrome's recommended MV3 path; **Start stays in the popup**,
   dropped the `desktopCapture` permission. Run 2: Start → "Choose what to share" →
   12 MB `video.webm`, `errors.json` empty. (A first recorder-page attempt was the
   wrong layer and was reverted.)
3. **✅ Redaction closed across all three URL sinks.** The same `?jwt=` token leaked
   in run 1 (`timeline.json`+`network.har`) and again in run 2 (`events.jsonl`, the
   rrweb DOM stream, via `<img src>`). Fixed: `redactUrl()` at the worker URL sinks +
   `scrubNode()` on every rrweb node. `validate_bundle.py` gated both. Locked by
   `tests/test_redact.mjs` (7 tests).

**✅ End-to-end PASS (run 3, `outputs/v2-test-2-jwt-fix.zip`).** First fully-clean
bundle: `validate_bundle.py` PASS (0 warnings), zero tokens in timeline/HAR/events.jsonl,
`video.webm` present, `errors.json` empty, 267 timeline events. v2 capture + video +
redaction are all live-verified. (Runs 1 & 2 were pre-fix and still fail, as expected.)

Analyze side: 70 python tests + 6 node redact tests, all green.

## How to run it

1. **Load**: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
   (Vendor rrweb first if missing — see `extension/FIRST-CAPTURE.md` §0.)
2. **Record**: open a few tabs → popup → set task/purpose → **Start** → **choose a
   screen** in Chrome's "Choose what to share" dialog → work across tabs, narrate →
   Stop & export → `capture-*.zip`.
3. **Validate**: `python3 analyze/validate_bundle.py <zip>`
4. **Transcribe** (local, needs the `.venv` — see `analyze/README.md`):
   `.venv/bin/python analyze/transcribe.py <bundle-dir>` (default parakeet; auto-runs
   the glossary post-pass).
5. **Pack**: `python3 analyze/pack.py <bundle-dir> --out <pack>` → read
   `<pack>/context.md` (look for the `## Tabs` section + `━━━ tab #N ━━━` markers).

## Tests

A hardening pass (2026-06-17) fixed real bugs found by independent review — see `learnings.md`:
redaction sink-consistency (form-body card/cvv/ssn/jwt/sig leak, lowercase/url-encoded bearer),
the blocklist only suppressing HAR (now blocks instrumentation), capture-start races (arming lock
before await, goLive re-resolves the active tab, offscreen reset), frames-annotated.html coord
injection, maybe_transcribe never-fatal, and validator annotation-kind recognition.

A security scan (2026-06-17) followed — two adversarial audits (redaction-bypass; egress/
permissions/injection). Extension confirmed **local-only** (no exfiltration path). Fixed: broadened
the value-shape redaction to high-confidence provider keys (AWS/Stripe/GitHub/Google/Slack/OpenAI/
Anthropic/PEM) + validator lockstep; `redactUrl` now masks the #fragment + `user:pass@`; `ctx.href`
and `tab.title` are redacted; the validator now scans manifest/errors/transcript; path-traversal on
the analyze side (`manifest["video"]`, frame `file`) basename-stripped; documented that frames/video
aren't pixel-redacted. Residual low-severity recommendations are in `to-do-current.md` ("Security
follow-ups"). See `learnings.md` for the full list.

`python3 -m unittest discover -s tests` — 183 tests (glossary, network-noise collapse,
multi-tab rendering, semantic labels + step segmentation + frame annotation, purpose steer,
bundled skills incl. competitive-research, coverage diagnostic, `test_annotations.py` (13):
annotation:select/draw in the timeline, steps, the `## ✦ Annotations` section, and the
frames-annotated.html marks; and `test_autotranscribe.py` (12): the stub-detection + the
best-effort auto-transcribe gates, transcriber mocked; plus the later hardening tests —
`test_pack_robust.py`, `test_nearest_frame.py`, `test_validate_robust.py` (Track C never-crash),
`test_ai_usability.py` (18, Track D — API-calls table / de-dup / events.jsonl demotion / partial
flags) and the Track A/B additions). Stdlib only, all green.
`node --test tests/test_*.mjs` — 93 tests: redact (URL/value/form-body/case/provider-keys/
fragment, 13), nav-policy, bundle-docs, `test_annotate.mjs` (7, the Draw `drawGeom` math), plus the
Track A/B suites (zip, bundle-streams, mask-text, capture-scope, clock, session, blocklist). The content.js
unique-selector AND semantic-context (`describe()`) logic is verified in real Chromium via
`tests/browser/selector-harness.html` (browser, not unittest) — `allUnique`, `allIdentify`,
and `allCtxPass` all true. The overlay + annotation tools are shadow-DOM + chrome.* dependent,
so their live behavior has no unit test (needs a load-unpacked run — see P2 verify steps).

## Exact next step — one live-Chrome run verifies P2 + P3; re-verify tab-scope too.

P1 + P1b are live-verified (see top). P2 (annotations), P4 (rendering), and P3 (popup/countdown/
folder) are built + unit-tested where possible. The remaining sign-off is interactive (DOM +
chrome.*-dependent, no unit test): see the P2 and P3 live-verify checklists in
`to-do-current.md`. The tab-scope change rides along on the same run. Files touched this session:
- **P2 (annotations):** `content.js` (`annotate` IIFE + mirrored `drawGeom`; two overlay
  buttons + `syncTools`; `onClick`/`emitDwell` guards), `extension/src/annotate-geom.js` (new,
  pure), `background.js` (annotation kinds added to the frame trigger), `tests/test_annotate.mjs` (new).
- **P4 (analyze-side rendering):** `analyze/pack.py` (`_draw_region`; timeline + steps cases;
  `_point_card`/`_draw_card` split in `build_annotated_frames_html` with blue `.sel` + SVG ink;
  `## ✦ Annotations` section in `build_context`), `tests/test_annotations.py` (new, 13).
- **P3 (popup/Settings/folder/countdown):** `popup.html` + `popup.js` (compact `<details>`
  layout, Settings section, folder + ask-save), `background.js` (`getSettings`/`cleanSubfolder`,
  download into `stop()`, the arming/countdown lifecycle: `start()` rewrite +
  `runCountdownThenGo`/`goLive` + `offscreen-armed` handler + status `arming`),
  `offscreen.js` (deferred recorder start via `offscreen-go`, `offscreen-armed` signal),
  `content.js` (`countdown` overlay module).

Prior sessions:
- **Tab-scope change:** `background.js` (`start()` active-tab-only, `onActivated` lazy
  instrument, per-tab `is-recording`), `nav-policy.js`, `tests/test_nav_policy.mjs`.
- **P1b (capture-on-nav fix):** `background.js` (`reattachTab`, `onUpdated` listener, 3s
  `startFrameTimer`/`stopFrameTimer`), `nav-policy.js`, `content.js` (retrying `selfAttach`),
  `analyze/check_coverage.py` (diagnostic, wired into `validate_bundle.py`).
- **P1 (overlay):** `content.js` (`overlay` IIFE + `restartCapture`/`startRrweb`),
  `background.js` (`broadcastOverlay` + `pause/resume/restart/cancel` + `overlay-command`),
  `offscreen.js` (MediaRecorder pause/resume/restart/cancel, retained `activeTracks`).

After the P2 verify: build **P3** (popup → dropdown + Settings), then **P4** analyze-side rendering.

## Known caveats

- The screen picker may steal focus and close the popup — by design; the worker
  runs `start()` independently, so recording still proceeds.
- Restricted pages (`chrome://`, web store, etc.) are skipped, not instrumented.
- v1's mic-grant flow is unchanged and still required for narration.
