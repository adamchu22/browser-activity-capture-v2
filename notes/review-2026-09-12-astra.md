# Blind Review A (true Astra pass) — browser-activity-capture (2026-09-12)
**Model:** openai/gpt-6-astra via OpenRouter (direct API, whole-repo 739K-char prompt, 201K tokens, $2.96). Ran with full repo source inline; no file access, no tests executed. Blind to other reviews.

```json
{
  "summary": "Independent static review of the supplied source; the embedded audit was not treated as evidence. Found significant defects in export durability, lifecycle concurrency, media alignment, privacy enforcement, and validation. The one-master-clock invariant is broken by HAR wall-clock reconstruction and media start/segment handling. Redaction-before-disk is incomplete even for structured streams; visual streams are explicitly unredacted. The analysis pack already includes narration-intent and friction extraction, but its classifications and temporal joins can mislead an LLM, and its instructions inconsistently govern improvement analysis. Line numbers below are approximate locations in the supplied text; exact code quotes and function names identify the relevant sites. No tests or browser runtime were executed.",
  "bugs": [
    {
      "file": "extension/src/offscreen.js",
      "line": 196,
      "severity": "critical",
      "description": "assembleAndSave reports successful export immediately after a synthetic anchor click, not after a completed download. Downloads can be blocked, canceled, interrupted, or fail asynchronously without throwing from a.click(). The worker then calls onExportSuccess and clears IndexedDB and recovery metadata. Salvage/retry similarly treat chrome.downloads.download resolving with a download ID as completion. This can irreversibly delete the only recording without a saved bundle. Have the worker initiate/monitor the object-URL download and retain all data until downloads.onChanged confirms completion.",
      "code_quote": "triggerDownload(zipBlob, filename);\n    finalizedSegments = [];\n    return reply({ ok: true });"
    },
    {
      "file": "extension/src/background.js",
      "line": 580,
      "severity": "critical",
      "description": "Lifecycle commands are not serialized. stop sets recording=false before awaiting teardown/export, so another Start can pass its guard, clear the old take, close the exporting offscreen document, and change the shared state used to build the old manifest. Conversely, the old export's onExportSuccess can clear the new take. Restart, Cancel, Retry, and Discard can also overlap. Use an explicit persisted lifecycle state and exclusive transition queue; stopping/exporting must remain occupied states.",
      "code_quote": "async function stop() {\n  if (!state.recording) return;\n  state.recording = false;\n  stopFrameTimer();\n  await teardownTabs();"
    },
    {
      "file": "extension/src/background.js",
      "line": 1100,
      "severity": "high",
      "description": "In-flight capture operations have no generation guard or export drain barrier. captureFrame checks recording/paused only before awaits and writes after captureVisibleTab completes; a pending screenshot can therefore land after Pause, Cancel, Restart, or export, possibly stamped against a new t0. Network.getResponseBody has the same problem. instrumentTab also continues attaching and sending Start after lifecycle changes. Track outstanding work and capture/session generations, and recheck policy before persistence.",
      "code_quote": "dataUrl = await chrome.tabs.captureVisibleTab({ format: \"png\" });\n...\n  const t = now();\n...\n    await db.append(\"frames\", { t, file, dataUrl });"
    },
    {
      "file": "extension/src/background.js",
      "line": 132,
      "severity": "high",
      "description": "The recovery snapshot is debounced rather than committed before capture begins, and serializeSession returns null as soon as recording=false. A pending timer or an export-time logError can therefore remove captureSession while export is still underway, contrary to the preservation comment in stop. A crash before onExportFailure writes unsavedTake leaves occupied IndexedDB with no durable recovery marker, allowing the next Start to wipe it. Persist recording/finishing/export-pending states transactionally and retain the capture identity through confirmed save.",
      "code_quote": "const rec = serializeSession(state);\n...\n    else chrome.storage.local.remove(SESSION_KEY).catch(() => {});"
    },
    {
      "file": "extension/src/background.js",
      "line": 187,
      "severity": "high",
      "description": "Recovery treats the existence of any offscreen document as proof that the live recorder survived. Offscreen documents remain after export and can also exist with recorder=null after failure or with an inactive recorder after cancellation. Rehydrate can restore REC and resume structured capture while no media is recording. It also restores stale pause state without reconciling it with the recorder. Require a session-ID/status handshake covering recorder state, media offsets, live tracks, and pause accounting.",
      "code_quote": "if (await offscreenExists()) {\n      for (const tabId of [...state.tabIds]) {"
    },
    {
      "file": "extension/src/background.js",
      "line": 1270,
      "severity": "high",
      "description": "Only command messages wait for rehydration. Early CDP/content messages are dropped against the initial empty state, and is-recording returns a definitive false during recovery. More importantly, timeline-event and rrweb-event ingestion does not verify that sender.tab is still tracked, eligible, and in scope. Delayed messages from a tab that was uninstrumented after entering a blocked host or changing scope can still be persisted while another tab keeps the global recording live.",
      "code_quote": "const tabId = sender.tab?.id;\n    const e = { ...msg.event, tab: tabId };\n    appendTimeline(e);"
    },
    {
      "file": "extension/src/background.js",
      "line": 333,
      "severity": "high",
      "description": "Debugger recovery does not handle an already-attached debugger session. If the worker restarts while its debugger remains attached, attach rejects and Network.enable is never attempted, leaving debuggerAlive false. An attach that succeeds followed by a failed Network.enable has the same trap. Additionally, onDetach retries immediately, but the cooldown can suppress that only retry without scheduling another; a stationary SPA can then lose network capture indefinitely.",
      "code_quote": "await withTimeout(chrome.debugger.attach({ tabId }, \"1.3\"), DEBUGGER_CALL_TIMEOUT_MS, `debugger.attach(${tabId})`);\n      await withTimeout(\n        chrome.debugger.sendCommand({ tabId }, \"Network.enable\"),"
    },
    {
      "file": "extension/src/background.js",
      "line": 658,
      "severity": "medium",
      "description": "Normal export uses state.frames, but neither session serialization nor rehydrate restores that metadata from IndexedDB. After a worker restart, previously captured frame bytes are exported but omitted from manifest.frames/counts. The frame-count cap also resets. Analyzer reconciliation partially compensates, but the producer still emits an incorrect contract. Restore a metadata index or derive it at export without loading image bytes.",
      "code_quote": "frameList: state.frames,"
    },
    {
      "file": "extension/src/background.js",
      "line": 765,
      "severity": "high",
      "description": "retryExport always rebuilds a structured-only zip even when finalized video still exists in the offscreen document. It reuses the original manifest without clearing video, narration_in_video, or video_segments, so a successful retry can claim nonexistent media and then clear the take. Video chunks are never durably checkpointed, so browser/offscreen loss also destroys all narration and video. Retry through the surviving media owner and persist media chunks; when salvage is unavoidable, explicitly emit accurate loss metadata.",
      "code_quote": "const { manifest, filename } = pending;\n...\n    const files = [...metaFiles(manifest, timeline, state.errors), ...streamFiles(timeline, rrweb, frames, harEntries, manifest.t0_wall)];"
    },
    {
      "file": "extension/src/db.js",
      "line": 40,
      "severity": "medium",
      "description": "IndexedDB write promises listen for complete/error but not abort. A transaction can abort without the handled error path settling the promise, hanging lifecycle operations such as clearAll. Every operation also opens a new database connection and never closes it; high-volume rrweb capture accumulates connections and can obstruct upgrades. Reuse a managed connection or close it after completion, and reject onabort.",
      "code_quote": "const db = await open();\n  return new Promise((resolve, reject) => {\n    const tx = db.transaction(store, \"readwrite\");\n    tx.objectStore(store).add(record);\n    tx.oncomplete = () => resolve();\n    tx.onerror = () => reject(tx.error);"
    },
    {
      "file": "extension/src/offscreen.js",
      "line": 433,
      "severity": "high",
      "description": "Restart and re-share call recorder.stop without awaiting its final dataavailable/stop events. The old recorder's ondataavailable still pushes into the shared mutable chunks array. On restart its final bytes can contaminate the new recording; on re-share sealing happens before the final bytes arrive, so the old segment is truncated and late bytes can contaminate the next segment. Use recorder-local buffers and await final flush before replacing the recorder. restartRecording also fails to reset segmentOffsetMs after a prior re-share.",
      "code_quote": "recorder.stop();\n...\n    const sealed = sealSegment(chunks, segmentOffsetMs);\n    if (sealed) videoSegments.push(sealed);\n    chunks = [];"
    },
    {
      "file": "extension/src/offscreen.js",
      "line": 389,
      "severity": "high",
      "description": "finalizeRecording assumes every non-null recorder can be stopped. If all tracks ended and MediaRecorder already transitioned to inactive, stop throws and no offscreen-finalized response is sent; the worker times out and proceeds with incorrect media status. In the recorder=null branch, releaseStreams is never called, so a failed re-share can leave the microphone, meter, and keepalive alive after Finish. Finalization must handle inactive/null/live recorders and release resources in every branch.",
      "code_quote": "if (!recorder) {\n...\n    return;\n  }\n  recorder.onstop = () => {\n...\n  recorder.stop();"
    },
    {
      "file": "extension/src/offscreen.js",
      "line": 466,
      "severity": "high",
      "description": "Re-share stops the existing recorder before opening an arbitrarily long picker. Keeping the microphone track live does not record its samples, so narration during the picker is lost; cancellation leaves recorder=null and subsequent narration is lost too. A new recorder is started unconditionally even if the worker is currently paused, allowing off-record audio/video to be captured. Concurrent re-share/finalize/cancel messages also lack a generation guard, so a picker resolving after Finish can create a new live recorder.",
      "code_quote": "newVideoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });\n...\n    recorder.start(1000);"
    },
    {
      "file": "extension/src/background.js",
      "line": 526,
      "severity": "high",
      "description": "The worker sets t0 and begins instrumentation before sending offscreen-go. Debugger attachment and content injection can take seconds, not the documented approximately one second. The first media segment is nevertheless assigned offset zero and ASR starts at media time zero. Pause/resume commands also lack acknowledged clock boundaries. At Finish, media keeps recording while tabs are detached sequentially. These paths do not provide alignment by construction; persist actual media-start/stop and acknowledged pause mappings on the master clock.",
      "code_quote": "state.t0 = Date.now();\n...\n  if (tabId != null) await instrumentTab(tabId);\n...\n  chrome.runtime.sendMessage({ type: \"offscreen-go\" }).catch(() => {});"
    },
    {
      "file": "extension/src/background.js",
      "line": 915,
      "severity": "high",
      "description": "Re-share offsets are sampled before the picker opens, not when the replacement MediaRecorder starts. A 20-second picker delay shifts all events associated with the second segment by about 20 seconds. The offscreen document receives this stale offset and segmentOffsetsFor publishes it as the segment start. Obtain the actual recorder start boundary after picker completion and preserve both start and end times.",
      "code_quote": "state.reshareOffsetMs = now();\n  await ensureOffscreen();\n  chrome.runtime.sendMessage({ type: \"offscreen-reshare\", offsetMs: state.reshareOffsetMs }).catch(() => {});"
    },
    {
      "file": "analyze/transcribe.py",
      "line": 76,
      "severity": "high",
      "description": "Multi-segment transcription concatenates audio back-to-back and writes ASR-relative timestamps unchanged, ignoring every video_segments.offset_ms. The recorder actually stops during the re-share picker, so these segments are not a continuous audio clock. Initial media delay, missing segments, and re-share gaps shift later speech earlier in the pack. Transcribe segments independently and map cue start/end through explicit recorded media intervals.",
      "code_quote": "\"-f\", \"concat\", \"-safe\", \"0\", \"-i\", str(listfile),\n...\n    vtt_path.write_text(vtt, encoding=\"utf-8\")"
    },
    {
      "file": "analyze/pack.py",
      "line": 926,
      "severity": "medium",
      "description": "The reported video gap is computed as the difference between consecutive segment starts. That interval includes the entire previous segment and is not the missing-video duration. A first segment lasting 60 seconds followed immediately by another at 60 seconds is reported as a 60-second gap. The manifest needs segment end/duration metadata; until available, gap duration must be unknown rather than fabricated.",
      "code_quote": "gap_ms = off - prev\n                segment_lines.append(\n                    f\"  - `{seg_file}` starts at `{ms(off)}` \"\n                    f\"(~{gap_ms // 1000}s after the previous segment \u2014 video gap)\""
    },
    {
      "file": "extension/src/bundle-streams.js",
      "line": 62,
      "severity": "high",
      "description": "HAR export strips the only pause-adjusted request time, _t. pack.render_api_table and api_entries reconstruct time from startedDateTime minus t0_wall, which includes paused wall time. After a two-minute pause, every subsequent API evidence timestamp is two minutes ahead of actions/frames. Export a documented recording-time field and use it preferentially. Retain request/tab identifiers as well so joins need not be inferred from proximity.",
      "code_quote": "entries: (har || []).map(({ seq, _t, _start, _tab, _sameSite, _wantBody, requestId, ...e }) => e),"
    },
    {
      "file": "extension/src/clock.js",
      "line": 13,
      "severity": "medium",
      "description": "The recording clock uses Date.now deltas without protection against wall-clock correction. A backward clock adjustment can produce decreasing event times; a forward adjustment creates a false gap and diverges from MediaRecorder's media clock. Math.max only prevents negative values, not non-monotonicity. Use a monotonic source mapped to the persisted master epoch and record discontinuities/recovery mappings.",
      "code_quote": "return Math.max(0, nowMs - t0 - pausedAccum - ongoing);"
    },
    {
      "file": "extension/src/background.js",
      "line": 1549,
      "severity": "medium",
      "description": "Manifest duration is the last timeline event, not the recording end. Timer frames and narration can extend long after the final user/network event. This under-reports idle/friction spans and can put valid frames/cues beyond duration. Simply calling now at late export is also wrong because teardown/export time may have elapsed. Freeze the master-clock end time at Finish and use that in every modality's metadata.",
      "code_quote": "const last = timeline.length ? timeline[timeline.length - 1] : null;\n  const duration = last ? last.t : now();"
    },
    {
      "file": "extension/src/background.js",
      "line": 1180,
      "severity": "high",
      "description": "HAR records are keyed solely by CDP requestId across multiple debugger targets, although request IDs must be scoped to their target/session. Collisions can overwrite or cross-associate requests and responses. Redirects also reuse requestId and requestWillBeSent overwrites the previous hop without recording redirectResponse. Network.loadingFailed is not handled, so failed requests lack terminal status/timing and disappear from the network timeline\u2014precisely the evidence needed for friction analysis.",
      "code_quote": "state.har.set(requestId, entry);\n...\n    const entry = state.har.get(params.requestId);"
    },
    {
      "file": "extension/src/background.js",
      "line": 870,
      "severity": "high",
      "description": "Blocklist auto-pause is asynchronous and observes only the active tab of the last-focused window, not necessarily the shared surface. Tab/window events launch updateAutoPause without awaiting it; the MediaRecorder continues through navigation until the pause message is processed. Rapid queries can apply stale results. A blocked page visible in a different shared window or side-by-side on a monitor may never pause recording. The UI promises stronger exclusion than this mechanism provides. Restrict supported capture scope or gate/redact the actual media surface before encoding.",
      "code_quote": "const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });\n    blocked = !!(active && active.url && hostBlocked(active.url));"
    },
    {
      "file": "extension/src/background.js",
      "line": 552,
      "severity": "high",
      "description": "Capture scope is anchored to the Start tab/window, not the surface selected in Chrome's picker. Choosing another tab, another browser window, or a non-browser window produces video from one surface and structured evidence from another. On re-share, applyCaptureSurface does not uninstrument previously tracked tabs that are now outside scope, and tracked-tab ingestion/reattach do not enforce the new scope. This creates both privacy over-capture and misleading multimodal alignment.",
      "code_quote": "state.captureTabId = tabId;\n  const liveTab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;\n  state.captureWindowId = liveTab?.windowId ?? null;"
    },
    {
      "file": "extension/src/blocklist.js",
      "line": 31,
      "severity": "high",
      "description": "The blocklist normalizes trailing dots on entries but not on URL hostnames. Browsing to https://bank.example./ can bypass a bank.example blocklist entry even though it is the same DNS host. Unicode entries also are not normalized to the URL parser's IDNA representation. Normalize both operands with the same hostname/IDNA and trailing-dot rules.",
      "code_quote": "host = new URL(url).hostname.toLowerCase().replace(/^www\\./, \"\");"
    },
    {
      "file": "extension/src/content.js",
      "line": 81,
      "severity": "high",
      "description": "data-capture-secret is promised as an explicit masking control but is not checked by either isSecretInput implementation or configured as an rrweb block/mask selector. A generic text input carrying that attribute is emitted in clear by onChange; marked non-input DOM text is also serialized. Honor the attribute, including the intended descendant policy, at every structured capture path.",
      "code_quote": "if (el.type === \"password\") return true;\n    const hay = `${el.name || \"\"} ${el.id || \"\"} ${el.autocomplete || \"\"}`;\n    return SECRET_KEY_RE.test(hay);"
    },
    {
      "file": "extension/src/background.js",
      "line": 1251,
      "severity": "high",
      "description": "The worker redacts only event.url and selected ctx fields before persisting the rest of the event. content.js has an obsolete JWT/Bearer-only token regex, so provider keys typed into innocently named inputs leak. Raw label/selector/text and ctx.selected can also carry secrets. labelFor/accessibileName read contenteditable text, bypassing rrweb's editable-text masking. Apply canonical recursive, context-aware redaction to all persisted event fields and prevent labels/selectors from reintroducing masked user text.",
      "code_quote": "if (event.url) event = { ...event, url: redactUrl(event.url) };\n...\n  if (event.ctx) event = { ...event, ctx: redactCtx(event.ctx) };\n...\n    await db.append(\"timeline\", { t: now(), ...event });"
    },
    {
      "file": "extension/src/background.js",
      "line": 85,
      "severity": "high",
      "description": "Errors and task text are persisted without redaction. logError stores raw messages and stacks in the recovery snapshot and exports them to errors.json; state.task is copied into chrome.storage, manifest, and embedded agent docs unchanged. URLs/tokens/passwords in exception messages or user-entered task descriptions therefore violate redaction-before-disk. Scrub at collection time, not just at export.",
      "code_quote": "state.errors.push({ t: state.t0 ? now() : 0, where, message, stack: info.stack || null });\n...\n  persistSession();"
    },
    {
      "file": "extension/src/redact.js",
      "line": 175,
      "severity": "high",
      "description": "JSON key masking uses SECRET_KEY_RE rather than the broader SECRET_PARAM_WORDS used for form/URL values. Consequently opaque values under jwt, sig, or signature survive JSON redaction, despite comments claiming identical protection. Percent-encoded parameter names such as %74oken also bypass the URL/form key regex. Multipart bodies are copied through the fallback without parsing named secret fields. Use canonical decoded key matching and content-type-aware body parsing, with fail-closed handling for unsupported secret-bearing formats.",
      "code_quote": "if (SECRET_KEY_RE.test(k)) out[k] = REDACTED_SECRET;\n      else if (typeof v === \"object\") out[k] = redactObject(v);"
    },
    {
      "file": "extension/src/background.js",
      "line": 1230,
      "severity": "high",
      "description": "rrweb nodes are only token-shape scrubbed, not URL/attribute/key redacted. An href/src containing ?token=opaque-secret survives in events.jsonl even though redactUrl would mask it elsewhere. Similarly, redactHeaders only token-scrubs non-listed header values, so Referer/Location URLs containing opaque credentials can survive in HAR. Use structured DOM attribute traversal and URL-aware header handling; the scrubNode catch must not return unredacted data on failure.",
      "code_quote": "return JSON.parse(scrubTokens(JSON.stringify(node)));\n  } catch {\n    return node;"
    },
    {
      "file": "extension/src/redact.js",
      "line": 49,
      "severity": "high",
      "description": "The private-key regex replaces only the PEM BEGIN marker, leaving the base64 private-key material and END marker on disk. This is not private-key redaction and also removes the marker the validator uses to detect the leak. Match and remove the complete PEM block, including escaped multiline representations where applicable.",
      "code_quote": "\"-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----\","
    },
    {
      "file": "extension/src/response-body.js",
      "line": 44,
      "severity": "high",
      "description": "The incomplete public-suffix list fails open, contrary to its comment. For an unlisted suffix such as com.ar, unrelated a.com.ar and b.com.ar both reduce to com.ar; separate tenants on github.io similarly reduce to github.io. Cross-site JSON bodies are then captured as same-site. Use a maintained public/private suffix list or conservative explicit origin/domain allowlisting rather than claiming missing suffixes only under-capture.",
      "code_quote": "const take = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;\n  return labels.slice(-take).join(\".\");"
    },
    {
      "file": "extension/src/background.js",
      "line": 1624,
      "severity": "high",
      "description": "Visual redaction is explicitly disabled: raw captureVisibleTab pixels and getDisplayMedia tracks are persisted/exported. Any visible API key, revealed password, or data-capture-secret field can therefore be recovered from frames/video even when structured masking succeeds. This is a documented implementation limitation, but it contradicts the stated repository-wide redaction-before-disk invariant. Either enforce pixel masking before encoding/storage or explicitly narrow the invariant and obtain informed consent for unredacted visual capture.",
      "code_quote": "visual_streams_redacted: false,"
    },
    {
      "file": "analyze/transcribe.py",
      "line": 332,
      "severity": "high",
      "description": "ASR output is written directly to transcript.vtt with no secret redaction, then copied and rendered into the analysis pack. Spoken credentials/provider keys can therefore create new plaintext secret artifacts even if the incoming structured bundle was clean. Any supported narration-redaction policy must run on ASR output before its first persistent write, with the privacy limitation made explicit for raw audio and temporary WAVs.",
      "code_quote": "vtt_path.write_text(vtt, encoding=\"utf-8\")"
    },
    {
      "file": "extension/src/content.js",
      "line": 1192,
      "severity": "medium",
      "description": "Pause drops rrweb events only in the worker while the content-side recorder continues advancing its internal DOM mirror. On resume there is no new full snapshot, so later incremental events can refer to nodes/mutations that never reached disk. A tab first instrumented while paused also has its initial snapshot dropped. Stop or suspend rrweb while paused and emit a fresh redacted base snapshot on resume.",
      "code_quote": "if (msg.type === \"overlay-state\") {\n      capturePaused = !!(msg.state && msg.state.paused);\n      overlay.update(msg.state);\n    }"
    },
    {
      "file": "extension/src/content.js",
      "line": 1162,
      "severity": "medium",
      "description": "Each startCapture adds a new anonymous popstate listener that stopCapture never removes. Repeated recordings on the same page produce duplicate navigation events. The document capture-phase click handler also records recorder-overlay clicks as workflow clicks because it does not exclude __bac_overlay__, contaminating SOP segmentation and friction statistics.",
      "code_quote": "window.addEventListener(\"popstate\", () => emit(\"nav\", { url: location.href }));"
    },
    {
      "file": "extension/src/content.js",
      "line": 383,
      "severity": "medium",
      "description": "Input capture listens only to change and records el.value for every value-bearing element. An edit that has not committed before navigation/close/Finish can be absent, and checkbox/radio transitions record their static value rather than checked state. Contenteditable edits are intentionally masked in rrweb but have no replayable structured action at all. These omissions prevent reliable automation of common forms. Capture debounced redacted input state, checked/selected state, and explicit redacted-value placeholders with target identity.",
      "code_quote": "emit(\"input\", { selector: selectorFor(el), value: maskValue(el.name || el.id, el.value), ctx });"
    },
    {
      "file": "analyze/validate_bundle.py",
      "line": 270,
      "severity": "high",
      "description": "Falsy parsed timelines bypass check_timeline entirely: [], {}, null, false, or 0 can avoid the intended empty/not-list error. Numeric checks also accept NaN/Infinity and some negative timestamps, while manifest duration/t0 types and timestamp bounds are not validated. A sorted list is not evidence of cross-modal alignment. Validate required shapes unconditionally, finite nonnegative times, duration bounds, frame filename/time agreement, transcript cue intervals, and media references.",
      "code_quote": "_, referenced = check_timeline(timeline, r) if timeline else ([], [])"
    },
    {
      "file": "analyze/validate_bundle.py",
      "line": 218,
      "severity": "high",
      "description": "The redaction gate searches serialized text rather than parsed structures. It misses plain passwords/SSNs/cards under secret-named fields, generic opaque URL tokens, and reversed HAR header key order such as {\"value\":\"secret\",\"name\":\"Cookie\"}. Escaped JSON bodies/Unicode escapes introduce further blind spots. It also never verifies events.jsonl records or HAR structure beyond parseability, and cannot validate pixel/audio redaction. Report the actual limited checks rather than a general redaction pass, and add structural secret-policy validation.",
      "code_quote": "if any(rx.search(body) for rx in SECRET_HEADER_RES):\n...\n        if TOKEN_RE.search(body):"
    },
    {
      "file": "analyze/pack.py",
      "line": 1270,
      "severity": "high",
      "description": "build_pack and autopack do not invoke the validator or perform a redaction gate before copying data into an AI-ready pack. Malformed JSON is silently replaced with empty defaults, while build_health can return ok=true for an empty/corrupt bundle because it only checks missing indexed frames and a few flags. A leaked-secret or empty capture can be atomically published as a successful, healthy pack and skipped forever by autopack. Separate usable-partial from valid/complete/privacy-checked states and quarantine validation failures.",
      "code_quote": "(out / \"context.md\").write_text(build_context(bundle, blocklist), encoding=\"utf-8\")\n...\n            shutil.copyfile(bundle / name, raw / name)"
    },
    {
      "file": "analyze/pack.py",
      "line": 506,
      "severity": "medium",
      "description": "The claimed malformed-input robustness only checks top-level containers. For example, two events with string timestamps reach t-last_t in segment_steps and raise TypeError; ctx as a list crashes action_label; task as an integer crashes strip; unhashable tab IDs crash comprehensions. _num accepts NaN/Infinity, which later fail int conversion, and coverage can crash on an unhashable kind. Normalize nested schemas once and preserve validation diagnostics rather than relying on scattered coercions.",
      "code_quote": "or (last_t is not None and t - last_t >= gap_ms)"
    },
    {
      "file": "analyze/validate_bundle.py",
      "line": 94,
      "severity": "medium",
      "description": "Directory bundle paths are collected with str(Path), producing backslashes on Windows, but frame_files and manifest references require forward slashes. Valid unpacked bundles can report every referenced PNG missing on Windows while the same zip passes. Normalize relative paths with as_posix.",
      "code_quote": "self.names = {str(p.relative_to(path)) for p in path.rglob(\"*\") if p.is_file()}"
    },
    {
      "file": "analyze/check_coverage.py",
      "line": 79,
      "severity": "medium",
      "description": "Coverage equates trailing background network with content-script failure. After three actions in tab A, switching to tab B while A polls for more than 45 seconds falsely reports that A's content capture died. Conversely, a content script that never emitted three events is not flagged, and an empty frame list suppresses all frame-gap warnings. The validator also supplies only manifest.frames, ignoring actual disk frames. Use focus intervals and explicit content heartbeats, reconcile disk frames, and distinguish missing instrumentation from inactivity.",
      "code_quote": "if len(content) >= MIN_CONTENT_EVENTS and network:\n            gap = network[-1] - content[-1]"
    },
    {
      "file": "analyze/pack.py",
      "line": 827,
      "severity": "medium",
      "description": "Speech already present in timeline.json is concatenated with the same speech parsed from transcript.vtt, duplicating narration in Steps for the sample bundle and live-speech exports. parse_vtt_cues also discards cue end times, so narration_near tests cue starts rather than overlap and misses a long utterance still in progress at an annotation. Preserve cue IDs/start/end and deduplicate with explicit source precedence.",
      "code_quote": "speech = parse_vtt_cues(transcript)\n    timeline = sorted(timeline + speech, key=lambda e: _num(e.get(\"t\", 0)))"
    },
    {
      "file": "analyze/pack.py",
      "line": 437,
      "severity": "high",
      "description": "Any event carrying a different tab ID is rendered as an active-tab switch, including background network from previously visited tabs. segment_steps and _effective_tabs have the same assumption, allowing a polling request to split a step or bind speech to the wrong tab. render_steps also prefers each tab's final manifest URL over its historical URL after navigation. Record explicit focus/window events and per-tab document histories; background events must not drive user-focus transitions.",
      "code_quote": "if multi_tab and tab is not None and tab in tab_labels and tab != current_tab:\n            current_tab = tab"
    },
    {
      "file": "analyze/todos.py",
      "line": 103,
      "severity": "high",
      "description": "Evidence attachment overstates temporal proximity as grounding. Frames have no maximum age in _evidence, and actions/endpoints are selected across all tabs without document identity or causality. A to-do after a long visual gap can receive a minutes-old frame; a tracker request can become the purported endpoint. pack.nearest_frame also ignores event.frame and cannot enforce same-tab matching because producer frame metadata contains no tab/document identity. Include match deltas, provenance, bounds, and unknown/unmatched states.",
      "code_quote": "fr = _nearest(frames or [], t)\n    if fr and fr.get(\"file\"):\n        ev[\"frame\"] = fr[\"file\"]"
    },
    {
      "file": "analyze/friction.py",
      "line": 129,
      "severity": "medium",
      "description": "Retry/rage-click identity is only a selector or label. Identical selectors on unrelated tabs/routes are merged and reported as retries; ordinary repeated workflow actions are also labeled retried without observing failure. The error detector scans speech text but emits source=ui, misrepresenting narration as an observed UI state. Qualify identities by tab/document/state, distinguish repetition from failed retry, and preserve actual evidence modality.",
      "code_quote": "groups.setdefault(tgt, []).append(_num(e.get(\"t\")))\n...\n            out.append({\"t\": int(_num(e.get(\"t\"))), \"label\": _label(e), \"source\": \"ui\"})"
    },
    {
      "file": "analyze/pack.py",
      "line": 1294,
      "severity": "medium",
      "description": "Rebuilding into an existing pack merges directories and conditionally writes files but never removes obsolete artifacts. Frames, annotated HTML, carried video, raw files, and purpose-specific skills from a previous bundle/build can remain and be consumed as current evidence. A privacy-clean rebuild can retain previously copied sensitive media. Build into a fresh staging directory and replace a verified pack atomically, preserving user-authored outputs separately.",
      "code_quote": "shutil.copytree(frames_src, out / \"frames\", dirs_exist_ok=True)\n...\n    if annotated:\n        (out / \"frames-annotated.html\").write_text(annotated, encoding=\"utf-8\")"
    },
    {
      "file": "extension/src/bundle-docs.js",
      "line": 35,
      "severity": "medium",
      "description": "Raw-bundle and analysis-pack instructions disagree on the same recording. bundle-docs says General/unspecified produces notes only and asks before generating other assets; pack.PURPOSES.general mandates SOP/skill/automation outputs, and BRIEF's older-bundle fallback asks for the full set. The optional Claude adapter hardcodes a four-output schema that cannot represent UX/UI/improvement/research deliverables at all. Output behavior depends on which entry point is used rather than the capture contract.",
      "code_quote": "general: { label: \"General capture\", read: \"No single lens \u2014 capture the full picture.\", make: \"`notes.md` only by default \u2014 do NOT auto-generate SOP/skill/suggestions; then ask the user which other outputs they want\" },"
    },
    {
      "file": "analyze/adapters/run_claude.py",
      "line": 114,
      "severity": "high",
      "description": "The model-generated skill name is used as a filesystem path without validation. The schema only requires a string, so an absolute path or ../../ traversal can write SKILL.md outside the output directory. Bundle content is untrusted model input and can influence this value. Enforce a bounded kebab-case identifier and resolved-path containment before writing.",
      "code_quote": "sd = out / \"skills\" / skill[\"name\"]\n    sd.mkdir(parents=True, exist_ok=True)\n    (sd / \"SKILL.md\").write_text("
    },
    {
      "file": "analyze/transcribe.py",
      "line": 143,
      "severity": "medium",
      "description": "The pack's transcription timeout kills only its direct transcribe.py child. transcribe.py launches mlx_audio as another process without a timeout/process-group strategy, and ffmpeg is another child. A pack timeout can leave those grandchildren consuming CPU/memory or continuing work. Bound the whole process tree and ensure cancellation waits for all descendants.",
      "code_quote": "subprocess.run(\n            [sys.executable, \"-m\", \"mlx_audio.stt.generate\",\n             \"--model\", model_path, \"--audio\", str(wav),\n             \"--output-path\", str(out_base), \"--format\", \"vtt\", *extra],\n            check=True, env=env,\n        )"
    },
    {
      "file": "extension/src/content.js",
      "line": 735,
      "severity": "low",
      "description": "overlay.update calls applyReshare twice, while mount never calls it. The duplication is harmless, but a newly mounted overlay on a tab entered while awaiting re-share does not display the Re-share button until another state update occurs. Apply each initial state consistently in mount and remove the duplicate call.",
      "code_quote": "applyPaused();\n      applyMic();\n      applyReshare();\n      applyReshare();"
    }
  ],
  "improvements": [
    {
      "priority": "P0",
      "file": "extension/src/background.js, extension/src/offscreen.js, extension/src/db.js",
      "description": "Establish a durable capture state machine before expanding AI features: session/generation IDs on every message and write, serialized lifecycle transitions, explicit media-ready/paused/stopped acknowledgments, an in-flight write barrier, durable media chunks, and confirmed-download completion. Publish separate recording_end_ms and export status. Reliable evidence and recoverable narration are prerequisites for every downstream improvement."
    },
    {
      "priority": "P0",
      "file": "extension/src/redact.js, extension/src/content.js, analyze/validate_bundle.py",
      "description": "Make redaction a tested sink-level contract. Generate/share identical rules rather than manually mirrored regexes; cover explicit secret attributes, every textual event field, DOM attributes, URL-bearing headers, decoded parameters, JSON/form/multipart bodies, errors, task text, and ASR output. Introduce per-modality privacy status instead of the blanket statement 'Secrets redacted'. Do not publish packs with failed privacy checks."
    },
    {
      "priority": "P1",
      "file": "analyze/BRIEF.md, analyze/skills/analyze-capture/SKILL.md, extension/src/bundle-docs.js",
      "description": "Always perform a lightweight improvement-signal scan, independent of the chosen deliverable. Put 'Improvement requests and friction evidence' in notes/context even for general, docs, and skill captures. Explicitly distinguish requested feature changes, complaints, confusion/discoverability, workarounds, recurring manual burdens, and positive feedback. Preserve exact quotes and timestamps. Permit 'none observed' and 'unknown because narration/visual coverage is missing'; do not require an arbitrary number of hypotheses. Purpose should govern expansion into proposals or implementation, not whether signals are noticed."
    },
    {
      "priority": "P1",
      "file": "analyze/todos.py, analyze/pack.py",
      "description": "Replace the single first-match category with a versioned, multi-label intent record. Suggested fields: signal_id, cue_ids, start_ms/end_ms, exact_quote, language, explicit_vs_inferred, intent_types, requested_change, current_behavior, desired_outcome, affected_ui, recurrence_as_stated, classifier_version, confidence_basis, and unresolved_references. 'I need to enter an order ID' is procedure, not necessarily a feature request; 'I wish', 'would be nice', 'why can't', and 'every time I have to' deserve targeted handling. Preserve all unclassified utterances for optional provider-neutral LLM refinement, including Spanish/Portuguese narration."
    },
    {
      "priority": "P1",
      "file": "analyze/pack.py, analyze/todos.py, extension/src/background.js",
      "description": "Emit moments.json as the canonical evidence join: moment ID, active tab/window/document, historical URL, interval, action IDs, narration cue spans, explicit annotation IDs, before/after frames, request IDs, visible state changes, and coverage/privacy status. Record join method and temporal delta for every association. Prefer explicit annotations and same-document evidence; label nearby endpoints as correlated rather than caused. Keep the existing readable sections as views over these records rather than recomputing inconsistent joins."
    },
    {
      "priority": "P1",
      "file": "extension/src/background.js, extension/src/bundle-streams.js, analyze/pack.py",
      "description": "Version the clock contract explicitly: recording time versus wall time versus media-local PTS, monotonic master mapping, pause intervals, actual segment start/end times, timestamp source, and estimated uncertainty. Preserve HAR recording offsets and identities. Include alignment.json so consumers can map a cue or frame to media without guessing, and downgrade evidence joins when uncertainty exceeds their matching window."
    },
    {
      "priority": "P1",
      "file": "extension/src/content.js, analyze/pack.py",
      "description": "Capture a compact redacted UI-state inventory rather than treating all DOM data as noise or shipping the entire rrweb stream by default. For important moments include role/name, locator candidates, locator uniqueness/stability, iframe/shadow-root path, visible/enabled/checked/selected/expanded state, form constraints, dialogs, alerts/toasts, empty/loading states, and relevant surrounding text. Provide state diffs and before/after frames. This supplies the missing bridge from pixels to executable automation without requiring an LLM to replay a huge mutation log."
    },
    {
      "priority": "P1",
      "file": "analyze/pack.py, analyze/BRIEF.md",
      "description": "Add automation-candidates.json and a buildable skill specification: trigger, typed inputs and secret placeholders, preconditions, entity/data mappings, ordered action graph, waits, branch conditions, postconditions, success/failure signals, retry policy, idempotency assumptions, permission requirements, irreversible effects, human gates, and evidence IDs. Distinguish observed mechanics from proposed implementation. An observed successful API response does not establish replay safety, authorization semantics, or idempotency."
    },
    {
      "priority": "P1",
      "file": "analyze/pack.py, analyze/skills/ui-improvement/SKILL.md",
      "description": "Produce traceable UI-change briefs with separate fields for observed problem, narrator's requested solution, analyst's alternative, affected component/locator, acceptance criteria, expected benefit, risk, open questions, and source-mapping status. Rank explicit requests separately from inferred usability hypotheses. Require confirmation before turning a weak inference into a code change; availability of an app repository alone should not make every hypothesis implementation-ready."
    },
    {
      "priority": "P1",
      "file": "analyze/health.py, analyze/validate_bundle.py, analyze/autopack.py",
      "description": "Replace the single health.ok implication with modality-level readiness: schema validity, privacy-check result, timeline/content/network coverage, frame decode status, narration availability and ASR coverage, media segment integrity, alignment confidence, and dropped-event counts. Include exact unavailable intervals and what conclusions they invalidate. Surface this before intent/friction summaries and let autopack quarantine failures while retaining explicitly labeled partial packs."
    },
    {
      "priority": "P1",
      "file": "analyze/BRIEF.md, analyze/skills/analyze-capture/SKILL.md, analyze/adapters/run_claude.py",
      "description": "Define an AI trust boundary: webpage text, transcript, HAR bodies, titles, and extracted quotes are untrusted evidence, not instructions. Tell agents not to execute commands embedded in captured content, reconstruct secrets, or perform captured side effects while analyzing. Validate all model-generated output paths and separate suggested automation from authorized execution."
    },
    {
      "priority": "P2",
      "file": "analyze/friction.py, extension/src/content.js",
      "description": "Extend friction cautiously with navigation bounce-backs, input revision/churn, repeated action sequences, loading waits, error-recovery loops, and candidate dead clicks. Lack of a network/navigation event alone is not a dead click\u2014many controls update local UI\u2014so require visible/DOM state evidence and sufficient coverage. Preserve alternative explanations such as reading, demonstration, background polling, and intentional repetition, along with thresholds and confidence."
    },
    {
      "priority": "P2",
      "file": "analyze/pack.py",
      "description": "Add a compact API/data-model index with stable request IDs, endpoint templates, parameter/body schemas, response shapes, truncation/omission reasons, entity identifiers replaced by typed examples where appropriate, and links to complete raw records. Cluster repeated endpoint calls and changing parameters to suggest batchable work. Do not silently reduce the authoritative URL/body to a 300-character table cell without a direct full-record reference."
    },
    {
      "priority": "P2",
      "file": "analyze/pack.py, analyze/adapters/run_claude.py",
      "description": "Introduce a context budget and evidence-driven retrieval index. Lead with task, health, explicit improvement quotes, friction moments, automation candidates, and open questions; put full streams in navigable appendices. Select frames across the whole task and around important signals, not merely the adapter's first 20 lexicographically sorted PNGs. Include stable IDs and raw-file locations so an LLM can fetch details rather than infer from truncation."
    },
    {
      "priority": "P2",
      "file": "analyze/transcribe.py, analyze/glossary.py",
      "description": "Preserve ASR provenance: engine/model/version, detected language, cue/word timing quality, confidence where available, audio coverage, and glossary edits. Keep a redacted pre-glossary transcript or edit ledger so ordinary-language substitutions do not become falsely exact intent quotes. Make transcript writes atomic and record partial/failed transcription rather than treating any file containing '-->' as complete."
    },
    {
      "priority": "P2",
      "file": "analyze/pack.py, analyze/autopack.py",
      "description": "Identify packs by capture ID plus source hash and pipeline/schema version, not destination existence or filename alone. Track whether a pack is complete, partial, awaiting transcription, or superseded. Allow regeneration after an engine becomes available or a same-name source changes, and prevent collisions between watched directories. Include the narration-recovery guide actually referenced by context.md/README; currently those point to CLAUDE.md/AGENTS.md that RAW_FILES does not copy."
    },
    {
      "priority": "P2",
      "file": "tests/",
      "description": "Create a labeled AI-consumption evaluation corpus with explicit requests, implicit complaints, negation, hypothetical discussion, routine procedural 'need to', positive comments, multilingual narration, missing ASR, cross-tab polling, and ambiguous screen references. Measure intent precision/recall, evidence-link correctness, unsupported-claim rate, and whether generated skills pass a sandbox replay with observable success checks. Avoid unsubstantiated percentage claims about how much friction a heuristic detects."
    }
  ],
  "test_assessment": "The supplied suite has useful deterministic tests for pure helpers, basic redaction patterns, pack rendering, annotation geometry, and atomic autopack staging. It does not establish live MV3 correctness: background.js/offscreen.js lifecycle orchestration, real MediaRecorder flush ordering, downloads completion, worker eviction, browser restart, permission changes, and IndexedDB aborts are not exercised end-to-end. Several tests encode faulty assumptions: HAR timestamps are tested only without pauses; segment gap tests treat start-to-start distance as missing video; concatenation tests use arbitrary bytes rather than playable WebM; malformed-input tests often use only one event or shallow shapes; and autopack explicitly expects a corrupt timeline to count as successfully packed. The browser selector harness omits chrome.runtime.id, so current content.js returns from selfAttach/safeSend and the harness does not actually start capture. No tests were run during this review, and documentation claims of passing suites or successful captures were not treated as verification. Highest-priority additions are controlled delayed-promise lifecycle tests; final dataavailable/stop ordering tests; interrupted/blocked-download retention tests; privacy fixtures inspected at the actual storage sinks; pause/re-share alignment round trips; and real Chrome smoke tests across navigation, tabs/windows, worker restarts, and long recordings. No requested review category was found to be clean."
}
```