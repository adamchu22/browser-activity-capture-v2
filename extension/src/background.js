// Service worker: the master clock and bundle assembler.
//
// It owns t0. Every modality is stamped as ms-since-t0 on arrival here, so the
// timeline, rrweb stream, network (HAR), and frames are all aligned by
// construction — no post-hoc syncing. On stop it assembles the Capture Bundle
// (the exact shape ../analyze/pack.py consumes) and downloads it as a zip.
//
// v2: capture is GLOBAL, not pinned to one tab. The screen video comes from
// getDisplayMedia() in the offscreen document (follows the user across tabs and
// windows), and the CDP debugger + content script are attached to EVERY eligible
// tab — including tabs opened mid-recording. Every event is tagged with its source
// tab so the merged one-clock timeline stays disambiguable.
//
// Heavy third-party pieces are integration points, not reimplemented:
//   - rrweb runs in the content script (raw DOM stream)
//   - video is recorded in an offscreen document via MediaRecorder
//   - full request/response bodies come from the CDP Network domain (chrome.debugger)

import { redactHeaders, redactBody, redactUrl, scrubTokens } from "./redact.js";
import { makeZip } from "./zip.js";
import * as db from "./db.js";
import { bundleReadme, bundleClaudeMd, bundleAgentsMd } from "./bundle-docs.js";

const state = {
  recording: false,
  paused: false,
  t0: 0,
  tabIds: new Set(), // every tab we've attached the debugger + content script to
  tabs: new Map(), // tabId -> { id, url, title } legend for the bundle
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
// We skip these tabs instead of half-attaching and logging noise.
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore/;

function isEligible(tab) {
  return !!(tab && tab.url && !RESTRICTED.test(tab.url));
}

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

// Attach the CDP debugger (for network) and the content script (for DOM/events)
// to one tab. Idempotent — safe to call again for a tab we already track.
async function instrumentTab(tabId) {
  if (!state.recording || state.tabIds.has(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isEligible(tab)) return;
  state.tabIds.add(tabId);
  const tabUrl = redactUrl(tab.url);
  state.tabs.set(tabId, { id: tabId, url: tabUrl, title: tab.title || "" });
  state.urls.add(tabUrl);

  // CDP network capture (shows the per-tab "is being debugged" banner — by design).
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  } catch (e) {
    logError("debugger", { message: `attach failed on tab ${tabId}: ${e?.message || e}`, stack: e?.stack });
  }

  const injected = await ensureContentScript(tabId);
  if (injected) chrome.tabs.sendMessage(tabId, { type: "start" }).catch(() => {});
}

async function uninstrumentTab(tabId) {
  if (!state.tabIds.has(tabId)) return;
  state.tabIds.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: "stop" }).catch(() => {});
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
}

async function start(triggerTabId, task, purposes) {
  if (state.recording) return { ok: false, error: "Already recording." };

  const { blocklist, micEnabled } = await getSettings();
  await db.clearAll();
  Object.assign(state, {
    recording: true,
    paused: false,
    t0: Date.now(),
    task: (task || "").slice(0, 500), // the user's stated goal — anchors the analysis
    purposes: Array.isArray(purposes) ? purposes.slice(0, 8) : [], // why they recorded — steers analysis
    tabIds: new Set(),
    tabs: new Map(),
    blocklist,
    har: new Map(),
    frames: [],
    urls: new Set(),
    errors: [],
  });

  // Pick the screen/window to record (full-screen video that follows the user
  // across tabs). If the user cancels the picker, keep going data-only.
  const hasVideo = await startVideo(micEnabled);

  // Instrument every eligible tab across all windows. New tabs opened during the
  // recording are picked up by the tabs.onUpdated listener below.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (isEligible(tab)) await instrumentTab(tab.id);
  }

  await captureFrame("recording started");
  setBadge("REC");
  return { ok: true, video: hasVideo, tabs: state.tabIds.size };
}

async function stop() {
  if (!state.recording) return;
  state.recording = false;

  for (const tabId of state.tabIds) {
    chrome.tabs.sendMessage(tabId, { type: "stop" }).catch(() => {});
    try {
      await chrome.debugger.detach({ tabId });
    } catch {}
  }
  state.tabIds.clear();

  const video = await stopVideo();
  if (video?.micError && video.micError !== "mic not requested") {
    logError("offscreen-mic", { message: video.micError });
  }

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

// Follow the user across tabs: instrument any tab that starts loading a real URL
// while we're recording (covers brand-new tabs and navigations to eligible pages),
// and drop tabs as they close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.recording) return;
  if (changeInfo.status === "loading" && isEligible(tab)) instrumentTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.recording) uninstrumentTab(tabId);
});

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
  if (!state.recording || !state.tabIds.has(source.tabId)) return;

  if (method === "Network.requestWillBeSent") {
    const { request, requestId, timestamp } = params;
    if (hostBlocked(request.url)) return;
    const reqUrl = redactUrl(request.url); // host/path intact; only secrets in the query masked
    state.urls.add(reqUrl);
    state.har.set(requestId, {
      _tab: source.tabId,
      _t: now(),
      startedDateTime: new Date().toISOString(),
      _start: timestamp,
      request: {
        method: request.method,
        url: reqUrl,
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
      tab: entry._tab,
    });
  }
});

