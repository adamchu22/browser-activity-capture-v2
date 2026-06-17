// Service worker: the master clock and bundle assembler.
//
// It owns t0. Every modality is stamped as ms-since-t0 on arrival here, so the
// timeline, rrweb stream, network (HAR), and frames are all aligned by
// construction — no post-hoc syncing. On stop it assembles the Capture Bundle
// (the exact shape ../analyze/pack.py consumes) and downloads it as a zip.
//
// Heavy third-party pieces are integration points, not reimplemented:
//   - rrweb runs in the content script (raw DOM stream)
//   - video is recorded in an offscreen document via MediaRecorder
//   - full request/response bodies come from the CDP Network domain (chrome.debugger)

import { redactHeaders, redactBody } from "./redact.js";
import { makeZip } from "./zip.js";
import * as db from "./db.js";

const state = {
  recording: false,
  paused: false,
  t0: 0,
  tabId: null,
  blocklist: [], // hostnames we never record on
  har: new Map(), // requestId -> partial HAR entry
  frames: [], // { t, file, dataUrl }
  urls: new Set(),
  errors: [], // { t, where, message, stack } — surfaced into the bundle
};

const now = () => Date.now() - state.t0;

// Collect a runtime error into the bundle so failures are diagnosable from the
// exported zip (errors.json) instead of being trapped in a console we can't see —
// the offscreen doc and content script both report here.
function logError(where, info = {}) {
  const message = info.message || String(info.error || info) || "unknown error";
  state.errors.push({ t: state.t0 ? now() : 0, where, message, stack: info.stack || null });
  console.warn(`[capture-error] ${where}: ${message}`);
}

// Uncaught failures in the service worker itself.
self.addEventListener("error", (e) => logError("background", { message: e.message, stack: e.error?.stack }));
self.addEventListener("unhandledrejection", (e) =>
  logError("background", { message: e.reason?.message || String(e.reason), stack: e.reason?.stack })
);

async function getSettings() {
  const { blocklist = [], micEnabled = true } = await chrome.storage.local.get([
    "blocklist",
    "micEnabled",
  ]);
  return { blocklist, micEnabled };
}

function hostBlocked(url) {
  try {
    return state.blocklist.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// ---- lifecycle -----------------------------------------------------------

// Pages where content scripts, captureVisibleTab, and the debugger all fail.
// Recording here can't work — refuse early with a clear reason instead of
// half-starting and producing an empty bundle.
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore/;

// The content script is registered for new page loads, but a tab opened BEFORE
// the extension loaded won't have it. Inject on demand so the first recording
// after install/reload still works.
async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "is-recording" });
    if (res) return true; // already there
  } catch {
    // no listener yet — fall through and inject
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/lib/rrweb.min.js", "src/content.js"],
    });
    return true;
  } catch (e) {
    console.warn("content-script injection failed:", e);
    return false;
  }
}

async function start(tabId) {
  if (state.recording) return { ok: false, error: "Already recording." };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || RESTRICTED.test(tab.url)) {
    return { ok: false, error: "Can't record this page (browser/internal page). Open a normal website tab." };
  }

  const { blocklist, micEnabled } = await getSettings();
  await db.clearAll();
  Object.assign(state, {
    recording: true,
    paused: false,
    t0: Date.now(),
    tabId,
    blocklist,
    har: new Map(),
    frames: [],
    urls: new Set(),
    errors: [],
  });

  // CDP network capture (shows the "is being debugged" banner — by design).
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  } catch (e) {
    console.warn("debugger attach failed (network capture disabled):", e);
  }

  await startVideo(tabId, micEnabled);
  const injected = await ensureContentScript(tabId);
  if (injected) chrome.tabs.sendMessage(tabId, { type: "start" }).catch(() => {});
  await captureFrame("recording started");
  setBadge("REC");
  return { ok: true, network: true, dom: injected };
}

async function stop() {
  if (!state.recording) return;
  state.recording = false;
  const tabId = state.tabId;

  chrome.tabs.sendMessage(tabId, { type: "stop" });
  const video = await stopVideo();
  if (video?.micError && video.micError !== "mic not requested") {
    logError("offscreen-mic", { message: video.micError });
  }
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}

  // MV3 service workers have no URL.createObjectURL, so we hand chrome.downloads
  // a base64 data: URL built from the zip bytes instead of a blob URL.
  try {
    const blob = await assembleBundle(video);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const url = `data:application/zip;base64,${base64FromBytes(bytes)}`;
    const stamp = new Date(state.t0).toISOString().replace(/[:.]/g, "-");
    await chrome.downloads.download({ url, filename: `capture-${stamp}.zip`, saveAs: true });
  } catch (e) {
    console.error("bundle export failed:", e);
  } finally {
    setBadge("");
  }
}

