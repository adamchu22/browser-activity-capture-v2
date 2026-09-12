// Offscreen document: records the captured SCREEN/WINDOW video plus the user's
// MICROPHONE to a single webm via MediaRecorder, then hands the result back to
// the worker as a data URL. The worker drops it into the bundle as video.webm.
//
// v2: the video source is the whole screen/window via getDisplayMedia(), called
// HERE in the offscreen document (created with the DISPLAY_MEDIA reason, which
// waives the user-gesture requirement). The recording follows the user across
// every tab and window — not pinned to one tab like v1's tabCapture. This is
// Chrome's recommended MV3 screen-capture path: a desktopCapture streamId minted
// elsewhere is NOT consumable here (throws "Invalid state"). getDisplayMedia
// shows its own picker; if the user cancels we report
// no video and the worker records data-only.
//
// Why the mic lives here: narration is one of the capture modalities, but the
// desktop video stream carries no microphone. So we open a second
// getUserMedia({audio:true}) stream for the mic and merge its audio track with the
// screen video track into one MediaStream before recording. Both tracks are
// produced in the same context on the same clock, so the narration in video.webm
// is aligned by construction — a transcript (Whisper/Parakeet) drops straight onto
// t0. See ../docs/02-design.md and ../extension/FIRST-CAPTURE.md.
//
// Permissions caveat: an MV3 offscreen document can't surface a mic permission
// prompt itself, and there is no "audioCapture" extension permission (that's a
// legacy Chrome Apps thing). So mic getUserMedia here only succeeds once the
// extension origin has been granted microphone access some other way; until then
// it throws and we fall back to video-only with mic:false (non-fatal). (Tab audio
// is intentionally NOT recorded — this path captures the narration, not page
// sound; that also sidesteps the tabCapture "audio is muted unless you pipe it
// back" gotcha.)

import { makeZip } from "./zip.js";
import { streamFiles } from "./bundle-streams.js";
import * as db from "./db.js";
import { segmentOffsetsFor, sealSegment } from "./segments.js";
import { recordingElapsed } from "./clock.js";

let mediaClock = {};
let reshareBusy = false;
let mediaGeneration = 0;
const stopped = new WeakMap();

function prepareRecorder(tracks) {
  const localChunks = [];
  const r = new MediaRecorder(new MediaStream(tracks), { mimeType: "video/webm" });
  chunks = localChunks;
  r.ondataavailable = (e) => { if (e.data.size) localChunks.push(e.data); };
  stopped.set(r, new Promise((resolve) => r.addEventListener("stop", resolve, { once: true })));
  return r;
}

