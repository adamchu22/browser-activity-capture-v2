# To-do (current) — v2

v2 reworks capture to **full-screen video + all-tabs instrumentation** and adds an
**intent-capture layer** (stated task goal, semantic element context, narrated-step
segmentation, frame annotation / "draw on screen"). Code is built and unit-tested
(190 python / 113 node; DOM capture also harness-verified); the extension still needs a live-Chrome
run. Completed v2 work is in `to-do-completed.md`; inherited v1 work is in the v1 repo.

## ✅ Done 2026-06-23 — machine-local pointer so a raw zip finds the pipeline (Step 0) — built + unit-tested

Adam hands the raw zip from a different repo, so the agent couldn't reach `pack.py` and the zip's
docs told it to self-drive instead of building the `context.md` spine. Fixed (246 python / 116 node
green; details in `handoff.md` + `learnings.md` 2026-06-23):
- [x] `analyze/install_pointer.py` — writes/reads `~/.config/browser-activity-capture/install.json`
      (`analyze_dir` + `.venv` python + `pack_cmd`); degrades to None. `tests/test_install_pointer.py` (10).
- [x] `setup.sh`/`setup.ps1` register the install after the venv selftest.
- [x] `bundle-docs.js` README + CLAUDE.md/AGENTS.md lead with **Step 0** (adjacent pack → pointer →
      register-then-build → self-drive fallback); `test_bundle_docs.mjs` updated.
- [x] Verified end-to-end (temp `XDG_CONFIG_HOME` → read pointer → `pack_cmd` → 765-line `context.md`).
- [ ] Eyeball Step 0 in the next exported zip's README/CLAUDE.md (doc-string-only change, no unit test
      for the zip-write path). The bigger automation — autopack-on-download — is the PLANNING task
      below; this pointer is its shared foundation.

## ✅ Done 2026-06-23 — PACK FINALIZE UPGRADE (from the external agent's review) — built + unit-tested

Acted on an external agent's review of a real bundle. Key reframe: `pack.py` already does the
stream-fusion the review asked for, but (a) it never travels with the bundle (recipient gets the
raw zip, not a pack) and (b) two genuinely-new analyses didn't exist anywhere. Adam's delivery
call: **"hand the pack, not the raw zip"** — so all new value went into `pack.py`, and a runner
makes a pack for every new zip. 235 python / 113 node green. Durable notes in `learnings.md`
2026-06-23.
- [x] **Frame-index integrity (`health.json`)** — the review's strongest find: a worker restart
      can leave `manifest.frames` indexing only the frames AFTER it while ALL frames are on disk,
      so a tool trusting the manifest silently loses visual ground truth. Frame filenames ARE the
      ms offset, so the index is rebuilt from disk losslessly (`analyze/health.py`
      `frames_on_disk`/`canonical_frames`/`build_health`). `build_context` + `build_pack` now use
      the disk-rebuilt list; `## ⚠ Capture issues` surfaces the manifest-vs-disk reconciliation +
      visual gaps; `health.json` ships in the pack. (`tests/test_health.py`.)
- [x] **Intent → `todos.json`** — classifies each narration utterance (bug / to-do / question /
      praise / research / decision) and attaches the element / frame / endpoint around it
      (`analyze/todos.py`). Heuristic + stdlib-only (no model, no network — preserves pack.py's
      no-provider-lock-in). Rendered as a `## ✦ To-dos & intent` section up top + full list in
      `todos.json`. Framed as a DRAFT to confirm. (`tests/test_todos.py`.)
- [x] **Computed `friction.json`** — long pauses, rage/repeat clicks, retried actions, error-shaped
      UI labels + non-2xx responses (`analyze/friction.py`). The ux-purpose deliverable, pre-baked.
      Summary in a `## ⚠ Friction signals` section + full detail in `friction.json`.
      (`tests/test_friction.py`.)
- [x] **Auto-pack runner (`analyze/autopack.py`)** — point it at a location and it builds a pack
      for every new capture zip (idempotent, best-effort per zip, Zip-Slip-guarded). `--watch`
      polls; per-user locations in git-ignored `autopack.config.json`. This is the "runnable for
      every new zip by calling the location" piece. (`tests/test_autopack.py`.)
- [x] **Recovery-command bug fix** — the embedded narration-recovery command in `bundle-docs.js`
      was missing `--output-path` (fails on first run, as the review found); aligned to
      `transcribe.py`'s real invocation + writes `transcript.vtt`. A drift-guard test
      (`tests/test_recovery_command.py`) asserts the doc command keeps `--output-path`/`--format
      vtt`/the same model id as `transcribe.py` so it can't silently diverge again.
- **Deliberately NOT built** (review over-reach): a parallel `finalize.py` (would fork pack.py's
      ~1,100 tested lines → drift), cross-session dedup/trend system, in-recorder todo-triage loop,
      event-only frames. See `learnings.md` 2026-06-23 for the full adjudication.
- [ ] **▶ NEXT — re-run the external review as a TEST (against the PACK, not the raw zip).** Validate
      the upgrade the same way the problem was found: produce a fresh bundle → `python
      analyze/autopack.py <folder>` → hand the `*-pack/` to a fresh agent → confirm it does NOT pay
      the original "agent tax": `todos.json` already carries the intent, `friction.json` the
      pauses/rage-clicks, `health.json` says the frame index is trustworthy, `context.md` needs no
      manual stream-join. Any tax it STILL pays = the next thing to build. Doubles as the deferred D7
      (a curated demo bundle for `analyze/example-output/`).

## ▶ IN PROGRESS (PLAN DONE + STEPS 1–2 DONE 2026-06-24) — install on a new computer so captures auto-pack locally

**▶ Plan is written + scoped: `PLAN-autopack-install.md` (repo root).** Decisions locked (Adam
2026-06-24): packs **beside each zip**; **macOS first** (launchd, live-verify on Adam's Mac),
Windows/Linux scaffolded-but-untested; trust boundary = "anything capture-shaped in your own
Downloads"; **opt-in** at setup. Build order below; Steps 1–2 done (all pure Python), **Step 3
(macOS launchd install) is next — the first live-verify on Adam's Mac.**

Two facts that reshaped the original assumptions (found while scoping): the extension downloads
**flat to the browser's Downloads dir** (no subfolder anymore — `background.js`
getSettings/exportFilename), and autopack's old idempotency marker ("does `-pack/` exist") broke on
an interrupted build (now fixed by R1 atomic finalize, Step 1). Top predicted breakage still ahead:
**ffmpeg not on PATH in the launchd/Task-Scheduler minimal env** → silent stub transcripts (→ bake
the abs ffmpeg path into the trigger env, Step 3). Full failure-mode list (F1–F10) in the plan.

- [x] **Step 1 DONE 2026-06-24 — autopack robustness (pure Python, unit-tested).** All landed in
      `analyze/autopack.py` + `tests/test_autopack.py` (252 python / 116 node green; 15 autopack
      tests). R1 atomic builds (build into `.tmp` sibling → `os.replace`, so an interrupted build
      never leaves a half-pack the idempotency check skips forever; orphaned `.tmp` swept under the
      lock). R2 single-instance lock (`acquire_lock`, flock/msvcrt, auto-released on exit — service
      + manual `--watch` can't race). R3 failure memory + backoff (`autopack.state.json`, give up
      after MAX_ATTEMPTS=3; key includes size+mtime so a re-download retries fresh; success clears
      it). R4 skip-fresh (`--min-age`, default 10s). R6 zip-bomb cap (4 GiB uncompressed) +
      oversized-manifest guard. D4b tightened detection (filename `capture-*.zip` AND a manifest
      with `capture_id`+`t0_wall`). `--watch` default interval 30s→60s. State/lock dir is XDG-aware
      via `install_pointer.config_home()`.
- [x] **Step 2 DONE 2026-06-24 — `--once`/`--status` flags + rotating `autopack.log` (pure Python,
      unit-tested).** All in `analyze/autopack.py` + `tests/test_autopack.py` (257 python / 116 node
      green; 20 autopack tests, +5). `--once` = explicit single pass (what the OS scheduler runs;
      errors if combined with `--watch`). `--status` is **read-only / lock-free** (works while the
      service is mid-pass) and reports from the state file: where we're watching + each folder's
      newest-capture age, when the service last ran and with what counts, and any zips still
      failing / GIVEN UP (attempts ≥ MAX). Every pass now stamps `state["last_run"]` (time + counts)
      for liveness; a pass that did work also appends one grep-able line to a rotating `autopack.log`
      (`MAX_LOG_BYTES` 1 MiB → one `.log.1` generation), while idle passes stay silent so a 60s
      service can't spam it. `run()` gained a `log_file=` param (None ⇒ no log line, so existing
      tests don't touch the real log dir).
- [ ] **Step 3 — macOS launchd install** (`service.py --install/--uninstall`, ffmpeg-abs-path in the
      plist env per F1, setup.sh prompts + write `autopack.config.json`). **Live-verify on Adam's Mac.**