// btoa can't take a Uint8Array and chokes on huge strings, so encode in chunks.
function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function setBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
}

// ---- frames --------------------------------------------------------------

async function captureFrame(reason = "") {
  if (!state.recording || state.paused) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const t = now();
    const file = `frames/${String(t).padStart(10, "0")}.png`;
    state.frames.push({ t, file, dataUrl });
  } catch (e) {
    // captureVisibleTab can fail on chrome:// pages etc. — non-fatal.
    console.debug("frame capture skipped:", reason, e?.message);
  }
}

// ---- network (CDP -> HAR) ------------------------------------------------

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== state.tabId || !state.recording) return;

  if (method === "Network.requestWillBeSent") {
    const { request, requestId, timestamp } = params;
    if (hostBlocked(request.url)) return;
    state.urls.add(request.url);
    state.har.set(requestId, {
      _t: now(),
      startedDateTime: new Date().toISOString(),
      _start: timestamp,
      request: {
        method: request.method,
        url: request.url,
        headers: redactHeaders(toHeaderArray(request.headers)),
        postData: request.postData
          ? { mimeType: "application/json", text: redactBody(request.postData) }
          : undefined,
      },
      response: {},
    });
  }

  if (method === "Network.responseReceived") {
    const entry = state.har.get(params.requestId);
    if (!entry) return;
    const r = params.response;
    entry.response = {
      status: r.status,
      statusText: r.statusText,
      headers: redactHeaders(toHeaderArray(r.headers)),
      content: { mimeType: r.mimeType },
    };
    entry.time = Math.round((params.timestamp - entry._start) * 1000);
    // Also surface the request as a timeline event for the merged view.
    appendTimeline({
      kind: "network",
      method: entry.request.method,
      url: entry.request.url,
      status: r.status,
      ms: entry.time,
    });
  }
});

function toHeaderArray(headers = {}) {
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
}

// ---- timeline + rrweb from content script --------------------------------

async function appendTimeline(event) {
  if (!state.recording || state.paused) return;
  await db.append("timeline", { t: now(), ...event });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "is-recording") {
    sendResponse({ recording: state.recording && !state.paused });
    return true;
  }
  if (msg.type === "timeline-event") {
    const e = msg.event;
    appendTimeline(e);
    // Grab a frame on clicks, navigations, and pointer dwells — the moments
    // worth seeing. captureVisibleTab is rate-limited by Chrome (~1/s) and
    // hovers are deduped per element, so dwell frames can't flood the bundle.
    if (e.kind === "click" || e.kind === "nav" || e.kind === "hover") {
      if (e.kind === "nav") state.urls.add(e.url);
      captureFrame(e.kind);
    }
  }
  if (msg.type === "rrweb-event") {
    if (state.recording && !state.paused) db.append("rrweb", { t: now(), node: msg.node });
  }
  if (msg.type === "capture-error") {
    logError(msg.where || "unknown", { message: msg.message, stack: msg.stack });
  }
  if (msg.type === "popup-command") {
    if (msg.command === "start") {
      start(msg.tabId).then(sendResponse);
      return true; // async response
    }
    if (msg.command === "stop") {
      stop().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.command === "pause") state.paused = true;
    if (msg.command === "resume") state.paused = false;
    if (msg.command === "status") {
      sendResponse({ recording: state.recording, paused: state.paused });
      return true;
    }
  }
});

// ---- offscreen video -----------------------------------------------------

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the captured tab's video and the user's microphone narration via MediaRecorder.",
  });
}

async function startVideo(tabId, withMic) {
  try {
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    chrome.runtime.sendMessage({ type: "offscreen-start", streamId, withMic });
  } catch (e) {
    console.warn("video capture unavailable:", e);
  }
}

// Resolves with { dataUrl, mic } — mic reports whether the recording actually
// contains microphone narration (false if the user disabled it or it was
// blocked), so the manifest can record the truth.
function stopVideo() {
  return new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === "offscreen-video") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ dataUrl: msg.dataUrl || null, mic: !!msg.mic, micError: msg.micError || null });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: "offscreen-stop" });
    // don't hang export if video failed
    setTimeout(() => resolve({ dataUrl: null, mic: false, micError: "offscreen timed out" }), 4000);
  });
}