async function stopRecorder(r) {
  if (!r) return;
  if (r.state !== "inactive") {
    r.stop();
    await stopped.get(r);
  } else {
    // An automatic stop queues final dataavailable before stop; allow those
    // queued tasks to finish before sealing an inactive recorder's chunks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function freshClock() {
  const clock = await chrome.runtime.sendMessage({ type: "media-clock" });
  if (!clock?.recording) throw new Error("Recording is no longer live");
  mediaClock = clock;
  return recordingElapsed(Date.now(), mediaClock);
}

let recorder = null;
let chunks = [];
// The finalized video, held HERE until the bundle is zipped + saved. Multi-segment:
// when the user re-shares after "Stop sharing", each segment is a separate,
// internally-self-clocking webm (its PTS starts at 0), so segments can NOT be
// byte-concatenated into one playable file — the second segment's timestamps
// restart at 0 (non-monotonic DTS) and the duplicate EBML header breaks ffmpeg
// seeks. Instead each segment is written as its own file (video.webm,
// video-2.webm, …) and the manifest's video_segments declares each file's
// recording-clock offset. Empty array = no video was captured (data-only take).
let finalizedSegments = []; // [{ blob, offsetMs }]
let streams = []; // every MediaStream we open, so stop() can release them all
let activeTracks = []; // the live screen+mic tracks, reused by restart without re-prompting
let micRecorded = false; // did the final recording actually include the mic?
let micError = null; // why the mic was absent (surfaced into the bundle manifest)
let captureSurface = null; // displaySurface of the share: "browser" | "window" | "monitor"
// Multi-segment video: when the user re-shares after "Stop sharing", the dead
// recorder's chunks are sealed into a segment Blob and a new recorder starts on
// the fresh screen track. The mic track is continuous across segments. At
// finalize each segment is written as its own file (see finalizedSegments) and
// the segment offsets are reported to the worker so the manifest can declare the
// gaps + each segment's file. segments[] holds { blob, offsetMs } where offsetMs
// is the recording clock (ms since t0) at which this segment's recorder STARTED
// — set by the worker via offscreen-reshare so segments map onto the shared event clock.
let videoSegments = []; // [{ blob, offsetMs }] — sealed segments from prior recorders
let segmentOffsetMs = 0; // the offset the NEXT segment will receive when it seals
let audioCtx = null; // Web Audio graph that taps the mic for the overlay level meter
let levelTimer = null; // interval pushing mic loudness to the worker
let keepAliveTimer = null; // pings the worker so the MV3 service worker can't be torn down mid-recording

// MV3 service workers are killed after ~30s with no incoming events. During a
// recording that's mostly fine (network + frame events keep it warm) — EXCEPT
// while paused, when the frame timer is stopped and event ingest is dropped, so
// nothing wakes the worker and Chrome terminates it. That wipes the worker's
// in-memory recording state (t0, frames, the tab list) and leaves the overlay
// dead — the user can no longer pause or finish, and the recording is lost. This
// offscreen document stays alive for the whole recording (it owns the live media
// stream), so it's the reliable place to hold the worker open: a periodic ping
// resets the worker's idle timer. (Persistence in the worker is the safety net
// for the rare case this still fails — see background.js rehydrate.)
function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: "keepalive" }).catch(() => {});
  }, 20000);
}
function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// Report a failure to the worker so it lands in the bundle's errors.json.
function reportError(message, stack) {
  chrome.runtime.sendMessage({ type: "capture-error", where: "offscreen", message, stack: stack || null }).catch(() => {});
}
self.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
self.addEventListener("unhandledrejection", (e) => reportError(e.reason?.message || String(e.reason), e.reason?.stack));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "offscreen-status") {
    sendResponse({
      live: !!recorder && recorder.state !== "inactive",
      finalized: finalizedSegments.length > 0,
      t0: mediaClock.t0,
    });
    return;
  }
  if (!msg.type?.startsWith("offscreen-")) return;
  if (msg.clock) mediaClock = msg.clock;
  handleMessage(msg).then(
    () => sendResponse({ ok: true }),
    (e) => {
      reportError(e?.message || String(e), e?.stack);
      sendResponse({ ok: false, reason: e?.message || String(e) });
    }
  );
  return true;
});

async function handleMessage(msg) {
  if (msg.type === "offscreen-start") {
    await startRecording(msg.withMic !== false);
  }
  if (msg.type === "offscreen-go") {
    // The worker's countdown finished — actually begin recording now, so the video
    // starts on the same t0 as the event/network streams (not when the picker
    // resolved, which could be seconds earlier while the user chose a window).
    try {
      if (recorder && recorder.state === "inactive") {
        segmentOffsetMs = recordingElapsed(Date.now(), mediaClock);
        recorder.start(1000);
        if (mediaClock.paused) recorder.pause();
      }
    } catch (e) {
      reportError("MediaRecorder start failed: " + (e?.message || e), e?.stack);
    }
  }
  if (msg.type === "offscreen-finalize") {
    await finalizeRecording();
  }
  // Overlay verbs, mirrored onto the MediaRecorder so the video pauses,
  // restarts, and discards in lockstep with the event/network streams.
  if (msg.type === "offscreen-pause") {
    try {
      if (recorder?.state === "recording") recorder.pause();
    } catch {}
  }
  if (msg.type === "offscreen-resume") {
    try {
      if (recorder?.state === "paused") recorder.resume();
    } catch {}
  }
  if (msg.type === "offscreen-restart") {
    await restartRecording();
  }
  if (msg.type === "offscreen-cancel") {
    cancelRecording();
  }
  // Re-share the screen after "Stop sharing" killed the video track. The worker
  // sends this in response to the user clicking the overlay's Re-share button.
  // We seal the dead recorder's chunks as a segment, open a fresh getDisplayMedia
  // picker (the DISPLAY_MEDIA reason on this offscreen doc waives the user-gesture
  // requirement, same as the initial arm), swap the new video track into
  // activeTracks (the mic track stays continuous), and start a new recorder. The
  // worker passes the recording-clock offset so each segment can be stamped with
  // the wall time it began — the manifest uses these offsets to map events to
  // segments and flag the gap to the analyst.
  if (msg.type === "offscreen-reshare") {
    await reshareRecording();
  }
  // Assemble the FULL bundle here and save it. This is the heart of the 64MiB fix:
  // the video Blob never leaves this document and the bulk streams are read straight
  // from IndexedDB, so nothing large is ever sent through a chrome.runtime message.
  // The worker passes only the small text meta files; we add timeline.json,
  // events.jsonl, network.har, the frame PNGs, and video.webm. Replies
  // offscreen-save-done.
  if (msg.type === "offscreen-save") {
    await assembleAndSave(msg.metaFiles, msg.filename, msg.t0Wall);
  }
}

