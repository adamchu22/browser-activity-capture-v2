// Offscreen document: records the captured SCREEN/WINDOW video plus the user's
// MICROPHONE to a single webm via MediaRecorder, then hands the result back to
// the worker as a data URL. The worker drops it into the bundle as video.webm.
//
// v2: the video source is the whole screen/window via getDisplayMedia(), called
// HERE in the offscreen document (created with the DISPLAY_MEDIA reason, which
// waives the user-gesture requirement). The recording follows the user across
// every tab and window — not pinned to one tab like v1's tabCapture. This is
// Chrome's recommended MV3 screen-capture path: a desktopCapture streamId minted
// elsewhere is NOT consumable here (throws "Invalid state") — see learnings.md
// 2026-06-17. getDisplayMedia shows its own picker; if the user cancels we report
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

let recorder = null;
let chunks = [];
let finalizedVideo = null; // the finished video Blob, held HERE until the bundle is zipped + saved
let streams = []; // every MediaStream we open, so stop() can release them all
let activeTracks = []; // the live screen+mic tracks, reused by restart without re-prompting
let micRecorded = false; // did the final recording actually include the mic?
let micError = null; // why the mic was absent (surfaced into the bundle manifest)
let captureSurface = null; // displaySurface of the share: "browser" | "window" | "monitor"
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
  chrome.runtime.sendMessage({ type: "capture-error", where: "offscreen", message, stack: stack || null });
}
self.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
self.addEventListener("unhandledrejection", (e) => reportError(e.reason?.message || String(e.reason), e.reason?.stack));

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "offscreen-start") {
    await startRecording(msg.withMic !== false);
  }
  if (msg.type === "offscreen-go") {
    // The worker's countdown finished — actually begin recording now, so the video
    // starts on the same t0 as the event/network streams (not when the picker
    // resolved, which could be seconds earlier while the user chose a window).
    try {
      if (recorder && recorder.state === "inactive") recorder.start(1000);
    } catch (e) {
      reportError("MediaRecorder start failed: " + (e?.message || e), e?.stack);
    }
  }
  if (msg.type === "offscreen-finalize") {
    finalizeRecording();
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
    restartRecording();
  }
  if (msg.type === "offscreen-cancel") {
    cancelRecording();
  }
  // Assemble the FULL bundle here and save it. This is the heart of the 64MiB fix:
  // the video Blob never leaves this document and the bulk streams are read straight
  // from IndexedDB, so nothing large is ever sent through a chrome.runtime message.
  // The worker passes only the small text meta files; we add timeline.json,
  // events.jsonl, the frame PNGs, and video.webm. Replies offscreen-save-done.
  if (msg.type === "offscreen-save") {
    assembleAndSave(msg.metaFiles, msg.filename);
  }
});

async function assembleAndSave(metaFiles, filename) {
  const reply = (r) => chrome.runtime.sendMessage({ type: "offscreen-save-done", ...r });
  let zipBlob;
  try {
    // The bulk streams live in IndexedDB (written by the worker as the recording ran).
    const timeline = await db.readAll("timeline");
    const rrweb = await db.readAll("rrweb");
    const frames = await db.readAll("frames");
    const files = [...metaFiles, ...streamFiles(timeline, rrweb, frames)];
    if (finalizedVideo && finalizedVideo.size) {
      files.push({ name: "video.webm", data: new Uint8Array(await finalizedVideo.arrayBuffer()) });
    }
    zipBlob = makeZip(files);
  } catch (e) {
    reportError("bundle assembly failed: " + (e?.message || e), e?.stack);
    return reply({ ok: false, reason: "assemble-failed" });
  }

  // Download to the browser's Downloads folder via an object URL from this DOM context
  // (the service worker can't createObjectURL, and chrome.downloads isn't available to
  // an offscreen doc). An object-URL <a download> streams the Blob with NO size limit —
  // the fix for the lost 17-min recording — and needs no folder picker or Save dialog.
  try {
    triggerDownload(zipBlob, filename);
    finalizedVideo = null;
    return reply({ ok: true });
  } catch (e) {
    reportError("download failed: " + (e?.message || e), e?.stack);
    return reply({ ok: false, reason: "download-failed" });
  }
}

// Download a Blob from the offscreen document via a same-origin object URL + a
// programmatic <a download> click. Revoked after a long delay so a large file has
// time to finish streaming to disk before the URL is released.
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 300000);
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
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false, mic: false });
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
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    // NB: do NOT start() here — the worker runs a 3-2-1 countdown first, then sends
    // `offscreen-go`. Starting now would record the countdown seconds.
  } catch (e) {
    console.warn("offscreen MediaRecorder failed:", e);
    reportError("MediaRecorder failed: " + (e?.message || e), e?.stack);
    releaseStreams();
    recorder = null;
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false, mic: false });
    return;
  }
  // Keep the worker alive from here on — the recording is live (or about to be),
  // and the pause window is exactly when the worker would otherwise be torn down.
  startKeepAlive();
  // Picker done and recorder armed — tell the worker to run the countdown + go live.
  // `mic` lets the overlay know whether to show the live level meter; `surface` scopes
  // capture/overlay to what the user actually shared (tab/window/monitor).
  chrome.runtime.sendMessage({ type: "offscreen-armed", video: true, mic: micRecorded, surface: captureSurface });
}

// Live mic loudness for the on-screen overlay meter. An AnalyserNode taps the mic
// stream — NOT connected to any output, so there's no echo — and we sample RMS
// ~12×/sec and post it to the worker, which fans it out to the overlay. This is
// purely a UI signal; it never touches the recorded audio.
function startMicMeter(micStream) {
  try {
    const Ctx = self.AudioContext || self.webkitAudioContext;
    audioCtx = new Ctx();
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

// Stop the recorder and hold the finished video Blob HERE (finalizedVideo) for the
// upcoming offscreen-save. Reports only status to the worker — no bytes — so the
// worker can build the manifest. The video bytes go into the zip in this document.
function finalizeRecording() {
  if (!recorder) {
    finalizedVideo = null;
    chrome.runtime.sendMessage({ type: "offscreen-finalized", mic: false, micError, hasVideo: false });
    return;
  }
  recorder.onstop = () => {
    finalizedVideo = new Blob(chunks, { type: "video/webm" });
    chunks = [];
    releaseStreams();
    recorder = null;
    chrome.runtime.sendMessage({
      type: "offscreen-finalized",
      mic: micRecorded,
      micError,
      hasVideo: finalizedVideo.size > 0,
    });
  };
  recorder.stop();
}

// Restart: drop the in-progress recording but keep the screen + mic streams
// LIVE, so a fresh take starts immediately with no second "Choose what to share"
// prompt. Clearing onstop first prevents the discarded recorder from shipping its
// bytes back as a finished video.
function restartRecording() {
  if (recorder) {
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {}
  }
  chunks = [];
  try {
    recorder = new MediaRecorder(new MediaStream(activeTracks), { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
  } catch (e) {
    reportError("MediaRecorder restart failed: " + (e?.message || e), e?.stack);
    recorder = null;
  }
}

// Cancel: stop and discard everything, release the camera/mic/screen so the
// browser's "sharing" indicator clears. No video is sent back.
function cancelRecording() {
  if (recorder) {
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {}
  }
  chunks = [];
  finalizedVideo = null; // discard any finished take too
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
