// Offscreen document: records the captured SCREEN/WINDOW video plus the user's
// MICROPHONE to a single webm via MediaRecorder, then hands the result back to
// the worker as a data URL. The worker drops it into the bundle as video.webm.
//
// v2: the video source is a desktopCapture stream (chromeMediaSource:"desktop"),
// so the recording follows the user across every tab and window — not pinned to
// one tab like v1's tabCapture. The worker picks the source via the screen picker
// and hands us its streamId.
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

let recorder = null;
let chunks = [];
let streams = []; // every MediaStream we open, so stop() can release them all
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
    await startRecording(msg.streamId, msg.withMic !== false, msg.source || "desktop");
  }
  if (msg.type === "offscreen-stop") {
    stopRecording();
  }
});

async function startRecording(streamId, withMic, source) {
  chunks = [];
  streams = [];
  micRecorded = false;
  micError = withMic ? null : "mic not requested";
  const tracks = [];

  // Screen/window video (v1 "tab" still supported for compatibility). Fatal if it
  // fails — there's no recording without it.
  const chromeMediaSource = source === "tab" ? "tab" : "desktop";
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId } },
    });
    streams.push(videoStream);
    tracks.push(...videoStream.getVideoTracks());
  } catch (e) {
    console.warn("offscreen video capture failed:", e);
    reportError("video capture failed: " + (e?.message || e), e?.stack);
    chrome.runtime.sendMessage({ type: "offscreen-video", dataUrl: null, mic: false, micError });
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

  try {
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
  } catch (e) {
    console.warn("offscreen MediaRecorder failed:", e);
    reportError("MediaRecorder failed: " + (e?.message || e), e?.stack);
    releaseStreams();
    recorder = null;
    chrome.runtime.sendMessage({ type: "offscreen-video", dataUrl: null, mic: false, micError });
  }
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