async function assembleAndSave(metaFiles, filename, t0Wall) {
  const reply = (r) => chrome.runtime.sendMessage({ type: "offscreen-save-done", ...r }).catch(() => {});
  let zipBlob;
  try {
    // The bulk streams live in IndexedDB (written by the worker as the recording ran).
    const timeline = await db.readAll("timeline");
    const rrweb = await db.readAll("rrweb");
    const frames = await db.readAll("frames");
    const har = await db.readAll("har");
    const files = [...metaFiles, ...streamFiles(timeline, rrweb, frames, har, t0Wall)];
    // Multi-segment video: write each segment as its own file. The first
    // segment is `video.webm` (what the manifest's `video` field points at);
    // subsequent segments are `video-2.webm`, `video-3.webm`, … so the analyze
    // side can find each one. Each MediaRecorder segment is internally self-
    // clocking (PTS starts at 0), so they can't be byte-concatenated — keep
    // them separate. The manifest's video_segments declares each file's
    // recording-clock offset so events map onto the right segment.
    for (const seg of finalizedSegments) {
      if (seg.blob && seg.blob.size > 0) files.push({ name: seg.file, data: seg.blob });
    }
    zipBlob = await makeZip(files);
  } catch (e) {
    reportError("bundle assembly failed: " + (e?.message || e), e?.stack);
    return reply({ ok: false, reason: "assemble-failed" });
  }

  // Download to the browser's Downloads folder via an object URL from this DOM context
  // (the service worker can't createObjectURL, and chrome.downloads isn't available to
  // an offscreen doc). An object-URL <a download> streams the Blob with NO size limit —
  // the fix for the lost 17-min recording — and needs no folder picker or Save dialog.
  try {
    await triggerDownload(zipBlob, filename);
    finalizedSegments = [];
    return reply({ ok: true });
  } catch (e) {
    reportError("download failed: " + (e?.message || e), e?.stack);
    return reply({ ok: false, reason: "download-failed" });
  }
}

// Download a Blob from the offscreen document via a same-origin object URL + a
// programmatic <a download> click. Revoked after a long delay so a large file has
// time to finish streaming to disk before the URL is released.
async function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const result = await chrome.runtime.sendMessage({ type: "download-blob", url, filename });
    if (!result?.ok) throw new Error(result?.reason || "No download completion acknowledgement");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function capturedTabId(track) {
  const handle = track?.getCaptureHandle?.();
  if (handle?.origin !== chrome.runtime.getURL("").replace(/\/$/, "")) return null;
  const match = /^bac-tab:(\d+)$/.exec(handle.handle || "");
  return match ? Number(match[1]) : null;
}

