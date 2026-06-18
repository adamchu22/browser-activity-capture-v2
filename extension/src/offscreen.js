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

import { loadExportDir } from "./fsdir.js";

let recorder = null;
let chunks = [];
let streams = []; // every MediaStream we open, so stop() can release them all
let activeTracks = []; // the live screen+mic tracks, reused by restart without re-prompting
let micRecorded = false; // did the final recording actually include the mic?
let micError = null; // why the mic was absent (surfaced into the bundle manifest)

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
  if (msg.type === "offscreen-stop") {
    stopRecording();
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
  // Write the finished bundle into the user's chosen folder via the File System
  // Access handle (this doc is a Window context, so it can createWritable(); the
  // service worker can't). Replies offscreen-saved {ok, reason}; the worker falls
  // back to a Downloads download when ok is false.
  if (msg.type === "offscreen-save-file") {
    saveToChosenDir(msg.dataUrl, msg.filename);
  }
});

async function saveToChosenDir(dataUrl, filename) {
  const reply = (r) => chrome.runtime.sendMessage({ type: "offscreen-saved", ...r });
  try {
    const dir = await loadExportDir();
    if (!dir) return reply({ ok: false, reason: "no-dir" }); // never picked → Downloads
    // queryPermission (no gesture here): 'granted' if still authorized this session
    // or persisted; otherwise it lapsed (e.g. browser restart) → caller re-prompts.
    const perm = await dir.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return reply({ ok: false, reason: "permission" });
    const blob = await (await fetch(dataUrl)).blob(); // data: URL → bytes
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    reply({ ok: true });
  } catch (e) {
    reportError("fsdir-save failed: " + (e?.message || e), e?.stack);
    reply({ ok: false, reason: "error" });
  }
}

async function startRecording(withMic) {
  chunks = [];
  streams = [];
  micRecorded = false;
  micError = withMic ? null : "mic not requested";
  const tracks = [];

  // Whole-screen/window video via getDisplayMedia (shows Chrome's "Choose what to
  // share" picker). Fatal if it fails — there's no recording without it. A user
  // cancel throws NotAllowedError; we report no video and the worker keeps the
  // data-only capture. Audio is NOT requested here — narration comes from the
  // separate mic stream below, kept on the same clock.
  try {
    const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    streams.push(videoStream);
    tracks.push(...videoStream.getVideoTracks());
  } catch (e) {
    console.warn("offscreen video capture failed:", e);
    reportError("video capture failed: " + (e?.message || e), e?.stack);
    // Picker cancelled / failed — tell the worker to proceed data-only (it still
    // runs the countdown and goes live). The null video is reported at stop time.
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false });
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
    chrome.runtime.sendMessage({ type: "offscreen-armed", video: false });
    return;
  }
  // Picker done and recorder armed — tell the worker to run the countdown + go live.
  chrome.runtime.sendMessage({ type: "offscreen-armed", video: true });
}

function stopRecording() {
  if (!recorder) {
    chrome.runtime.sendMessage({ type: "offscreen-video", dataUrl: null, mic: false, micError });
    return;
  }
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const dataUrl = await blobToDataUrl(blob);
    releaseStreams();
    recorder = null;
    chrome.runtime.sendMessage({ type: "offscreen-video", dataUrl, mic: micRecorded, micError });
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
  releaseStreams();
  activeTracks = [];
  recorder = null;
}

function releaseStreams() {
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}