function toHeaderArray(headers = {}) {
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
}

// Token-scrub a serialized rrweb node (DOM snapshot or mutation). Stringify →
// scrubTokens → parse catches a JWT/bearer anywhere in the tree (img src, href,
// inline text), where a per-field rule wouldn't reach. Falls back to the raw node
// only if (de)serialization fails — which it shouldn't for rrweb's plain JSON.
function scrubNode(node) {
  try {
    return JSON.parse(scrubTokens(JSON.stringify(node)));
  } catch {
    return node;
  }
}

// ---- timeline + rrweb from content script --------------------------------

async function appendTimeline(event) {
  if (!state.recording || state.paused) return;
  // Single chokepoint: any event carrying a URL gets it scrubbed before disk, so a
  // token in a query string can't ride into the timeline (nav + network events).
  if (event.url) event = { ...event, url: redactUrl(event.url) };
  await db.append("timeline", { t: now(), ...event });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "is-recording") {
    sendResponse({ recording: state.recording && !state.paused });
    return true;
  }
  if (msg.type === "timeline-event") {
    // Tag every event with its source tab so the merged one-clock timeline stays
    // disambiguable across tabs. The content script doesn't know its own tabId;
    // the worker reads it from the message sender.
    const tabId = sender.tab?.id;
    const e = { ...msg.event, tab: tabId };
    appendTimeline(e);
    if (e.kind === "nav" && tabId != null) {
      const navUrl = redactUrl(e.url);
      state.urls.add(navUrl);
      const info = state.tabs.get(tabId);
      if (info) info.url = navUrl; // keep the tab legend current as the user navigates
    }
    // Grab a frame on clicks, navigations, and pointer dwells — the moments
    // worth seeing. captureVisibleTab is rate-limited by Chrome (~1/s) and
    // hovers are deduped per element, so dwell frames can't flood the bundle.
    if (e.kind === "click" || e.kind === "nav" || e.kind === "hover") {
      captureFrame(e.kind);
    }
  }
  if (msg.type === "rrweb-event") {
    // rrweb serializes the live DOM — including attribute values like <img src> and
    // <a href> that can carry a token in their query string (?jwt=…). That stream
    // (events.jsonl) bypasses the URL/body scrubbers, so scrub the whole serialized
    // node for token shapes here. Same net as redactBody; lockstep with the
    // validator's TOKEN_RE. See learnings.md 2026-06-17.
    if (state.recording && !state.paused) db.append("rrweb", { t: now(), node: scrubNode(msg.node), tab: sender.tab?.id });
  }
  if (msg.type === "capture-error") {
    logError(msg.where || "unknown", { message: msg.message, stack: msg.stack });
  }
  if (msg.type === "popup-command") {
    if (msg.command === "start") {
      start(msg.tabId, msg.task, msg.purposes).then(sendResponse);
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
    // DISPLAY_MEDIA lets the offscreen doc call getDisplayMedia() (screen) without a
    // user gesture; USER_MEDIA covers the separate microphone getUserMedia() stream.
    reasons: ["DISPLAY_MEDIA", "USER_MEDIA"],
    justification: "Record the chosen screen/window and the user's microphone narration via MediaRecorder.",
  });
}

// Kicks off whole-screen video. The offscreen document does the actual work: it
// calls getDisplayMedia() itself (Chrome's recommended MV3 path — a desktopCapture
// streamId minted in the worker is NOT consumable in offscreen; see learnings.md
// 2026-06-17). The screen picker therefore appears asynchronously inside offscreen,
// so we can't know here whether the user picked or cancelled — the real outcome
// (a video.webm, or none) is reported back at stop time and recorded in the
// manifest. Returns true to mean "video was attempted".
async function startVideo(withMic) {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: "offscreen-start", withMic });
    return true;
  } catch (e) {
    logError("video", { message: "video capture unavailable: " + (e?.message || e), stack: e?.stack });
    return false;
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
    bundle_version: "0.2",
    capture_id: `capture-${new Date(state.t0).toISOString()}`,
    t0_wall: new Date(state.t0).toISOString(),
    duration_ms: duration,
    sync_mode: "self_record",
    // The user's stated goal for this recording — the single best anchor for intent.
    task: state.task || null,
    // Why they recorded (skill / docs / ux / improve / general) — steers the analysis.
    purposes: state.purposes || [],
    // v2: video is a full screen/window recording that spans every tab; events
    // carry a `tab` id and this legend maps each id to its page.
    capture_scope: "all_tabs",
    tabs: [...state.tabs.values()],
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
    tool_versions: { extension: "0.2.0", rrweb: "2.0.0" },
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
      entries: [...state.har.values()].map(({ _t, _start, _tab, ...e }) => e),
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
    // Self-driving instructions: the bundle alone is enough to analyze, with no
    // external pipeline. CLAUDE.md and AGENTS.md carry the same guidance for
    // Claude agents and the cross-agent AGENTS.md convention respectively.
    { name: "CLAUDE.md", data: bundleClaudeMd(manifest) },
    { name: "AGENTS.md", data: bundleAgentsMd(manifest) },
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

// bundleReadme, bundleClaudeMd, bundleAgentsMd are imported from ./bundle-docs.js
// (pure manifest→markdown functions, unit-tested in tests/test_bundle_docs.mjs).

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