async function startRecording(withMic) {
  chunks = [];
  streams = [];
  micRecorded = false;
  micError = withMic ? null : "mic not requested";
  captureSurface = null;
  const tracks = [];

  // Whole-screen/window video via getDisplayMedia (shows Chrome's "Choose what to
  // share" picker). Fatal if it fails — there's no recording without it. A user
  // cancel throws NotAllowedError; we report no video and the worker keeps the
  // data-only capture. Audio is NOT requested here — narration comes from the
  // separate mic stream below, kept on the same clock.
  try {
    const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    streams.push(videoStream);
    const vTracks = videoStream.getVideoTracks();
    tracks.push(...vTracks);
    // What did the user pick in the "Choose what to share" dialog — a tab ("browser"),
    // an OS window, or a whole monitor? The worker uses this to scope the overlay +
    // capture to the recorded surface so the menu doesn't leak onto other windows.
    captureSurface = vTracks[0]?.getSettings?.().displaySurface || null;
    // If the captured screen/window share ends on its own — the user closes the
    // shared window, or clicks Chrome's "Stop sharing" bar — the video track fires
    // `ended` and the recorder silently stops producing video while everything else
    // keeps going. Surface it so it lands in the bundle's errors.json AND tell the
    // worker, which marks the recording as having lost its video instead of failing
    // mute. (Audio/mic, if present, keeps recording.)
    vTracks.forEach((t) => {
      t.addEventListener("ended", () => {
        reportError("screen share ended mid-recording (video track stopped)");
        chrome.runtime.sendMessage({ type: "video-track-ended" }).catch(() => {});
      });
    });
  } catch (e) {
    console.warn("offscreen video capture failed:", e);
    reportError("video capture failed: " + (e?.message || e), e?.stack);
    // Picker cancelled / failed — tell the worker to proceed data-only (it still
    // runs the countdown and goes live). The null video is reported at stop time.
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false, mic: false }).catch(() => {});
    return;
  }

  // Microphone (narration). Non-fatal: if it's blocked or unavailable, we still
  // record video and just report mic:false so the manifest reflects reality.
  if (withMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micTracks = micStream.getAudioTracks();
      if (micTracks.length) {
        streams.push(micStream);
        tracks.push(...micTracks);
        micRecorded = true;
        startMicMeter(micStream); // feed the on-screen overlay's "is it hearing me?" meter
        // If the mic is revoked / unplugged mid-recording, the audio track fires
        // `ended` and the narration goes silent for the rest of the take while the
        // manifest would still claim narration_in_video:true (the analyst transcribes
        // silence with no clue why). Surface it like the video-track handler: report it
        // (errors.json) and tell the worker so it drops the level meter + flags the bundle.
        micTracks.forEach((t) => {
          t.addEventListener("ended", () => {
            reportError("microphone stopped mid-recording (narration truncated from here)");
            chrome.runtime.sendMessage({ type: "mic-track-ended" }).catch(() => {});
          });
        });
      } else {
        micError = "getUserMedia returned no audio tracks";
      }
    } catch (e) {
      micError = (e && (e.name + ": " + e.message)) || String(e);
      console.warn("offscreen microphone capture failed (recording video only):", e);
    }
  }

  activeTracks = tracks; // keep a handle so restart can reuse the live streams
  try {
    recorder = prepareRecorder(tracks);
    // NB: do NOT start() here — the worker runs a 3-2-1 countdown first, then sends
    // `offscreen-go`. Starting now would record the countdown seconds.
  } catch (e) {
    console.warn("offscreen MediaRecorder failed:", e);
    reportError("MediaRecorder failed: " + (e?.message || e), e?.stack);
    releaseStreams();
    recorder = null;
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false, mic: false }).catch(() => {});
    return;
  }
  // Keep the worker alive from here on — the recording is live (or about to be),
  // and the pause window is exactly when the worker would otherwise be torn down.
  startKeepAlive();
  // Picker done and recorder armed — tell the worker to run the countdown + go live.
  // `mic` lets the overlay know whether to show the live level meter; `surface` scopes
  // capture/overlay to what the user actually shared (tab/window/monitor).
  // micError rides along so the worker can flag a silent take AT ARM TIME
  // (log + clear the stale grant) instead of only at export.
  chrome.runtime.sendMessage({
    type: "offscreen-armed", video: true, mic: micRecorded, micError,
    surface: captureSurface, tabId: capturedTabId(tracks.find((t) => t.kind === "video")),
  }).catch(() => {});
}