- [ ] **Step 4 — docs** (first-time setup, change locations, trust boundary, re-run-after-moving).
- [ ] **Step 5 (gated on demand) — Windows Task Scheduler + Linux systemd**, each its own live verify.

Goal (Adam): a user sets this up ONCE on their machine and from then on every recording they make
is **automatically turned into a pack by their own local install**, in their own locations — no
manual `pack.py`, no us. The pieces exist (`autopack.py` + `autopack.config.json` + the `.venv`
transcribe setup + the new `install_pointer.py`); what's missing is the one-time install that wires
them into a background service.

**Why this is the last piece (2026-06-23):** the zip docs now lead with Step 0 — an agent builds the
`context.md` spine itself via the machine-local pointer. This task makes it zero-effort: a watcher
pre-builds `…-pack/` **beside each new zip in Downloads**, so Step 0 hits case 1 (adjacent pack) and
the agent reads `context.md` directly without even running `pack.py`. Quick interim (no service): run
`python analyze/autopack.py ~/Downloads --watch` by hand. The plan below is the reboot-proof version.
**SCOPE IT FIRST — this is a "Building Full" task, not a quick script.** A plan must cover:
- **Trigger mechanism** per-OS: macOS `launchd` (LaunchAgent) vs `autopack.py --watch` vs a folder
  watcher; Windows Task Scheduler / a service; Linux systemd user unit. Decide watch-loop vs
  event-driven, and the poll interval.
