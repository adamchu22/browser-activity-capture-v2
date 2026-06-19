# To-do (current) — v2

v2 reworks capture to **full-screen video + all-tabs instrumentation** and adds an
**intent-capture layer** (stated task goal, semantic element context, narrated-step
segmentation, frame annotation / "draw on screen"). Code is built and unit-tested
(61 tests; DOM capture also harness-verified); the extension still needs a live-Chrome
run. Completed v2 work is in `to-do-completed.md`; inherited v1 work is in the v1 repo.

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

**Track B — redaction leaks into STRUCTURED sinks (privacy; bundles get handed to other agents):**
- [ ] **B1 — `contenteditable`/`role=textbox` → rrweb uncovered.** rrweb runs `maskAllInputs:true`
      only (no contenteditable); `scrubNode` is shape-only. Free-form PII typed into Gmail/Slack/
      Notion lands verbatim in `events.jsonl`. Add a `maskTextFn` or a contenteditable-aware pass.
- [ ] **B2 — `describe()`/`accessibleName()` can pull a secret into `ctx` on the secret-input path**
      via `aria-labelledby` → referenced `textContent`. Scrub name/section; suppress `ctx.name` when
      `isSecretInput`.
- [ ] **B3 — SPA `pushState`/`replaceState` emit no `nav` event** (`content.js` listens only for
      `popstate`) → timeline URL context drifts on most modern apps; those URLs skip `redactUrl`.

**Track C — analyze pipeline never-crash / DoS on malformed-untrusted bundles (fully unit-testable):**
- [ ] **C1 — `build_context` crashes on a truncated/non-UTF-8/empty `timeline.json`** (`pack.py:585`+)
      — unguarded `json.loads`/`read_text` despite the "never crash" promise. Guard every load.
- [ ] **C2 — no `timeout=` on the transcribe/ffmpeg subprocesses** (`pack.py:825`, `transcribe.py:53`)
      — a wedged ffmpeg hangs the pipeline forever; the "never fatal" contract doesn't cover hangs.
- [ ] **C3 — `nearest_frame` is O(events × frames)** (4 call sites) — minutes of CPU at 100k events;
      sort once + bisect.
- [ ] **C4 — validator type guards + lockstep.** Non-dict / non-numeric timeline elements crash
      `validate_bundle.py`; `TOKEN_RE` has drifted from `redact.js` (JWT `{10,}` vs `{6,}`).

**Track D — AI-usability of outputs (the "totally usable, don't overload" ask):**
- [ ] **D1 — capture HAR response bodies** (size-capped, redacted, same-origin JSON) — the migration
      outcome (#3) most-wanted hinges on inferring the data model from request/response shapes, and
      the HAR has no bodies. Needs response-body redaction (overlaps the open P4c item below).
- [ ] **D2 — one authoritative API-calls table in `context.md`** binding method+URL+request body+
      status+response body+triggering `t` (today split lossily across Timeline and Network sections).
- [ ] **D3 — de-duplicate Steps/Timeline/transcript** (narration appears 3×; events listed twice) —
      make Timeline a delta over Steps. This is the exact "overload with disconnected context" worry.
- [ ] **D4 — demote/omit raw `events.jsonl`** from the pack (largest file, noise for these outcomes).
- [ ] **D5 — guarantee narration into the self-driving zip** (transcribe at export / always pack) so
      the zip path doesn't ship a stub the receiving AI can't fill; bundle the method skills too.
- [ ] **D6 — surface the new capture-issue flags** (`storage_full`, `narration_truncated`,
      `video_ended_early`) in pack.py's `## ⚠ Capture issues` so the AI knows the bundle is partial.
- [ ] **D7 — regenerate `analyze/example-output/`** from a v2 bundle (it's a v1 sample — no Purpose/
      Steps/Tabs/Annotations, so it under-represents current capabilities to any evaluator).

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

**P4c — Capture network response bodies (follow-up, not blocking):** `network.har` currently
has no response bodies (no `Network.getResponseBody` call), so rendered HTML / error text can't
be recovered from the HAR — only from `video.webm`. Adding bodies needs response-body redaction
(we don't scrub those yet). Scope separately.

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
- [ ] **Audio never reaches the pack.** `pack.py` `RAW_FILES` (line 35) copies
      manifest/timeline/transcript/network/events/errors but **NOT `video.webm`**. So if a
      bundle is packed while its transcript is still the stub, the pack has neither narration
      text nor the audio to recover it — narration is lost. Fix: either always transcribe
      before/at pack time (P4 auto-transcribe), and/or carry the audio into the pack.
- [ ] **No audio-fallback instructions anywhere.** Neither the bundle README
      (`background.js:515`) nor the `analyze-capture` skill tells a model the narration is an
      Opus track in `video.webm` or how to transcribe it; the skill says read "the full
      transcript" with no stub fallback. Add: "if transcript.vtt is a stub, the audio is in
      video.webm — transcribe it" (and ship that instruction where the recipient will see it).
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