// ---- bundle assembly -----------------------------------------------------

async function assembleBundle(video) {
  const videoDataUrl = video?.dataUrl || null;
  const narrationInVideo = !!video?.mic;
  const timeline = (await db.readAll("timeline")).map(({ seq, ...e }) => e);
  const rrweb = (await db.readAll("rrweb")).map(({ seq, ...e }) => e);
  const duration = timeline.length ? timeline[timeline.length - 1].t : now();

  const manifest = {
    bundle_version: "0.1",
    capture_id: `capture-${new Date(state.t0).toISOString()}`,
    t0_wall: new Date(state.t0).toISOString(),
    duration_ms: duration,
    sync_mode: "self_record",
    video: videoDataUrl ? "video.webm" : null,
    // Whether video.webm contains the user's microphone narration (mixed in on
    // the same clock). If true, transcribing video.webm yields t0-aligned cues.
    narration_in_video: videoDataUrl ? narrationInVideo : false,
    // When narration is absent, why — so the bundle self-diagnoses instead of the
    // reason being trapped in the offscreen document's console. null if narration
    // recorded fine.
    narration_error: narrationInVideo ? null : (video?.micError || null),
    transcript: "transcript.vtt",
    browser: { name: "Chrome", version: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "?" },
    tool_versions: { extension: "0.1.0", rrweb: "2.0.0" },
    urls_visited: [...state.urls],
    redaction: {
      policy: "mask_secrets_and_auth",
      password_fields_masked: true,
      redacted_headers: ["Authorization", "Cookie", "Set-Cookie"],
      redacted_value_token: "‹redacted›",
    },
    frames: state.frames.map((f) => ({ t: f.t, file: f.file })),
    counts: {
      events: timeline.length,
      network: [...state.har.values()].length,
      frames: state.frames.length,
      errors: state.errors.length,
    },
  };

  const har = {
    log: {
      version: "1.2",
      creator: { name: "browser-activity-capture", version: "0.1.0" },
      comment: `t0_wall=${manifest.t0_wall}. Auth headers and cookies redacted before write.`,
      entries: [...state.har.values()].map(({ _t, _start, ...e }) => e),
    },
  };

  const files = [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: "timeline.json", data: JSON.stringify(timeline, null, 2) },
    { name: "events.jsonl", data: rrweb.map((e) => JSON.stringify(e)).join("\n") },
    { name: "network.har", data: JSON.stringify(har, null, 2) },
    { name: "transcript.vtt", data: buildTranscript(timeline) },
    { name: "errors.json", data: JSON.stringify(state.errors, null, 2) },
    { name: "README.md", data: bundleReadme(manifest) },
  ];
  for (const f of state.frames) files.push({ name: f.file, data: dataUrlToBytes(f.dataUrl) });
  if (videoDataUrl) files.push({ name: "video.webm", data: dataUrlToBytes(videoDataUrl) });

  await db.clearAll();
  return makeZip(files);
}

// The extension captures narration timing as `speech` timeline events if a
// transcriber feeds them in; absent that, emit a stub the user replaces with a
// real transcript (Whisper, etc.). See README.
function buildTranscript(timeline) {
  const cues = timeline.filter((e) => e.kind === "speech");
  if (!cues.length) return "WEBVTT\n\nNOTE No narration captured. Drop a transcript here.\n";
  const fmt = (t) => {
    const s = Math.floor(t / 1000);
    return `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`;
  };
  let out = "WEBVTT\n\n";
  cues.forEach((c, i) => {
    const next = cues[i + 1]?.t ?? c.t + 3000;
    out += `${fmt(c.t)} --> ${fmt(next)}\n${c.text}\n\n`;
  });
  return out;
}

function bundleReadme(m) {
  return `# Capture Bundle — ${m.capture_id}

Portable recording of one browser task, aligned on one clock (ms since t0).
Hand it to ../analyze/pack.py to produce an analysis pack for any agent.

- manifest.json — metadata, redaction policy, frame index
- timeline.json — merged event stream (nav/speech/click/input/key/network)
- events.jsonl — raw rrweb DOM stream
- network.har  — HTTP requests (auth/cookies redacted)
- transcript.vtt — narration (replace stub with a real transcript if needed)
- frames/ — screenshots at key moments
${m.video ? `- video.webm — screen recording${m.narration_in_video ? " (includes microphone narration, aligned to t0)" : " (no microphone narration)"}\n` : ""}`;
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