// Live mic loudness for the on-screen overlay meter. An AnalyserNode taps the mic
// stream — NOT connected to any output, so there's no echo — and we sample RMS
// ~12×/sec and post it to the worker, which fans it out to the overlay. This is
// purely a UI signal; it never touches the recorded audio.
function startMicMeter(micStream) {
  try {
    const Ctx = self.AudioContext || self.webkitAudioContext;
    audioCtx = new Ctx();
    audioCtx.resume().catch((e) => reportError("mic meter resume failed: " + e.message));
    const source = audioCtx.createMediaStreamSource(micStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    levelTimer = setInterval(() => {
      // Rest the meter to 0 unless we're actively recording (pre-roll / paused → flat).
      if (!recorder || recorder.state !== "recording") {
        chrome.runtime.sendMessage({ type: "mic-level", level: 0 }).catch(() => {});
        return;
      }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Speech RMS is small; scale so normal narration fills most of the meter, clamp 0..1.
      const level = Math.min(1, rms * 3.6);
      chrome.runtime.sendMessage({ type: "mic-level", level: Math.round(level * 100) / 100 }).catch(() => {});
    }, 80);
  } catch (e) {
    reportError("mic meter failed: " + (e?.message || e), e?.stack);
  }
}

function stopMicMeter() {
  if (levelTimer) {
    clearInterval(levelTimer);
    levelTimer = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch {}
    audioCtx = null;
  }
}

// Stop the recorder and hold the finished video segments HERE (finalizedSegments)
// for the upcoming offscreen-save. Reports only status to the worker — no bytes —
// so the worker can build the manifest. The video bytes go into the zip in this
// document, each segment as its own file (see segmentOffsetsFor for the naming).
//
// Multi-segment: if the user re-shared after "Stop sharing", there are one or more
// sealed segment Blobs in videoSegments[] plus the live recorder's chunks. Each
// segment is a separate, internally-self-clocking webm (PTS starts at 0), so they
// can NOT be byte-concatenated — the second segment's timestamps would restart at 0
// and the duplicate EBML header breaks ffmpeg seeks. Keep them as separate files
// (video.webm, video-2.webm, …) and let the manifest's video_segments declare each
// file's recording-clock offset.
async function finalizeRecording() {
  ++mediaGeneration; // invalidate any picker still awaiting a result
  if (recorder) {
    await stopRecorder(recorder);
    const sealed = sealSegment(chunks, segmentOffsetMs);
    if (sealed) videoSegments.push(sealed);
    recorder = null;
    chunks = [];
  }
  if (videoSegments.length) {
    finalizedSegments = videoSegments.map((s, i) => ({
      ...s, file: i === 0 ? "video.webm" : `video-${i + 1}.webm`,
    }));
    videoSegments = [];
  }
  // Repeated finalize (Retry) must not replace retained media with an empty list.
  releaseStreams();
  chrome.runtime.sendMessage({
    type: "offscreen-finalized",
    mic: micRecorded,
    micError,
    hasVideo: finalizedSegments.some((s) => s.blob?.size > 0),
    segmentOffsets: segmentOffsetsFor(finalizedSegments),
  }).catch(() => {});
}

// Restart: drop the in-progress recording but keep the screen + mic streams
// LIVE, so a fresh take starts immediately with no second "Choose what to share"
// prompt. Clearing onstop first prevents the discarded recorder from shipping its
// bytes back as a finished video. Also discards any sealed re-share segments —
// the new take starts from zero segments.
async function restartRecording() {
  ++mediaGeneration;
  await stopRecorder(recorder);
  chunks = [];
  videoSegments = [];
  finalizedSegments = [];
  try {
    recorder = prepareRecorder(activeTracks.filter((t) => t.readyState === "live"));
    segmentOffsetMs = recordingElapsed(Date.now(), mediaClock);
    recorder.start(1000);
    if (mediaClock.paused) recorder.pause();
  } catch (e) {
    reportError("MediaRecorder restart failed: " + (e?.message || e), e?.stack);
    recorder = null;
  }
}

// Re-share: the screen share died (user clicked Chrome's "Stop sharing") and the
// user clicked Re-share on the overlay. Seal the dead recorder's chunks as a
// segment, open a FRESH getDisplayMedia picker (same DISPLAY_MEDIA waiver as the
// initial arm — the offscreen doc's reason is what waives the user-gesture
// requirement, not a carried gesture, so this works from an overlay click
// relayed through the worker), swap the new video track into activeTracks (mic
// stays continuous), and start a new recorder against the same recording clock.
// `newOffsetMs` is the recording-clock offset (ms since t0) at which the NEW
// segment begins — the dead segment is sealed with the offset that was in effect
// when IT started recording (the previous segmentOffsetMs), and segmentOffsetMs
// is then updated to newOffsetMs for the upcoming segment + the final chunk.
async function reshareRecording() {
  if (reshareBusy) return;
  reshareBusy = true;
  const g = mediaGeneration;
  try {
  // Keep the old recorder running while the picker is open: its independent
  // microphone track continues capturing narration. Seal only after selection.
  // Drop the dead screen track from activeTracks but KEEP the mic track (it's
  // independent of the screen share and should stay continuous across the gap).
  const micTracks = activeTracks.filter((t) => t.kind === "audio");
  // Stop the dead video track(s) so the "sharing" indicator clears before we
  // prompt again (getDisplayMedia rejects if a screen share is still live).
  activeTracks.filter((t) => t.kind === "video").forEach((t) => { try { t.stop(); } catch {} });
  // Remove the now-stopped screen MediaStream from `streams` so releaseStreams()
  // later doesn't try to stop already-stopped tracks (harmless but noisy). Keep
  // any stream that still has a LIVE track (the mic stream stays — it has an
  // audio track, not a video one, so the video filter below must OR over both).
  streams = streams.filter((s) => s.getTracks().some((t) => t.readyState === "live"));
  // Open a fresh screen picker. Same path as startRecording: a user cancel is
  // non-fatal — we keep the mic recording going and report reshare-failed so
  // the worker keeps awaitingReshare true and the overlay stays armed.
  let newVideoStream;
  try {
    newVideoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    streams.push(newVideoStream);
  } catch (e) {
    reportError("re-share screen picker failed: " + (e?.message || e), e?.stack);
    activeTracks = micTracks;
    // Keep the existing recorder and its narration, including future speech.
    chrome.runtime.sendMessage({ type: "reshare-failed" }).catch(() => {});
    return;
  }
  if (g !== mediaGeneration) {
    newVideoStream.getTracks().forEach((t) => t.stop());
    return;
  }
  const newVideoTracks = newVideoStream.getVideoTracks();
  if (!newVideoTracks.length) {
    reportError("re-share returned no video tracks");
    activeTracks = micTracks;
    chrome.runtime.sendMessage({ type: "reshare-failed" }).catch(() => {});
    return;
  }
  // Surface the new share's displaySurface (may differ from the original —
  // the user could pick a different window/tab on re-share).
  captureSurface = newVideoTracks[0]?.getSettings?.().displaySurface || captureSurface;
  // If this new share also stops on its own, surface it the same way (the user
  // can re-share again — multiple re-shares are supported, each becoming a segment).
  newVideoTracks.forEach((t) => {
    t.addEventListener("ended", () => {
      reportError("screen share ended mid-recording (video track stopped)");
      chrome.runtime.sendMessage({ type: "video-track-ended" }).catch(() => {});
    });
  });
  await stopRecorder(recorder);
  if (g !== mediaGeneration) {
    newVideoStream.getTracks().forEach((t) => t.stop());
    return;
  }
  const sealed = sealSegment(chunks, segmentOffsetMs);
  if (sealed) videoSegments.push(sealed);
  chunks = [];
  activeTracks = [...newVideoTracks, ...micTracks];
  try {
    segmentOffsetMs = await freshClock();
    if (g !== mediaGeneration) return;
    recorder = prepareRecorder(activeTracks);
    segmentOffsetMs = recordingElapsed(Date.now(), mediaClock);
    recorder.start(1000);
    if (mediaClock.paused) recorder.pause();
  } catch (e) {
    reportError("MediaRecorder re-share start failed: " + (e?.message || e), e?.stack);
    recorder = null;
    chrome.runtime.sendMessage({ type: "reshare-failed" }).catch(() => {});
    return;
  }
  chrome.runtime.sendMessage({
    type: "reshare-armed", surface: captureSurface, offsetMs: segmentOffsetMs,
    tabId: capturedTabId(newVideoTracks[0]),
  }).catch(() => {});
  } finally {
    reshareBusy = false;
  }
}

// Cancel: stop and discard everything, release the camera/mic/screen so the
// browser's "sharing" indicator clears. No video is sent back. Also discards
// any sealed re-share segments.
function cancelRecording() {
  ++mediaGeneration;
  if (recorder) {
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {}
  }
  chunks = [];
  videoSegments = [];
  finalizedSegments = []; // discard any finished take too
  releaseStreams();
  activeTracks = [];
  recorder = null;
}

function releaseStreams() {
  stopMicMeter();
  stopKeepAlive(); // recording is over — let the worker idle out normally
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
}