- **Per-user config** — `setup.sh`/`setup.ps1` should prompt for / write `autopack.config.json`
  (watch dir = the extension's download folder; packs_dir = where they want packs), and verify the
  download folder matches the extension's Settings.
- **Transcription dependency** — the auto-pack needs the `.venv` (ffmpeg + ASR) to fill narration;
  fold the existing `analyze/setup.sh` selftest/pre-warm into this install so a fresh machine is
  ready end-to-end.
- **Idempotent install + uninstall**, logging (where do autopack errors go?), and what happens on
  laptop sleep / login.
- **Security** — a background process that auto-extracts zips from a Downloads folder (Zip-Slip is
  already guarded in `pack_zip`, but the install story should state the trust boundary).
- **Docs** — a "first-time setup on a new computer" section + how to change locations later.
- Open question: does this stay manual-trigger-friendly (run by hand any time) AND offer the
  service, or service-only? (Lean: keep the manual entrypoint, add the service on top.)
This dovetails with the existing CONNECTOR/MCP idea (let an AI trigger a capture) — but that's a
separate task; this one is purely local auto-pack-on-download.

## ▶ TODO 2026-06-23 — optional LLM pass to refine `todos.json` (enhancement, not required)

`todos.json` ships a stdlib-only heuristic draft today (keyword/shape classification). An OPTIONAL
LLM pass would catch IMPLICIT intent the keywords miss and de-noise false positives (e.g. a
declarative that trips a pattern). Build it like `analyze/adapters/run_claude.py`: off by default
(no API key required for the core), explicit opt-in, reads `todos.json` + `context.md` and returns
a refined list with the same `{t, type, text, evidence}` shape. Must NOT become a hard dependency —
the no-provider-lock-in default is the whole point of the stdlib core.

## ✅ Done 2026-06-23 — overlay pill: draggable + collapse-to-readouts (NEEDS A LIVE CHROME VERIFY)

Adam asked to move the recording-controls bar and add a hide button that collapses it down to
just the timer + mic meter. Done in the `overlay` IIFE in `extension/src/content.js` (shadow-DOM
pill; no unit test — DOM/shadow + chrome.* dependent, consistent with the rest of the overlay).
- **Draggable** — `makeDraggable()` drags from any non-button area (buttons keep their own clicks
  via `e.target.closest("button")`). First drag switches the pill from CSS bottom-center
  (`transform:translateX(-50%)`) to explicit `left/top`; `placeAt()` clamps it inside the viewport.
  Uses pointer capture so a fast drag doesn't drop. Position is tab-local (resets on a full-page
  nav remount — acceptable; SPA navs don't remount).
- **Collapse** — a chevron toggle (`#collapse`) hides the seps + Select/Draw/Pause/Restart/Cancel/
  Finish via a `.collapsed` class, leaving the rec dot, timer, and mic meter. Re-clamps after the
  width change so a pill dragged to an edge stays on-screen. Chevron flips when collapsed.
- **Live verify (interactive — no unit test):** record → drag the pill around (it follows the
  cursor, stays on-screen, buttons still click); hit the chevron → collapses to dot+timer+mic,
  click again → expands; collapsing while docked at an edge keeps it visible.

## ✅ Done 2026-06-22 — documentation skill (illustrated docs + Notion option)

A `documentation` skill now ships in **every exported zip** at
`agent-skills/documentation/SKILL.md` and in the pack for the `docs` purpose. It tells the
analyzing agent to produce one illustrated how-it-works doc / SOP with screenshots (pulled
from `frames/`, recorder overlay cropped) + the user's highlights, flag that frames carry
real PII, and treat the Notion-import zip as an *optional* step (single-page structure: `.md`
at the zip root, `images/` beside it). Built + unit-tested (103 node / 190 python). Files:
`analyze/skills/documentation/SKILL.md`, `analyze/pack.py`, `extension/src/bundle-docs.js`,
`extension/src/background.js`, `tests/test_bundle_docs.mjs`, `tests/test_intent.py`. Details
in `learnings.md` 2026-06-22. **Live verify still needed:** export a zip and confirm it
contains `agent-skills/documentation/SKILL.md` (the zip-write path is `chrome.*`-dependent).

## ✅ Done 2026-06-22 — the rate/limit issue (screenshot rate-limit misclassified as storage-full)

**Resolved.** The "rate issue and limit" from the longer run was Chrome's `captureVisibleTab` ~2/sec
screenshot rate limit being **misclassified as "storage full."** Its error message contains the word
"quota" (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota`), and `noteWriteFailure`'s `/quota|storage/i`
classifier matched it — so a healthy 17.7-min recording got a red `!` badge, a false truncation error,
and `manifest.storage_full = true`. **No data was lost** (439 of 464 frames captured after the
"error"). Built + unit-tested (100 node / 188 python green). Diagnosis + the durable lesson ("never
substring-match 'quota' to mean disk-full") in `learnings.md` 2026-06-22.
- [x] **Split `captureFrame`'s try block** — the screenshot (`captureVisibleTab`) and the IndexedDB
      write (`db.append`) now have SEPARATE try blocks, so a rate-limit/`chrome://` screenshot failure
      returns early and never reaches `noteWriteFailure`; only a real IDB write failure does.
- [x] **Harden + extract the classifier** — new pure `extension/src/write-failure.js`
      `isStorageQuotaError(e)`: matches `name === "QuotaExceededError"`, EXCLUDES the
      `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` message, requires a real storage word in the message
      fallback (never bare "quota"). `noteWriteFailure` uses it. Unit-tested (`tests/test_write_failure.mjs`, 7).
- [x] **True storage-full path preserved** — a genuine `QuotaExceededError` still flips the badge `!`
      + `manifest.storage_full` (Track A2). The standalone issue writeup has been folded into this
      entry and the loose file removed.
- [ ] **Live verify (interactive, optional):** force rapid event frames → capture continues, NO `!`
      badge, `manifest.storage_full` stays `false`; a real IDB quota error still surfaces loudly.

## ✅ Done + LIVE-VERIFIED 2026-06-19 — 17-min recording never saved (the 64MiB sendMessage cap)

Adam recorded 17 min, hit Finish, nothing downloaded (a 1-sec test right after worked). Error:
`runtime.sendMessage … Message exceeded maximum allowed size of 64MiB`. The export moved the whole
bundle (video + frames, base64) through a message; Chrome caps messages at 64MiB, so only long
recordings failed — and the failure was swallowed (`console.error`), then the next take's `clearAll()`
overwrote it. Diagnosis + the durable MV3 lesson are in `learnings.md` 2026-06-19. Built + unit-tested
(72 node / 125 python green); **LIVE-VERIFIED — a 109 MB capture downloaded.**
- [x] **Assemble + write the zip in the offscreen doc** (video Blob never leaves it; bulk streams read
      from IndexedDB there; object-URL `<a download>`). Only small text crosses a message. New
      `offscreen-finalize`/`offscreen-save` handshake. **Verified (109 MB downloaded).**
- [x] **Shared `bundle-streams.js`** (offscreen + worker-salvage, can't drift) + `state.frames`
      metadata + `db.count()` so the worker never loads frame bytes.
- [x] **Save path SIMPLIFIED to Downloads-only (Adam):** removed the FSA folder picker + the "ask where
      to save" dialog; deleted `fsdir.js`; dropped `saveMode`. Every export downloads to Downloads.
- [x] **Loss guard:** keep the take until a save is confirmed; on failure block the next Start + show a
      popup Retry/Discard banner (`retry-export`/`discard-take`); badge `!`.
- [ ] **Remaining live check (low priority):** force an export failure → badge `!`, popup Retry/Discard
      work, next Start blocked until resolved. Hard to trigger by hand (only fires if a download/assembly
      throws); it's a defensive net, the happy path is verified.
- [x] **Mic re-checked OK (Adam, 2026-06-19)** — the one-off `microphone capture failed (video only)`
      from the bug run didn't recur; a normal mic check was clean (no regression from 2026-06-18).
- Note: the popup Retry/Discard banner is **English-only** (kept off the i18n surface as an error path).

## ✅ Done 2026-06-19 — HARDENING Track A (silent data-loss) — built + unit-tested; NEEDS LIVE VERIFY

From a deep 4-angle failure-mode review (capture worker / content / analyze / AI-usability).
Track A = the silent data-loss class (recording shows REC while data is lost). 5 bisected
commits, 82 node / 125 python green. Diagnosis + durable lessons in `learnings.md` 2026-06-19.
- [x] **A1 — zip.js fail-loud on >4GiB.** Was 32-bit-only (`setUint32`/`setUint16`) with a
      false "Zip64" comment → silent corruption past 4 GiB, then the take is cleared. Now a pure
      `zipOverflow()` guard makes `makeZip` throw `ZIP_TOO_LARGE`; the loss guard keeps the take.
- [x] **A3 — stream the video Blob into the zip (no OOM).** Assembly pinned the whole video in
      the JS heap (`arrayBuffer()`); `makeZip` is now async + takes a Blob part, CRC'd in 8 MiB
      slices, output disk-backed. Did NOT use FSA `createWritable` (would reintroduce the save
      dialog Adam removed). Residual: frame PNGs still load together — follow-up.
- [x] **A2 — surface IndexedDB quota exhaustion.** Quota failures were swallowed → capture
      truncates silently. Now `noteWriteFailure()` → sticky `storageFull` + errors.json + badge
      `!` + `manifest.storage_full`. Plus a `FRAME_CAP` (~5h) bounds runaway disk.
- [x] **A4 — bound the crash snapshot + `unlimitedStorage`.** The recovery snapshot's unbounded
      `errors`/`urls` could exceed the storage quota → a failed `set()` silently disarmed recovery.
      Capped (50/1000) + `unlimitedStorage` added + the failed `set()` is now surfaced.
- [x] **A5 — diagnose no-tab go-live + mid-recording mic loss.** goLive with no instrumented tab
      now logs; a mic track ending mid-recording is surfaced (`manifest.narration_truncated`).
- [ ] **LIVE VERIFY (interactive — no unit test):** (a) record a long/large capture (>4 GiB if you
      can) → it either exports OR fails loudly with the take kept (badge `!`, Retry/Discard) — never
      a corrupt zip; (b) a normal capture still exports (the async makeZip + Blob path); (c)
      `manifest.json` has `storage_full:false`, `narration_truncated:false` on a clean run; (d)
      revoke the mic mid-recording → `errors.json` notes it + `narration_truncated:true`.

## ▶ TODO 2026-06-19 — HARDENING backlog (Tracks B/C/D from the same review) — NOT yet built

Prioritized; pick a track and say "fix now" to action it (same batch-by-batch flow as A).

**Track B — redaction leaks into STRUCTURED sinks — ✅ DONE 2026-06-19 (built + unit-tested; NEEDS LIVE VERIFY).**
Three bisected commits, 93 node / 125 python green. Diagnosis in `learnings.md` 2026-06-19.
- [x] **B1 — `contenteditable`/`role=textbox` → rrweb uncovered.** rrweb's `maskAllInputs` covers
      `<input>`/`<textarea>` only, so free-form text typed into Gmail/Slack/Notion landed verbatim in
      `events.jsonl`. Fix: pass rrweb a `maskTextSelector` + `maskTextFn` (new pure `src/mask-text.js`,
      mirrored into `content.js`) so editable text is masked on the snapshot AND every typing mutation
      (rrweb re-tests via `closest()` per characterData change; masking inherits to descendants).
- [x] **B2 — `describe()` can pull a secret into `ctx` via `aria-labelledby` → referenced
      `textContent`.** Fix: new `redactCtx()` in `redact.js` scrubs href+name+section at the worker's
      `appendTimeline` chokepoint; `content.js` drops `ctx.name` entirely on a secret input. Browser
      harness gained a secret-input fixture.
- [x] **B3 — SPA `pushState`/`replaceState`/hash changes emit no `nav` event.** content.js only
      listens for `popstate`. The worker already sees these via `tabs.onUpdated` (changeInfo.url, no
      status), so `navActions` now returns `emitnav` and the handler appends a redacted nav + frame.
      Gated on absence of `changeInfo.status` so a full-page nav isn't double-logged.
- [ ] **LIVE VERIFY (interactive — no unit test):** (a) type free-form text into a contenteditable
      editor (Gmail/Slack/Notion compose) → it shows as `‹redacted›` in `events.jsonl`, never verbatim;
      (b) on an SPA (e.g. a React-router app) click through routes → `timeline.json` has a `nav` event
      per route change with the URL redacted; (c) a secret input with an `aria-labelledby` → its `ctx`
      in `timeline.json` has no `name` and no token.

**Track C — analyze pipeline never-crash / DoS on malformed-untrusted bundles — ✅ DONE 2026-06-19
(built + unit-tested; fully unit-testable, no live verify needed).** 5 bisected commits, 165 python /
93 node green. Diagnosis in `learnings.md` 2026-06-19.
- [x] **C1 — `build_context`/`build_pack` never crash on a malformed bundle.** New `_load_json`
      (best-effort load + top-level type check vs a default) and `_read_text` (errors="replace") are
      the chokepoint; timeline/manifest/HAR/errors/urls/tabs/frames sanitised to shape; `ms()` coerces
      non-numeric `t`. (`tests/test_pack_robust.py`.)
- [x] **C2 — `timeout=` on both transcribe subprocesses.** `pack.py` auto-transcribe child
      (`TRANSCRIBE_TIMEOUT_S=1800`, catches `TimeoutExpired` → keeps stub) + `transcribe.py` ffmpeg
      (`FFMPEG_TIMEOUT_S=900`). "Never fatal" now covers hangs. (tests in
      `test_autotranscribe.py`/`test_selftest.py`.)
- [x] **C3 — `nearest_frame` O(log n).** Cached sorted `(times, files)` index (memoised by object
      identity) + bisect; the nearest time is always one of the two straddling the target. Also drops
      non-dict frames / coerces non-numeric `t`. (`tests/test_nearest_frame.py`, incl. brute-force
      cross-check.)
- [x] **C4 — validator type guards + TOKEN_RE lockstep.** `validate_bundle.py` + `check_coverage.py`
      guard non-dict manifest, non-dict/non-numeric/bool timeline elements, non-string frame `file`,
      unhashable tab, non-UTF-8 files. Validator JWT pattern realigned to redact.js (`{6,}` + optional
      3rd segment) so a short JWT the extension scrubs can't slip past the gate.
      (`tests/test_validate_robust.py`.)

**Track D — AI-usability of outputs (the "totally usable, don't overload" ask):**
D1/D2/D3/D4/D6 — ✅ DONE 2026-06-22 (D2/D3/D4/D6 analyze-side in `pack.py`; D1 extension capture-side;
all built + unit-tested, 190 python / 113 node green). Diagnosis + durable lessons in `learnings.md`
2026-06-22. D5 done (see above); D7 remains.
- [x] **D1 — capture HAR response bodies** — DONE 2026-06-22 (built + unit-tested; **NEEDS A LIVE
      CHROME VERIFY**). The migration outcome (#3) hinges on inferring the data model from response
      shapes, and the HAR had no bodies. Per Adam's plan decisions: **same-site JSON only** (the
      recorded app's own API incl. `api.*` subdomains, not third parties) and **reuse `redactBody`**
      (secrets/emails masked, field names + value shapes kept legible). New pure
      `extension/src/response-body.js` (`registrableDomain`/eTLD+1, `isSameSite`, `isJsonMime`,
      `capResponseBody`); `background.js` debugger listener is now async, tags `_sameSite`/`_wantBody`,
      and a new `Network.loadingFinished` branch calls `getResponseBody` → redact-then-cap (32KiB;
      >1MiB omitted) → `entry.response.content.text`. `_sameSite`/`_wantBody` stripped on export;
      manifest `redaction.response_bodies` declares the new sink. No redaction/analyze change needed:
      the validator already scans all of `network.har`; `pack.py`'s `## API calls` `response body`
      column already reads `response.content.text`. Tests: `tests/test_response_body.mjs` (11) + a
      response-body case in `test_redact.mjs`. Plan: `~/.claude/plans/reflective-wobbling-tulip.md`.
  - [ ] **Live verify (interactive — CDP can't be unit-tested):** record a JSON-API SPA → `network.har`
        same-site entries have redacted `response.content.text`, a cross-site request has none, an
        oversized body shows the `…‹truncated N bytes›` marker; `validate_bundle.py` PASS + "redaction
        check passed"; `pack.py`'s API table `response body` column is populated (was `—`).
  - Note: this resolves the open **P4c** item below (capture network response bodies).
- [x] **D2 — one authoritative API-calls table in `context.md`** — DONE 2026-06-22. New
      `render_api_table` builds ONE markdown table from the HAR: `t` (ms since t0, derived from each
      entry's `startedDateTime` − manifest `t0_wall`) + method + full URL + status + request body +
      response body (size-capped, pipe-escaped, type-guarded). Replaces the old lossy split (timeline
      had bodies + truncated URLs; the `## Network (HAR summary)` section had URLs but no bodies) —
      that thin Network section is gone. (`tests/test_ai_usability.py` → `TestApiTable`.)
- [x] **D3 — de-duplicate Steps/Timeline/transcript** — DONE 2026-06-22. Each modality now has ONE
      home: narration → Steps (bound) + the verbatim Narration block (dropped the inline 🗣 from the
      Timeline, so it's no longer 3×); request/response bodies → the API table only (dropped `body=`
      from the timeline's network line, which keeps a brief `METHOD url → status (Nms)` for causality).
      Section headers now state where each thing lives. (`TestTimelineDedup`.)
- [x] **D4 — demote/omit raw `events.jsonl`** — DONE 2026-06-22. Removed from `RAW_FILES` so it's not
      copied into the pack's `bundle/`; the pack README states it's intentionally omitted (largest
      file, replay-only) and still lives in the original capture zip. (`TestEventsJsonlDemoted`.)
- [x] **D5 — guarantee narration into the handoff** — DONE 2026-06-22. The ZIP was already covered
      (the export carries `video.webm` + CLAUDE.md/AGENTS.md self-contained recovery — P0, live-verified);
      the real gap was the PACK (old P4b): `pack.py` shipped neither the transcript text nor the audio to
      recover it when no ASR engine ran. Now, if the transcript is STILL a stub after `maybe_transcribe`
      and the manifest has narration audio, `build_pack` carries `video.webm` into `pack/bundle/` (skipped
      when auto-transcribe already filled the transcript). README + `context.md` Narration section state
      it's there and how to recover it. Also tightened the extension's stub `transcript.vtt` to point at
      the in-bundle CLAUDE.md/AGENTS.md recovery, not a repo-only `pack.py` path. Did NOT "bundle the
      method skills into the zip" — P0 settled on embedding the procedure inline; shipping skill files
      would re-litigate that + add drift (see `learnings.md` 2026-06-22). (`tests/test_ai_usability.py` →
      `TestNarrationCarry`, 5.) NB: the `background.js` stub-message tweak has no unit test — eyeball the
      next exported zip's `transcript.vtt`.
- [x] **D6 — surface the new capture-issue flags** — DONE 2026-06-22. `storage_full`,
      `narration_truncated`, `video_ended_early` now render in `## ⚠ Capture issues` (above the
      per-error lines) with a plain-language "what's missing", so the AI knows the bundle is partial.
      (`TestPartialCaptureFlags`.)
- [ ] **D7 — regenerate `analyze/example-output/`** from a v2 bundle (it's a v1 sample — no Purpose/
      Steps/Tabs/Annotations, so it under-represents current capabilities to any evaluator).
      **DEFERRED 2026-06-22 (Adam): needs a CURATED demo recording, not any existing capture.** Scanned
      every zip in `outputs/` + `~/Downloads/`: ZERO have a `purpose` set, ZERO have real (non-stub)
      narration, and all predate D1 (no response bodies) — so no on-disk bundle can showcase the
      headline intent layer. To do D7 right, record a short session WITH: a purpose selected, spoken
      narration (for Steps), 2-3 tabs, an annotation, and a JSON-API site (so the D1 `## API calls`
      response-body column is populated). That recording also doubles as the D1 live-verify. Then
      `pack.py` it and replace `example-output/` (decide PII handling then — frames are real screenshots).

## ▶ TODO 2026-06-18 — validate the capture→bundle→AI OUTCOME flow for 3 purposes (PROCESS tests, not code)

These test the core value prop, NOT code. The recording captures intent — the "what is this for?"
purpose, picked at capture time and embedded in the self-driving bundle — so a **fresh AI handed the
bundle, with no us in the loop**, can review it and produce the outcome the user wanted. We're judging
the PROCESS and the OUTPUT QUALITY. Each test = record a real session with the purpose set → export the
bundle → hand it to a fresh AI (e.g. Claude / Claude Code) → judge whether the deliverable matches intent.

- [ ] **1. Documentation building** (purpose `docs` → `SOP.md`). Record a real process / feature
      walkthrough, narrating the *why*. Check a fresh AI turns the bundle into clear, human-followable
      documentation — preconditions, happy path, decision points — without us explaining anything.
- [ ] **2. Skill building for process replacement** (purpose `skill` → `SKILL.md` +
      `automation.suggestions.md`). Record a manual process you'd normally do by hand (Adam's example: a
      spreadsheet workflow, keystrokes and all). Check the AI can produce EITHER (a) a skill it runs *in
      your place* next time, or (b) an automation that *replaces* the manual steps — capturing exact
      selectors / URLs / inputs and the success signal.
- [ ] **3. System-to-system migration feedback** — the **AI-onboarding-agent feature Adam most wants to
      practice on.** Example: migrating a user from one CRM to another. Record a walkthrough of the SOURCE
      system; check the AI can review the bundle and (a) explain how the source works, (b) identify the
      important **properties / fields / data** that must carry over to the target, and (c) use the
      **network requests (HAR)** to infer the data model and what's crucial to map.
  - [ ] **Open question — purpose mapping (decide before running test 3).** This doesn't cleanly fit an
        existing purpose (`skill`/`docs`/`ux`/`ui`/`improve`/`research`/`general`). Options: reuse
        `research` (its lens already pulls flow + architecture from HAR — Adam leaned this way), or add a
        new `migration` purpose with its own lens + deliverable (e.g. `migration-map.md`: source→target
        property mapping, crucial data, network findings). Defining a purpose = small code change in
        `pack.py` `PURPOSES` + the popup options.

**North star (Adam, 2026-06-18):** as each test proves out, codify *the right way to do that outcome*
back into an `analyze/skills/<purpose>` skill (the repo already ships `analyze-capture`,
`competitive-research`, `ui-improvement`). The goal: the repo accumulates a **library of agent skills
that teach a receiving AI how to use a bundle** — so the package gets better at driving the next agent.
Durable cross-project write-up lives in the LLM Wiki: `[[Self-Driving Capture Bundle]]` +
`[[AI Onboarding Agent - System Migration]]`.

## ▶ TODO 2026-06-18 — CODE: make capture a CONNECTOR to AI tools (Claude / Claude Code) — NEEDS A PLAN

The one code change Adam wants queued (NOT building yet). Today you record a bundle and drag it into a
repo / hand it to an AI. Instead: make the product a **connector** so an AI tool (Claude, Claude Code)
can **trigger a capture session on the spot** — open the target webpage, start screen capture, and
observe the session **live, mid-task**, so it sees what's happening as it happens. Removes the manual
export-and-drag step; a session can launch on demand.
- Likely shape: an **MCP server / connector** the AI calls to start/stop a capture and receive the
  bundle (or a live stream) directly. (Unconfirmed — needs design.)
- This is a real feature, not a quick fix → **SCOPE IT FIRST.** Plan must cover: who triggers it, the
  trigger/handshake, live-stream vs. post-hoc bundle, and the security/permission story of letting a
  tool launch a screen recording. Do NOT start building until the plan + Adam sign off.

## ✅ Done 2026-06-18 — lost-recording bug fixed (MV3 worker died mid-pause); needs live verify

Adam lost a ~30 min capture: paused (sharing one window) to work elsewhere, returned to a dead overlay
(couldn't pause/finish), overlay in another window, recording gone + `offscreen video capture failed:
DOMException`. Root cause + full diagnosis in `learnings.md` 2026-06-18 — the MV3 service worker holds
all recording state in memory and is terminated after ~30s idle, and Pause is exactly the window where
nothing keeps it warm. Fixed in 4 bisected commits (built + unit-tested):
- [x] **Keepalive** — offscreen doc pings the worker every 20s while recording (no new permission).
- [x] **Frames + HAR → IndexedDB** (were worker-memory only, so a restart lost them).
- [x] **Persist + rehydrate** — `session.js` (pure, 5 tests) → `chrome.storage.local`; `rehydrate()`
      resumes a live recording on cold start, or salvages a video-less bundle if the browser restarted.
- [x] **Second-Start guard** (rehydrate restores `recording=true` so the old re-Start can't `clearAll`)
      + `track.onended` (share-stopped-on-its-own → errors.json + `manifest.video_ended_early`).
- [x] ~~**LIVE-VERIFY (sign-off)**~~ — DONE 2026-06-18 (Adam). Test 1 (keepalive, `…17-45-27`):
      paused + idle minutes, didn't break, PASS, empty errors. Test 2 (forced worker kill,
      `…18-18-44`): `worker-restart … recovered` in errors.json, capture continued, **PASS 0 warnings**.
      Test 3 (second-Start guard): "Already recording." confirmed. Recovery verified end-to-end.

## 🎯 ADAM'S FEEDBACK + a bug found, from the Test-1 run (2026-06-18, `capture-2026-06-18T17-45-27-904Z`)

Test 1 (keepalive through a gap) **passed from Adam's side**: he paused, switched windows, resumed,
waited a few minutes — "nothing has changed, still recording," overlay still said "stop and export,"
"still hasn't broken." Bundle validates **PASS**, `errors.json` empty (no worker-restart), video +
narration intact, mic meter confirmed working ("cute little sound bars… and they're sensitive").
Three items came out of it — two from his narration, one I found reviewing the bundle:

**Decisions captured from Adam 2026-06-18 — see each item.**

- [x] **Scope capture + overlay to the surface actually being recorded (headline)** — DONE
      2026-06-18 (commit `a415aa2`), tab + window cases. **DECISION (Adam):** _"it should only work in
      the place I'm recording. 1 tab then 1 tab, 1 window 1 window, 1 screen just that screen."_ The
      offscreen doc reports the video track's `displaySurface`; `goLive` anchors `captureTabId` +
      `captureWindowId`; pure `capture-scope.js` (5 tests) decides membership; `instrumentTab` +
      `captureFrame` gate on it, so out-of-surface tabs/windows get no overlay, no debugger/DOM/network,
      no frames. `browser` → only the start tab; `window` → only the start window's tabs;
      `monitor`/unknown → everywhere. Persisted + rehydrated; surfaced as `manifest.capture_surface`.
      Chrome doesn't reveal which surface was picked, so the start tab/window is the proxy (correct for
      tab + window shares). **Live-verify:** window share → switch to another window → NO menu there,
      nothing from it in the bundle; tab share → switch tabs → only the shared tab captured.
  - [ ] **Staged refinement — multi-monitor screen share.** A `monitor` share currently scopes to
        "everywhere" (correct on a single monitor). To exclude windows on OTHER monitors, match window
        geometry to the captured display (likely the `system.display` permission). Low priority.
- [x] **Pause now suspends network/HAR capture too** (DONE 2026-06-18, commit `e5d27cd`). The CDP
      handler gated only on `!state.recording`; added `state.paused`, so network stops in lockstep with
      events/frames/rrweb when paused. Fixes the privacy leak (paused = off-record) AND the false
      CAPTURE GAP warning (the network-without-content signature no longer appears, so `check_coverage`
      needed no change).
- [x] **Chrome's "you're recording / Stop sharing" bar — DECISION (Adam): live with it.** Not worth
      changing the capture model (the bar is browser chrome; the only way to drop it is to abandon
      `getDisplayMedia` full-screen capture for a `tabCapture`/activeTab path). Closes the old "NEXT —
      hide the Stop sharing bar" item and the `activeTab`-vs-security reconciliation.
- [x] **Mic permission: never re-ask once granted (browser-agnostic)** — DONE 2026-06-18
      (commits `41aba3a`, then `34fd711` fixing a Comet regression). **Root cause of "asks every
      time":** the Start gate used `navigator.permissions.query({name:"microphone"})`, unreliable in a
      popup — returned not-granted though the grant persisted, so the window re-opened every Start.
      **Comet regression (first attempt):** pure-inline popup `getUserMedia` does nothing in Comet, so
      Enable-mic was dead and recording blocked. **Final design:** `ensureMic()` is a silent DETECTOR
      only (resolves with no prompt when granted); a persisted **`micGrantedOnce`** flag (set on any
      successful grant, inline or via the page) is the fast path so Start proceeds with no prompt/window
      thereafter — even in Comet. The dedicated grant page (`openMicGrant`) is the reliable fallback,
      opened only the first time. The worker clears the flag if a recording's mic actually fails
      (revoked) so it self-heals.
  - Updated 2026-06-18 (commit `ba06356`): the prompt now appears **IN the current tab** (injected
    extension-origin iframe with `allow="microphone"`, `request-mic.html/js`), not a separate window,
    and the iframe auto-dismisses after the choice — Adam disliked the lingering window. The window
    (`mic-permission.*`) is now only the fallback for restricted (`chrome://`) tabs.
  - [x] ~~**Live-verify (Comet + Chrome)**~~ — DONE 2026-06-18 (Adam): the microphone permission
        issue is solved — the in-tab prompt works and Start no longer re-asks once granted. (Adam
        confirmed the core flow; the individual edge sub-checks below — `chrome://` window fallback,
        revoke→re-prompt — were not separately exercised, but the reported nag is gone.) The original
        check, for reference: on a normal web page, Enable-mic/Start → the mic prompt appears **in that
        tab** (no separate window) and goes away after you choose → records narration; EVERY subsequent
        Start → no prompt at all. On a `chrome://` tab it falls back to the window. Revoke the mic
        mid-life → next Start re-prompts. Confirm macOS Privacy → Microphone → Chrome/Comet ON.
        `mic-permission.*` AND `request-mic.*` are both in use — do NOT delete.
  - [ ] **Comet mic-grant recourse — BUILT 2026-06-22, NEEDS A LIVE COMET VERIFY.** Adam: mic works in
        Chrome but not Comet; the in-extension enable did nothing and he had to set Microphone Ask→Allow
        in Comet's own site permissions. Two no-recourse bugs (full diagnosis + lessons in `learnings.md`
        2026-06-22): (a) `refreshMicState` hid the Enable button based on `navigator.permissions.query`,
        which reports `granted` in Comet while the recorder still can't capture — now keyed off the real
        `micGrantedOnce` flag so Enable stays clickable until the mic actually works; (b) the in-tab grant
        reported success on iframe-injection, not on an actual grant, and swallowed failures — now
        `request-mic.js` posts a `mic-grant-result` message; on failure the popup opens the grant window
        AND shows guidance ("set Microphone to Allow in site/extension permissions"). `storage.onChanged`
        keeps the mic UI live. Files: `popup.js`, `request-mic.js`, `mic-permission.js`, `i18n.js` (no
        unit test — chrome.*/getUserMedia). **Live verify (Comet):** with the mic NOT yet granted, the
        popup shows "Enable microphone…"; clicking it that doesn't surface a prompt → the grant window
        opens + the popup shows the "set to Allow" guidance; after allowing, the mic state flips to ✓
        without reopening the popup; Chrome's happy path is unchanged.

## ⏸️ ON HOLD 2026-06-18 — license + third-party notices (audit done, files written THEN reverted)

**Status: deliberately deferred. Do NOT re-add license files until Adam says so.** The four files
were written + committed once (proprietary `LICENSE`, `rrweb.LICENSE`, `Geist-LICENSE.txt`,
`THIRD_PARTY_NOTICES.md`) then **reverted** (commits were local-only/unpushed, removed via
`git reset --hard ff5f615` — no trace, no force-push). Audit below stays valid; only the act of
publishing a license is on hold. Not legal advice — confirm with a lawyer before relying on it.

**Why on hold (Adam, 2026-06-18):** "hold off on the license right now in case someone tries to sue
me... we want me limited just in case." Adam wants an **LLC in place first** so liability is limited
(the LLC, not Adam personally, would hold + license the project) before any license is published or
the tool is distributed. Holding off is low-cost: copyright is automatic, so the code is "all rights
reserved" by default with no `LICENSE` file; the only deferred obligation is the rrweb/Geist
third-party notices, which only bite at *distribution* time (and Adam isn't distributing yet).

**Decision when resumed (Adam, 2026-06-18):** proprietary / **all-rights-reserved**, fully closed
(not source-available) — Adam sees this as an embeddable/sellable component for AI-agent onboarding &
self-serve feedback. Holder: **the LLC Adam will form** (doesn't exist yet). The LLC holds + licenses
the project; the LICENSE notice reads "Copyright (c) 2026 <LLC name>" once formed, with a one-page IP
assignment (Adam → LLC) to move the author copyright into it. (Alternatives if he changes his mind:
PolyForm Noncommercial — source-visible, free non-commercial, commercial reserved; or BSL 1.1 —
restricted now, opens after a change date.)

**Resume trigger: when Adam forms the LLC.** That's the gate — license + third-party notices get
written/committed then, with the LLC as holder. (Also revisit sooner if the extension is ever handed
to a third party before the LLC exists, since the rrweb/Geist notices are required at distribution.)

**Audit findings (what's ours vs third-party):**
- ~7,727 lines of original JS/Python/HTML/CSS authored here + all docs = **ours** (copyrightable).
- Only **two** third-party assets bundled in-repo, both permissive:
  - `extension/src/lib/rrweb.min.js` — **MIT**, "Copyright (c) 2018 Contributors (rrweb)".
  - `extension/src/fonts/Geist-Variable.woff2` — **SIL OFL 1.1**, "Copyright (c) 2023 Vercel,
    in collaboration with basement.studio". OFL = keep license with font, don't sell font alone,
    don't ship a *modified* font under the name "Geist".
- Pip deps (NOT in repo, installed on user machine): `faster-whisper`, `ctranslate2`, `anthropic` — all MIT.
- **Screenity check = CLEAN.** Only studied for the MV3 `getDisplayMedia`-in-offscreen pattern
  (which comes from Chrome's own docs); no Screenity code copied. Single ref in `learnings.md`
  ~line 494. No "copied/adapted from" markers anywhere; only internal self-copies (annotate-geom.js↔content.js).
  Matters because Screenity is GPL-3.0 — we're clear of copyleft.
- Repo currently has **zero license files** → bundled rrweb/Geist are missing their required notices (the gap to fix).

**Steps when resumed (all previously written + verified, then reverted — re-do when Adam unblocks):**
- [ ] Add top-level `LICENSE` — proprietary all-rights-reserved, "Copyright (c) 2026 Adam Chubak"
      (or the holding entity if it exists by then), permission-required for any use/copy/modify/distribute.
- [ ] Add `extension/src/lib/rrweb.LICENSE` — exact rrweb MIT text (verified from the rrweb repo).
- [ ] Add `extension/src/fonts/Geist-LICENSE.txt` — full Geist OFL 1.1 text
      (`curl -s https://unpkg.com/geist@1.3.1/LICENSE.txt`; verified 92 lines).
- [ ] Add top-level `THIRD_PARTY_NOTICES.md` summarizing rrweb (MIT) + Geist (OFL 1.1) + the MIT pip deps.
- [ ] On entity formation: IP assignment Adam → entity, update the LICENSE notice.
- [ ] Commit.

## ✅ Done 2026-06-18 — live-run #2 fixes (built + unit-tested; need a live verify)

From Adam's second run (`outputs/capture-2026-06-18T12-45-56-384Z.zip`). All landed with tests
(node 55, python 116, all green); the behaviors below are chrome.*/DOM-dependent so a load-unpacked
run is the sign-off. Details in `learnings.md` 2026-06-18.

- [x] **Blocklist now actually saves + matches.** Settings persist on edit ("Saved ✓"); host match
      is suffix-aware + input-tolerant (`blocklist.js`). _Live check:_ add `1password.com`, confirm
      it sticks after closing/reopening the popup.
- [x] **Auto-pause on a blocklisted tab.** Switching into a blocklisted tab pauses the whole
      recording (video too) + icon tooltip says why; leaving auto-resumes; a manual pause is never
      overridden. _Live check:_ switch to 1Password mid-record → nothing from it in the bundle
      (manifest tabs, HAR, AND no frame of it).
- [x] **Pause clock fixed.** No forward jump on resume; frames/events stay aligned to the
      pause-excluding video (`clock.js`). _Live check:_ pause 10s, resume → timer continues, doesn't jump.
- [x] **Auto-transcribe uses the local engine.** `pack.py` finds `.venv`, auto-selects
      parakeet→faster-whisper, works on bare `python3`. Setup: `analyze/setup.sh` / `setup.ps1`.
- [x] **Annotations fuse mark + narration + frame** in `context.md`'s `## ✦ Annotations`.
- [x] **Mic prompt** opens a small popup window, not a new tab. **Save UX:** explicit
      auto-save-to-folder vs "ask where to save & name" (native dialog → any location + rename).
- [x] **"Extension context invalidated"** errors guarded in content.js.

## Now (in order)

- [x] ~~Validate the entire-screen + app-switch bundle~~ — `outputs/capture-2026-06-17T14-36-28-587Z.zip`
      **`validate_bundle.py` PASS** (0 warnings, 263 events, `video.webm` 48 MB present,
      audio track = Opus mic narration, `errors.json` empty). Frames confirm the video
      captured the **whole screen across both Chrome AND Comet** (a second browser where
      the extension isn't installed). The narration transcribed cleanly. The app-switch
      to Comet is visible in the video, as expected.

- [ ] **🎯 ADAM'S FEEDBACK on the browser tool (captured 2026-06-17 from the run above).**
      Reference he's modeling on: the **Loom** extension ("much prettier"). Items, in his words:

      **Popup — too big / "a bit ugly" → make it a compact dropdown.**
      - Shrink the popup into a dropdown "so it doesn't take up so much space."
      - KEEP the purpose/"why are you recording" field up top — he likes that it seeds the
        agent's context ("the option will start off your chat explaining it… so it knows").
      - MOVE into a **Settings** panel (out of the main popup): the **"Never record on"**
        host blocklist, and a **preset download folder**. Add a Loom-style "More"/settings menu.
      - He does NOT need camera-on / mic-chooser UI (mic is already handled); storage
        settings are fine to have.
      - Add a **countdown** before recording starts ("I like the countdown… so it knows when to begin").
      - Add a **face-cam / webcam video bubble** ("you need to have the video for my face").

      **On-screen control overlay during recording (model on Loom's menu) — WANTED:**
      **Finish** (= stop, save & export), **Pause**, **Restart**, **Cancel**.
      NOT wanted: rewind, trim.

      **Two NEW, SEPARATE annotation tools (the headline ask):**
      1. **Selector** — element selection that **snaps to DOM elements** (the way Loom's
         blur tool "sticks and goes on the objects"). Purpose: make sure user + agent are
         "**aligned on the same elements**." Lets the user confirm exactly which element they mean.
      2. **Draw** — freehand highlight of an **area/region** (not element-bound). Purpose:
         "show you what I actually want" — e.g. circle clutter, or "just these things at the
         top of the page, inside a section."
      They MUST be separate: selector = precise element alignment; draw = freeform area.
      Both usable **mid-recording**.

      **Blur tool (reconsidered → yes):** first said no, then "blur content is an awesome
      idea" — useful even though usage is internal, so users "show exactly what they want."
      Element-aware blur (same snapping mechanism as the selector).

      **Observed (possible issue):** near the end a Chrome **"new meeting"** prompt appeared;
      he wondered if it "broke it." It did NOT — bundle validated PASS and recording
      continued — but worth investigating why Chrome intercepted.
- [x] ~~**Live test, run 1** (2026-06-17)~~ — multi-tab instrumentation (RISK 2)
      **passed**; screen picker (RISK 1) **failed** and a `?jwt=` URL token leaked.
      Both fixed in code (see below). See `learnings.md`.
- [x] ~~Picker/video fix~~ — switched video to **`getDisplayMedia()` in the offscreen
      doc** (reason `DISPLAY_MEDIA`), Chrome's recommended MV3 path. `desktopCapture`
      streamId→offscreen was a dead end ("Invalid state"). Start stays in the popup;
      dropped the `desktopCapture` permission. (A first recorder-page attempt was the
      wrong layer and was reverted.) Needs live re-verify.
- [x] ~~URL redaction~~ — `redactUrl()` in `redact.js` applied at every URL sink in
      `background.js`; locked by `tests/test_redact.mjs`.
- [x] ~~Re-run `LIVE-TEST.md`~~ — **run 3 (`outputs/v2-test-2-jwt-fix.zip`) PASSED**:
      getDisplayMedia opened the picker from the popup, `video.webm` landed,
      `validate_bundle.py` PASS, zero tokens in any sink. v2 capture is live-verified.
- [ ] **Re-run `pack.py` on the clean bundle** and eyeball the intent layer in
      `context.md` (`## Steps`, semantic click labels, `## Tabs` + `━━━ tab #N ━━━`)
      and `frames-annotated.html` — these rendered in earlier runs but haven't been
      re-checked on a video-bearing PASS bundle.

## Build plan

**Priority order set 2026-06-17: P0 (self-driving zip) FIRST**, then the UX work (P1→P3),
then analyze-side (P4). Reuse note: `content.js` already has `selectorFor()` (unique CSS
selector) and `describe()` (semantic name/role/section) — the Selector tool builds on those.

---

**P0 — Self-driving Capture Bundle zip (TOP PRIORITY)** 🎯
Goal (Adam): **any zip I record and hand to an agent for another process must work without
us** — no `pack.py`, no us in the loop. The zip carries its own instructions and the agent
can recover the narration itself. Two new files go *inside every exported zip*:

- [x] ~~**Add `CLAUDE.md` to the zip**~~ — done. Generated by `bundle-docs.js`
      (`bundleClaudeMd`), added to the export `files` array in `background.js`.
- [x] ~~**Add `AGENTS.md` to the zip**~~ — done (`bundleAgentsMd`). Both share one body
      (`agentGuideBody`) so they never drift; each adds a one-line audience header.
- [x] **Both files cover (done):**
  - What the bundle is + the single clock (all `t` are ms since `t0`).
  - File-by-file: `manifest.json`, `timeline.json`, `events.jsonl` (rrweb DOM),
    `network.har`, `frames/`, `video.webm`, `transcript.vtt`.
  - **AUDIO FALLBACK (the core fix):** `transcript.vtt` may be a stub ("No narration
    captured"). If so, the narration is an **Opus audio track inside `video.webm`** —
    extract it (`ffmpeg -i video.webm -ac 1 -ar 16000 audio.wav`) and transcribe locally
    (parakeet/whisper/any ASR), then align cues to t0. This is what lets the zip work
    without us, since the extension can't transcribe at export.
  - Redaction policy: secrets are already `‹redacted›`; never invent or bypass.
  - The **purpose/task steer** (from `manifest.json`) — what the recording was made to produce.
  - The **analysis procedure** — port the essentials of `analyze-capture/SKILL.md` +
    `BRIEF.md` (read purpose → narration → identify → analyze under the lens → produce),
    so the zip alone is enough.
- [x] ~~**Decide embed vs. ship skill files**~~ — **EMBED** (Adam's call). The procedure
      (analyze-capture + BRIEF essentials, purpose lens) is written directly into
      CLAUDE.md/AGENTS.md; no separate skill files in the zip. Truly self-contained.
- [x] ~~**Update the bundle `README.md`**~~ — done (`bundleReadme` in `bundle-docs.js`). Now
      says the zip is self-driving and points at CLAUDE.md/AGENTS.md; pack.py noted as optional.
- [x] ~~**Tests**~~ — `tests/test_bundle_docs.mjs` (13 tests): both files present + non-trivial,
      shared body, audio-in-`video.webm` fallback, self-driving claim, redaction rule, one-clock,
      purpose rendering, task surfacing, narration_error path, README no longer requires pack.py.
      All green; python (70) + redact (7) still green.
- [x] ~~**LIVE-VERIFIED** (2026-06-17, `~/Downloads/capture-2026-06-17T16-07-30-128Z`)~~ —
      exported zip contains `CLAUDE.md` + `AGENTS.md` (identical bodies, correct content);
      `validate_bundle.py` PASS. Proved the audio fallback end-to-end: transcript was a stub
      but, following the embedded instructions (`ffmpeg` extract → local ASR), the narration
      was recovered from `video.webm`. P0 contract works without us.
- [x] ~~**Refinement: default to Parakeet, not Whisper**~~ — the audio-recovery step now tells
      the agent to default to Parakeet (best accuracy here) with a runnable mlx-audio command;
      Whisper is framed only as a fallback.
- [x] ~~**Refinement: general capture = `notes.md` only + ask the user**~~ — for General
      capture (or no purpose), the docs now say produce only `notes.md` by default (no auto
      SOP/skill/suggestions) and **ask the user which other outputs they want**. A specific
      purpose still auto-produces its deliverable. Locked by `test_bundle_docs.mjs` (now 15). **P0 DONE.**
- [ ] **Convenience (not required, optional):** auto-run `transcribe.py` at pack/export so the
      transcript is usually already populated — but the zip MUST still work as a stub (it does now).

---

**P1 — On-screen recording overlay** (injected, visible during recording, worker-synced
across tabs so it shows regardless of which tab is focused) — **CODE DONE; needs live-Chrome verify.**
- [x] ~~Inject a single overlay via `content.js`~~ — shadow-DOM pill (`overlay` IIFE in
      `content.js`), mounted on capture start, removed on stop. Worker keeps every tab's
      overlay in sync via `broadcastOverlay()` (`{recording, paused, t0}`).
- [x] ~~Controls: **Finish** / **Pause** / **Restart** / **Cancel**~~ — wired to
      `overlay-command` → worker. Finish = stop+export; Pause/Resume toggles; Restart and
      Cancel are destructive so they take a 2-click confirm ("Sure?"). No rewind/trim.
- [x] ~~Visually + functionally distinct from Chrome's "is debugging this browser" bar~~ —
      separate shadow-DOM pill bottom-center; our Cancel discards via the worker (does NOT
      touch the debugger). Chrome's bar Cancel still detaches — left alone.
- [x] ~~Pause/Restart/Cancel semantics on the worker side~~ — `pause/resume/restart/cancel`
      in `background.js`, mirrored onto the offscreen MediaRecorder (`offscreen-pause/-resume/
      -restart/-cancel`). **Pause:** event+rrweb ingest drop (`state.paused`) and recorder
      `.pause()`. **Restart:** wipe DB + buffers, reset t0, reuse the LIVE screen/mic tracks
      (no re-prompt), and re-init rrweb per tab so a fresh full snapshot lands (see
      `learnings.md`). **Cancel:** stop+discard, detach debuggers, release streams, no export.
- [ ] **Live-Chrome verify** (no unit test — overlay is shadow-DOM + chrome.* dependent):
      load unpacked, record across ≥2 tabs, confirm the pill shows on each tab, Pause freezes
      the timer + amber dot, Restart resets the clock and yields a replayable bundle, Cancel
      exports nothing, Finish exports a PASS bundle.

**P1b — Capture-death-on-navigation bug (CODE DONE + unit-tested; needs live verify)** 🐞
Found in a real 6-min session (`distru-freemium/.../capture-…16-12-14-616Z`): clicks/rrweb/
frames stopped at 1:43 on the first full-page navigation while network ran to 5:53 — only the
CDP debugger survived. Most of the session's DOM + visual capture was lost. See `learnings.md`.
- [x] ~~Worker re-arms the content script on every navigation~~ — `tabs.onUpdated` complete /
      url change → `reattachTab()` (re-inject + re-send `start`); debugger left attached.
      Gating in pure `nav-policy.js` (`navActions`), unit-tested (`tests/test_nav_policy.mjs`).
- [x] ~~Content-script self-attach retries on transient failure~~ (was fire-and-forget).
- [x] ~~Periodic 3s frame timer~~ — frames no longer coupled to DOM events
      (`startFrameTimer`/`stopFrameTimer`, wired to all lifecycle verbs). Dropped per-hover frame.
      Also capture a frame on tab activation (`tabs.onActivated`) so a tab switch always
      yields a fresh screenshot of the newly-focused tab.
- [x] ~~Coverage diagnostic~~ — `analyze/check_coverage.py` detects the signature on any bundle;
      FAILs the original bad bundle, unit-tested (`tests/test_check_coverage.py`, 8 tests).
      **Wired into `validate_bundle.py`** — every validation now flags a CAPTURE GAP as a loud
      warning (still PASSes structurally), so this can't silently recur. (`tests/test_validate_coverage.py`).
- [ ] **Live verify (the sign-off):** re-record the same distru-freemium flow (several
      `/fixes?filter=…` full-page navigations), Stop, then run
      `python3 analyze/check_coverage.py <bundle>` → must PASS (content capture tracks network
      on the active tab; clicks + frames present after the first navigation). Needs the screen
      picker + mic, so it's an interactive run.

**P4c — Capture network response bodies — ✅ DONE 2026-06-22 as D1** (built + unit-tested; needs a
live verify). `network.har` now carries same-site JSON response bodies (redacted via `redactBody`,
size-capped) — see the D1 entry above. Note: only JSON is captured, so rendered HTML / non-JSON
error text still comes from `video.webm`, not the HAR (by design — JSON is the data-model surface
the migration outcome needs).

**P1c — Capture only tabs the user enters (CODE DONE + unit-tested; RE-VERIFY AFTER P2)** 🔒
A clean run showed v2 captured all 16 open tabs (incl. a 1Password signin + Telegram) in a
3-tab task. Adam's call: capture only tabs the user **enters**. See `learnings.md`.
- [x] ~~`start()` instruments only the active tab~~ (was `chrome.tabs.query({})` over all).
- [x] ~~`tabs.onActivated` lazily instruments each tab the user switches into~~ (idempotent).
- [x] ~~`is-recording` answers per-tab~~ — an unentered tab's content script stays inert (no
      DOM snapshot of a password-manager/chat tab). `nav-policy.js` + tests updated.
- [ ] **Live re-verify (Adam, AFTER P2):** record a 3-tab task with sensitive tabs open →
      bundle `manifest.tabs` + `urls_visited` list only the tabs actually used.

**P2 — Annotation tools on the overlay (CODE DONE + unit-tested; needs live-Chrome verify)**
(the headline ask; Selector and Draw are SEPARATE). Both on the overlay pill (`Select`/`Draw`
buttons), usable mid-recording; toggle off via the button, switching tools, or Esc. Both render
on-screen (so the mark shows in `video.webm`) AND emit a structured timeline event; the worker
grabs a frame at emit time so the annotated screen is in `frames/`. See `learnings.md` 2026-06-17.
- [x] ~~**Draw** — freeform canvas highlight of an area/region (not element-bound)~~. Emits a
      timestamped, tab-tagged `annotation:draw` event (`{points, bbox, viewport}` as %-coords
      via `drawGeom`) so `pack.py` can show "user highlighted here" next to the narration.
- [x] ~~**Selector** — element pick that **snaps to DOM elements** (reuses `selectorFor()` +
      `describe()`)~~. Emits `annotation:select` with the selector + semantic label + element
      rect so the agent and user are "aligned on the same element."
- [x] ~~Pure geometry (`drawGeom`) extracted + tested~~ — `extension/src/annotate-geom.js` +
      `tests/test_annotate.mjs` (7 tests); mirrored verbatim in `content.js` (classic script,
      can't import — same as the `redact.js` helpers).
- [x] ~~Don't double-log annotation pointer events as page clicks/hovers~~ — `onClick` +
      `emitDwell` now bail while a tool is active.
- [ ] **Live-Chrome verify** (no unit test — shadow-DOM + chrome.* dependent): load unpacked,
      record, click **Select** → hover shows the element outline → click marks it; click
      **Draw** → drag draws a stroke. Stop & export, then confirm `timeline.json` has
      `annotation:select` (with selector + `ctx`) and `annotation:draw` (with `points`/`bbox`),
      and `frames/` contains a shot showing the mark. Esc / toggle exits cleanly; tools are
      disabled while paused.

**P3 — Popup → compact dropdown + Settings (CODE DONE; needs live-Chrome verify)**
(current popup was "too big / a bit ugly"):
- [x] ~~Shrink the popup to a compact dropdown~~ — collapsible `<details>` sections (purpose
      stays open + prominent at top since it seeds the agent's context; Settings collapsed).
      Tighter spacing, single-column.
- [x] ~~**Settings panel**~~ — moved the **"Never record on" host blocklist** into a collapsed
      Settings `<details>`, added a **preset download folder** (subfolder of Downloads) + an
      **"Ask where to save each time"** toggle. When off (default), export drops straight into
      Downloads/<folder> with no Save dialog (`background.js` `getSettings`/`stop`, sanitised by
      `cleanSubfolder`; `chrome.downloads` rejects absolute paths / `..`).
- [x] ~~**Countdown** before recording starts~~ — a 3-2-1 shown in the active tab AFTER the
      screen picker, BEFORE capture goes live. Implemented as a picker→countdown→go handshake:
      offscreen sends `offscreen-armed` once the picker resolves; the worker holds
      `recording=false` (nothing captured during the pre-roll), runs the countdown overlay
      (`content.js` `countdown`), then `goLive()` sets t0 + instruments + `offscreen-go` starts
      the recorder. Data-only fallback (cancelled picker) preserved.
- [ ] **Live-Chrome verify** (no unit test — popup/offscreen/content are DOM + chrome.*):
      Start → pick a screen → see 3-2-1 → recording begins, pill shows, t0 starts at the count's
      end (no countdown seconds in the video); export lands in the preset folder without a Save
      dialog; blocklist still honored from Settings. Cancel the picker → still records data-only.

**P4 — Analyze side renders the new signals:**
- [x] ~~`pack.py` renders `annotation:draw` / `annotation:select` in `context.md` and marks
      them on `frames-annotated.html`~~ (done 2026-06-17). A dedicated `## ✦ Annotations`
      section surfaces the marks up top; both kinds also render in the Steps procedure and the
      raw Timeline (no longer raw-JSON). `frames-annotated.html` draws the selected element's
      box + ring in blue and traces the freeform stroke as an SVG polyline. Unit-tested:
      `tests/test_annotations.py` (13). Note: the in-zip self-driving docs (`bundle-docs.js`)
      don't yet mention the `annotation:*` events — small follow-up if we want the raw-zip path
      to call them out (the events are in `timeline.json` regardless).
- [x] ~~**Auto-transcribe**: have `pack.py` run `transcribe.py` when it sees the stub
      `transcript.vtt`~~ (done 2026-06-17). `pack.maybe_transcribe()` runs at the start of
      `build_pack`: if the transcript is a stub and the bundle has narration audio, it calls the
      local transcriber (parakeet) so the pack carries narration with no manual step. Best-effort
      and **never fatal** — gated on `ffmpeg` being present, swallows a missing-engine `SystemExit`
      / any error and leaves the stub (the zip is still self-driving). `--no-transcribe` skips it.
      Unit-tested (`tests/test_autotranscribe.py`, 12; the transcriber is mocked so the suite needs
      no ffmpeg/engine). On Adam's default `python3` (no mlx-audio) it'll warn + leave the stub;
      run it from the `.venv` to actually transcribe.

**P4b — `pack.py`-path handoff gaps** (verified 2026-06-17; the *zip*-path equivalents are
now covered by **P0** — these are the analysis-pack path):
- [x] ~~**Audio never reaches the pack.**~~ DONE 2026-06-22 (as D5). `build_pack` now carries
      `video.webm` into `pack/bundle/` when the transcript is still a stub after `maybe_transcribe`
      and the manifest has narration audio (skipped when auto-transcribe already filled it). So a
      pack built with no ASR engine keeps the audio to recover the narration from.
- [x] ~~**No audio-fallback instructions anywhere.**~~ DONE 2026-06-22. The pack `context.md`
      Narration section + README now state, when the transcript is a stub, that the narration is an
      Opus track in `video.webm` and how to recover it (ffmpeg + ASR, per CLAUDE.md/AGENTS.md). The
      extension's stub `transcript.vtt` message now points at the in-bundle self-contained recovery too.
- [ ] **Raw zip is not self-driving.** The bundle README is a one-line file list that points
      at `../analyze/pack.py` (a path the recipient won't have). The self-driving layer
      (`agent-skills/analyze-capture`, `BRIEF.md`) is added by `pack.py` into the *pack*, not
      the zip. Decide: either (a) document that you must run `pack.py` and hand over the pack,
      or (b) make the raw bundle carry minimal consumption instructions too.

**P5 — Investigate:** near the end of the run a Chrome **"new meeting"** prompt appeared and
Adam wondered if it broke recording. It did NOT (bundle PASSed, recording continued) — find
why Chrome intercepted and whether it can disrupt a real capture.

### Decisions made (2026-06-17)
- **Build order:** **P0 (self-driving zip + audio fix) FIRST** — Adam's call. The zip must
  work when handed to any agent without us, including recovering narration from the audio
  when the transcript is a stub, via in-zip `CLAUDE.md` + `AGENTS.md`. THEN P1 overlay, etc.
- **Blur:** skipped for now → moved to "Future improvements" below.
- **Face-cam:** deferred → "Future improvements" below.

### Open question (default chosen, confirm if wrong)
- **Annotations — visible only, or also structured events?** This plan assumes BOTH:
  shown on-screen during recording AND emitted as timeline events (so the agent gets the
  selector/region, not just the video pixels). Flag if you only want them visible.

## Security follow-ups (recommended, from the 2026-06-17 scan — not yet done)
The scan's code findings are fixed (see `learnings.md`). These residual items are low-severity /
need a live check, so they're deferred:
- [ ] **Remove `web_accessible_resources` for `src/offscreen.html`** — `chrome.offscreen.createDocument`
      loads it as an extension page and (almost certainly) doesn't need it web-accessible. Untestable
      without a load-unpacked run, so verify video still records after removing the WAR block.
- [ ] **Pin + audit optional analyze deps** — `analyze/README.md` installs `mlx-audio faster-whisper`
      unpinned; `adapters/requirements.txt` floors `anthropic`. Pin exact versions and run `pip-audit`.
- [ ] **Record a SHA-256 of vendored `rrweb.min.js`** so a re-vendor can't silently drift. 2.0.0 is
      advisory-clean (Snyk); consider bumping to 2.0.1.
- [ ] **Drop `activeTab` permission** — likely redundant given `<all_urls>` + `tabs` (verify nothing
      relies on it).

## Future improvements (out of scope for now)
- [ ] **Blur tool** — element-aware blur like Loom's (snaps to elements). Decide then:
      real video-pixel blur (real-time region mask on the getDisplayMedia stream) vs. a
      "blur this region" marker the agent respects. Useful even for internal bundles so the
      user shows exactly what they intend. (Note: the video is currently NOT redacted at all.)
- [ ] **Face-cam / webcam bubble** ("video for my face") — adds `getUserMedia` webcam
      capture; decide whether to composite into `video.webm` (Loom-style bubble) or a
      separate track.

## Optional / noticed (not blocking)

- [ ] Per-tab frames: `captureVisibleTab` grabs whichever tab is active at the
      moment; with full-screen video the frames are partly redundant. Decide whether
      to keep per-tab frames, rely on the video, or tag frames with their tab.
- [ ] System/tab audio: the desktop stream can include shared audio if the user
      checks "share audio" in the picker; today we take only its video track. Decide
      if page audio is worth capturing as a separate track.

## Housekeeping

- [ ] Push v2 / open a PR / create a GitHub repo — **only when Adam asks.** All work
      is committed locally in this new repo (`git log` from the repo root); nothing
      pushed, no remote set.
