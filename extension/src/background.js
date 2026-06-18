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
import { navActions } from "./nav-policy.js";
import { hostOnBlocklist } from "./blocklist.js";
import { recordingElapsed } from "./clock.js";

const state = {
  recording: false,
  arming: false, // picker open / countdown running, before capture goes live
  activeTabId: null, // the tab Start was pressed in — instrumented when we go live
  paused: false, // EFFECTIVE pause (manual || auto) — what the recorder/overlay see
  manualPaused: false, // user pressed Pause
  autoPaused: false, // active tab is blocklisted → capture suspended automatically
  pauseReason: null, // "manual" | "blocklist" — drives the overlay copy
  pausedAccum: 0, // total ms spent paused so far (completed pauses)
  pauseStartedAt: 0, // wall-clock ms the current pause began (0 if not paused)
  t0: 0,
  tabIds: new Set(), // every tab we've attached the debugger + content script to
  tabs: new Map(), // tabId -> { id, url, title } legend for the bundle
  blocklist: [], // hostnames we never record on
  har: new Map(), // requestId -> partial HAR entry
  urls: new Set(),
  errors: [], // { t, where, message, stack } — surfaced into the bundle
  micActive: false, // is the mic actually being recorded? drives the overlay level meter
};

// The recording clock: ms since t0 with all PAUSED time removed, so event/frame
// timestamps stay aligned to video.webm (the MediaRecorder also excludes paused
// time). Before t0 is set (arming/countdown) it reads 0. Pure math lives in
// clock.js (unit-tested); this just feeds it the live state.
const now = () => recordingElapsed(Date.now(), state);

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
  const {
    blocklist = [],
    micEnabled = true,
    saveMode = "folder",
  } = await chrome.storage.local.get(["blocklist", "micEnabled", "saveMode"]);
  // saveMode: "folder" = write into the user's chosen folder (File System Access),
  // falling back to Downloads if none is set / access lapsed; "ask" = native Save
  // dialog every time.
  return { blocklist, micEnabled, saveMode };
}

// Suffix-aware host match (so `1password.com` blocks `my.1password.com`) — see
// blocklist.js. The old exact-string check silently failed and let a sensitive
// tab through.
const hostBlocked = (url) => hostOnBlocklist(url, state.blocklist);

// ---- lifecycle -----------------------------------------------------------

// Pages where content scripts, captureVisibleTab, and the debugger all fail.
// We skip these tabs instead of half-attaching and logging noise.
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore/;

function isEligible(tab) {
  // Skip restricted pages AND the user's "Never record on" hosts — a blocklisted
  // host must not be instrumented at all (no debugger, no content script, no DOM /
  // clicks / frames), not merely have its network rows dropped from the HAR.
  return !!(tab && tab.url && !RESTRICTED.test(tab.url) && !hostBlocked(tab.url));
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
  // A page title can carry a token (e.g. a "Reset password: <token>" page) and the
  // legend is exported, so scrub it before it lands in the manifest.
  state.tabs.set(tabId, { id: tabId, url: tabUrl, title: scrubTokens(tab.title || "") });
  state.urls.add(tabUrl);

  // CDP network capture (shows the per-tab "is being debugged" banner — by design).
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  } catch (e) {
    logError("debugger", { message: `attach failed on tab ${tabId}: ${e?.message || e}`, stack: e?.stack });
  }

  const injected = await ensureContentScript(tabId);
  // Carry the full clock so a tab that joins mid-recording renders its overlay in
  // the correct state (paused-aware elapsed clock, paused or live).
  if (injected)
    chrome.tabs.sendMessage(tabId, { type: "start", ...overlayClock() }).catch(() => {});
}

// Re-arm a tab AFTER A NAVIGATION. A full-page navigation (every click in a
// server-rendered app) tears down the content script — but the CDP debugger
// stays attached to the tab, so network keeps recording while clicks/rrweb/frames
// silently die for the rest of the page's life. (This is the bug that lost
// ~4.5 min of a 6 min server-rendered session: only network survived.) The
// freshly-loaded content script is supposed to self-attach, but that single
// fire-and-forget check is unreliable; the worker stays alive throughout (the
// debugger keeps it warm), so we re-push capture from here on every navigation.
// We deliberately do NOT touch the debugger — it survives the navigation. See
// learnings.md 2026-06-17.
async function reattachTab(tabId, tab) {
  if (!state.recording || !state.tabIds.has(tabId)) return;
  // Keep the tab legend + URL set current as the user navigates.
  if (tab?.url) {
    const u = redactUrl(tab.url);
    state.urls.add(u);
    const info = state.tabs.get(tabId);
    if (info) info.url = u;
  }
  const present = await ensureContentScript(tabId);
  if (present)
    chrome.tabs.sendMessage(tabId, { type: "start", ...overlayClock() }).catch(() => {});
}

async function uninstrumentTab(tabId) {
  if (!state.tabIds.has(tabId)) return;
  state.tabIds.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: "stop" }).catch(() => {});
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
}

const COUNTDOWN_SECONDS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(triggerTabId, task, purposes) {
  if (state.recording || state.arming) return { ok: false, error: "Already recording." };
  // Claim the lock SYNCHRONOUSLY, before any await — otherwise a second Start (double
  // click, or popup + overlay) slips through the guard during getSettings/clearAll and
  // opens a second picker + countdown, and the second clearAll wipes the first take.
  state.arming = true;

  const { blocklist, micEnabled, saveMode } = await getSettings();
  await db.clearAll();
  // Reset any offscreen doc left over from a previous (possibly worker-killed) session
  // so a stale getDisplayMedia stream is released and we don't stack a second picker.
  await closeOffscreen();

  let activeTabId = triggerTabId;
  if (activeTabId == null) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = active?.id;
  }

  // ARMING phase: the screen picker is up and a 3-2-1 countdown will run before
  // capture goes live. recording stays FALSE through all of it, so NOTHING is
  // recorded during the pre-roll — is-recording answers false, appendTimeline and
  // rrweb ingest drop, frames don't fire. t0 is set in goLive() at the END of the
  // countdown, so the clock starts exactly when capture does.
  Object.assign(state, {
    recording: false,
    arming: true,
    activeTabId,
    paused: false,
    manualPaused: false,
    autoPaused: false,
    pauseReason: null,
    pausedAccum: 0,
    pauseStartedAt: 0,
    t0: 0,
    task: (task || "").slice(0, 500), // the user's stated goal — anchors the analysis
    purposes: Array.isArray(purposes) ? purposes.slice(0, 8) : [], // why they recorded — steers analysis
    tabIds: new Set(),
    tabs: new Map(),
    blocklist,
    saveMode, // "folder" (chosen dir, fallback Downloads) | "ask" (native Save dialog)
    har: new Map(),
    urls: new Set(),
    errors: [],
    videoEndedEarly: false, // set if the screen share stops on its own mid-recording
    micActive: false, // confirmed once the offscreen doc reports the mic track is live
  });

  setBadge("•••", "#f39c12"); // arming (amber) — distinct from REC
  // Open the screen picker in the offscreen doc. When the user finishes the picker,
  // offscreen replies `offscreen-armed`; runCountdownThenGo() then runs the 3-2-1
  // and goes live. If the offscreen layer is unavailable, go live data-only.
  const attempted = await startVideo(micEnabled);
  if (!attempted) runCountdownThenGo();
  return { ok: true, arming: true };
}

// Picker done → 3-2-1 countdown in the active tab → go live. The countdown is shown
// by the content script (injected if needed; it stays inert for capture because
// recording is still false). Bails at every step if stop()/cancel() raced us.
async function runCountdownThenGo() {
  if (!state.arming) return;
  const tabId = state.activeTabId;
  if (tabId != null) {
    await ensureContentScript(tabId);
    for (let n = COUNTDOWN_SECONDS; n >= 1; n--) {
      if (!state.arming) return;
      chrome.tabs.sendMessage(tabId, { type: "countdown", n }).catch(() => {});
      await sleep(1000);
    }
    chrome.tabs.sendMessage(tabId, { type: "countdown", n: 0 }).catch(() => {}); // clear it
  }
  if (!state.arming) return;
  await goLive();
}

// Capture actually begins here: set t0, flip recording on, instrument the active
// tab for real (mounts the pill, starts rrweb + listeners), and tell the offscreen
// recorder to start — all against the fresh t0. Other tabs are instrumented lazily
// when the user switches into them (tabs.onActivated), so we capture what they
// actually do, not every open tab. See nav-policy.js / learnings.md 2026-06-17.
async function goLive() {
  if (!state.arming) return;
  state.arming = false;
  state.recording = true;
  state.paused = false;
  state.manualPaused = false;
  state.autoPaused = false;
  state.pauseReason = null;
  state.pausedAccum = 0;
  state.pauseStartedAt = 0;
  state.t0 = Date.now();
  // Re-resolve the active tab: the user may have closed or switched away from the
  // Start tab during the picker/countdown. Instrument the tab they're actually on
  // now — otherwise we'd go live with NO DOM/event capture (a dead/ineligible tab
  // silently instruments nothing) until they happen to switch tabs.
  let tabId = state.activeTabId;
  const stillUsable = tabId != null && (await chrome.tabs.get(tabId).then(isEligible).catch(() => false));
  if (!stillUsable) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = active?.id ?? null;
    state.activeTabId = tabId;
  }
  if (tabId != null) await instrumentTab(tabId);
  chrome.runtime.sendMessage({ type: "offscreen-go" }).catch(() => {}); // recorder.start()
  await captureFrame("recording started");
  startFrameTimer();
  setBadge("REC");
  // If they happened to go live while looking at a blocklisted tab, suspend at once.
  updateAutoPause();
}

async function stop() {
  if (!state.recording) return;
  state.recording = false;
  stopFrameTimer();

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

  // MV3 service workers have no URL.createObjectURL, so we build a base64 data: URL
  // from the zip bytes — handed to either the offscreen FSA writer or chrome.downloads.
  try {
    const blob = await assembleBundle(video);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const url = `data:application/zip;base64,${base64FromBytes(bytes)}`;
    const stamp = new Date(state.t0).toISOString().replace(/[:.]/g, "-");
    const filename = `capture-${stamp}.zip`;
    await exportBundle(url, filename);
  } catch (e) {
    console.error("bundle export failed:", e);
  } finally {
    setBadge("");
  }
}

// Route the finished zip to its destination per the save mode:
//   "folder" → write into the user's chosen folder via the offscreen FSA writer;
//              fall back to a Downloads download if no folder is set or access
//              lapsed (and flag the popup to re-pick so access is restored).
//   "ask"    → chrome.downloads with the native Save dialog (pick anywhere + rename).
async function exportBundle(url, filename) {
  if (state.saveMode === "ask") {
    await chrome.downloads.download({ url, filename, saveAs: true });
    return;
  }
  const res = await saveToChosenFolder(url, filename);
  if (res.ok) return;
  // Couldn't use the chosen folder — never lose the recording: save to Downloads.
  if (res.reason === "permission" || res.reason === "error" || res.reason === "timeout") {
    // A folder WAS chosen but we couldn't write it — ask the popup to re-pick.
    chrome.storage.local.set({ exportDirNeedsRegrant: true });
  }
  await chrome.downloads.download({ url, filename, saveAs: false });
}

// Ask the offscreen document (a Window context that can createWritable) to write
// the bundle into the chosen folder. Resolves {ok, reason}.
function saveToChosenFolder(dataUrl, filename) {
  return new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === "offscreen-saved") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ ok: !!msg.ok, reason: msg.reason || null });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: "offscreen-save-file", dataUrl, filename }).catch(() => {});
    // If the offscreen doc is gone (data-only capture, killed worker), don't hang.
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ ok: false, reason: "timeout" });
    }, 6000);
  });
}

// ---- overlay controls: pause / resume / restart / cancel -----------------
//
// These are the on-screen overlay's verbs (also reachable from the popup). The
// worker owns the semantics; the offscreen MediaRecorder is told to match so the
// video and the event/network streams pause, restart, and discard together.

// One pause engine. The effective pause is (manual OR auto-on-blocklisted-tab);
// when it flips we pause/resume the MediaRecorder, the frame timer, and the
// event/rrweb intake in lockstep, and book the paused duration into pausedAccum so
// the recording clock excludes it. Manual and auto are independent inputs: leaving
// a blocklisted tab clears the AUTO pause but never overrides a manual one.
function applyPause() {
  if (!state.recording) return;
  const effective = state.manualPaused || state.autoPaused;
  if (effective === state.paused) {
    // No transition, but the REASON may have changed (e.g. user hit Pause while
    // already auto-paused on a blocklisted tab) — keep the overlay copy honest.
    const reason = state.manualPaused ? "manual" : state.autoPaused ? "blocklist" : null;
    if (reason !== state.pauseReason) {
      state.pauseReason = reason;
      broadcastOverlay();
    }
    return;
  }
  state.paused = effective;
  if (effective) {
    state.pauseStartedAt = Date.now(); // start metering paused time
    state.pauseReason = state.manualPaused ? "manual" : "blocklist";
    stopFrameTimer();
    chrome.runtime.sendMessage({ type: "offscreen-pause" }).catch(() => {});
    setBadge("❚❚", "#f39c12"); // amber = paused
    // A blocklist auto-pause happens on a tab with NO overlay (it's uninstrumented),
    // so the on-page pill can't say why. The icon tooltip carries the reason.
    chrome.action.setTitle({
      title: state.autoPaused ? "Paused — on a blocklisted site (not recording)" : "Recording paused",
    });
  } else {
    state.pausedAccum += Date.now() - state.pauseStartedAt; // bank this pause
    state.pauseStartedAt = 0;
    state.pauseReason = null;
    startFrameTimer();
    chrome.runtime.sendMessage({ type: "offscreen-resume" }).catch(() => {});
    setBadge("REC");
    chrome.action.setTitle({ title: "Recording" });
  }
  broadcastOverlay();
}

function pause() {
  if (!state.recording) return;
  state.manualPaused = true;
  applyPause();
}

function resume() {
  if (!state.recording) return;
  state.manualPaused = false;
  applyPause();
}

// Auto-pause when the user is looking at a blocklisted tab, auto-resume when they
// leave. Called on tab switch / window focus / navigation. The active tab of the
// last-focused window is the one the screen video is showing, so that's what
// gates capture.
async function updateAutoPause() {
  if (!state.recording) return;
  let blocked = false;
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    blocked = !!(active && active.url && hostBlocked(active.url));
  } catch {}
  if (blocked !== state.autoPaused) {
    state.autoPaused = blocked;
    applyPause();
  }
}

// Restart: throw away everything captured so far and begin a fresh take WITHOUT
// re-prompting the screen picker. The same tabs stay instrumented (their content
// scripts keep recording) and the offscreen doc reuses the live screen/mic
// streams; we just reset t0 and clear the buffers, so the new take is clean.
async function restart() {
  if (!state.recording) return;
  await db.clearAll();
  state.t0 = Date.now();
  state.paused = false;
  state.manualPaused = false;
  state.autoPaused = false;
  state.pauseReason = null;
  state.pausedAccum = 0; // fresh take → fresh clock, no banked pause time
  state.pauseStartedAt = 0;
  state.har = new Map(); // db.clearAll() above already wiped the frames store
  state.errors = [];
  state.videoEndedEarly = false;
  // Reseed the URL set from the still-instrumented tabs' current pages.
  state.urls = new Set();
  for (const info of state.tabs.values()) if (info.url) state.urls.add(info.url);
  startFrameTimer(); // reset the cadence onto the new t0
  chrome.runtime.sendMessage({ type: "offscreen-restart" }).catch(() => {});
  // Tell each still-attached tab to re-emit its rrweb full snapshot against the
  // new t0 — the cleared events.jsonl has no base snapshot to replay from otherwise.
  for (const tabId of state.tabIds) chrome.tabs.sendMessage(tabId, { type: "restart" }).catch(() => {});
  await captureFrame("recording restarted");
  setBadge("REC");
  broadcastOverlay(); // new t0 resets every overlay's elapsed clock
}

// Cancel: stop recording and discard — no bundle, no download. Tears down the
// overlay in every tab, detaches debuggers, and drops the in-progress video.
async function cancel() {
  if (!state.recording && !state.arming) return;
  // If we're still arming (picker/countdown), abort it: clearing the flag makes
  // runCountdownThenGo() bail, and we clear any countdown number from the tab.
  if (state.arming && state.activeTabId != null) {
    chrome.tabs.sendMessage(state.activeTabId, { type: "countdown", n: 0 }).catch(() => {});
  }
  state.recording = false;
  state.arming = false;
  state.paused = false;
  state.manualPaused = false;
  state.autoPaused = false;
  state.pauseReason = null;
  state.pauseStartedAt = 0;
  stopFrameTimer();
  for (const tabId of state.tabIds) {
    chrome.tabs.sendMessage(tabId, { type: "stop" }).catch(() => {}); // removes overlay + listeners
    try {
      await chrome.debugger.detach({ tabId });
    } catch {}
  }
  state.tabIds.clear();
  chrome.runtime.sendMessage({ type: "offscreen-cancel" }).catch(() => {}); // discard video, release streams
  await db.clearAll();
  setBadge("");
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

function setBadge(text, color = "#c0392b") {
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color });
}

// Push the live recording state to every instrumented tab so each tab's overlay
// stays in sync regardless of which one is focused (worker is the source of
// truth). t0 lets each overlay run the same elapsed-time clock.
function broadcastOverlay() {
  const payload = { type: "overlay-state", state: overlayClock() };
  for (const tabId of state.tabIds) chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}

// The clock snapshot every overlay needs to render the same paused-aware elapsed
// time locally: t0 + banked pause time + (if paused) when this pause began. The
// overlay computes elapsed = now - t0 - pausedAccum - ongoingPause, matching now()
// here and the video's own timeline.
function overlayClock() {
  return {
    recording: state.recording,
    paused: state.paused,
    pauseReason: state.pauseReason,
    t0: state.t0,
    pausedAccum: state.pausedAccum,
    pauseStartedAt: state.pauseStartedAt,
    micActive: state.micActive, // overlay shows the level meter only when the mic is live
  };
}

// Follow the user across tabs: instrument any tab that starts loading a real URL
// while we're recording (covers brand-new tabs and navigations to eligible pages),
// re-arm the content script after each navigation, and drop tabs as they close.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // The active tab navigating to/from a blocklisted URL flips the auto-pause (the
  // user typed a sensitive URL into the tab they're already on, or navigated away).
  if (state.recording && changeInfo.url && tab?.active) updateAutoPause();
  // A tracked tab that navigates INTO a blocklisted host must be torn down — detach
  // the debugger and stop the content script so nothing more is captured there.
  if (state.recording && state.tabIds.has(tabId) && tab?.url && hostBlocked(tab.url)) {
    uninstrumentTab(tabId);
    return;
  }
  const actions = navActions(changeInfo, {
    recording: state.recording,
    eligible: isEligible(tab),
    tracked: state.tabIds.has(tabId),
    active: !!tab?.active,
  });
  // "reattach": a tracked tab finished (re)loading / changed URL — re-arm the
  // content-script capture a navigation tears down. The debugger is left
  // attached. Fix for capture dying after the first navigation on server-
  // rendered apps (see nav-policy.js / learnings.md).
  if (actions.includes("reattach")) reattachTab(tabId, tab);
  // "instrument": the active tab finished loading and isn't tracked yet (e.g. the
  // recording tab navigated off a chrome:// page). Tabs the user switches into
  // are instrumented in onActivated below.
  if (actions.includes("instrument")) instrumentTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.recording) uninstrumentTab(tabId);
});
// Lazily instrument the tab the user switches INTO — this is how capture follows
// them across tabs while leaving untouched tabs alone. Also grab a frame:
// captureVisibleTab shoots the active tab, so we get a shot of the tab they just
// moved to (the periodic timer would otherwise miss the switch instant).
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!state.recording) return;
  // Switching INTO a blocklisted tab auto-pauses everything (and out auto-resumes)
  // BEFORE we instrument or shoot a frame, so nothing from it is captured.
  updateAutoPause();
  instrumentTab(tabId); // idempotent — no-op if already tracked (and skips blocklisted)
  captureFrame("tab-activated");
});
// Switching browser windows (or to a window whose active tab is blocklisted) must
// re-evaluate the auto-pause too — the screen video follows the focused window.
chrome.windows.onFocusChanged.addListener(() => {
  if (state.recording) updateAutoPause();
});

// ---- frames --------------------------------------------------------------

// Grab a screenshot on a fixed cadence (not only on clicks/navs). Frame capture
// used to be triggered solely by content-script events, so when the content
// script died on a navigation the visual record died with it — leaving the
// "interesting" later states (error toasts, filtered views) with no frames even
// though the page was plainly visible. A timer makes visual coverage independent
// of the DOM event stream. The full-screen video is still the ground truth; this
// keeps the timeline navigable. 3s × ~6 min ≈ 120 frames ≈ ~16 MB (PNG).
const FRAME_INTERVAL_MS = 3000;
let frameTimer = null;

function startFrameTimer() {
  stopFrameTimer();
  frameTimer = setInterval(() => captureFrame("interval"), FRAME_INTERVAL_MS);
}
function stopFrameTimer() {
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
}

async function captureFrame(reason = "") {
  if (!state.recording || state.paused) return;
  try {
    // captureVisibleTab shoots whatever tab is active — if that's a blocklisted host
    // (the user switched into it), don't take the screenshot. Best-effort guard on top
    // of the no-instrument rule, since frames are of the active tab, not a tracked one.
    if (state.blocklist.length) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active && hostBlocked(active.url)) return;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const t = now();
    const file = `frames/${String(t).padStart(10, "0")}.png`;
    // Frames are written straight to IndexedDB (not held in worker memory): a
    // 30-min capture is hundreds of PNGs, and — more importantly — if the worker is
    // ever torn down, in-memory frames would vanish. IDB survives a worker restart.
    await db.append("frames", { t, file, dataUrl });
  } catch (e) {
    // captureVisibleTab can fail on chrome:// pages etc., or hit Chrome's
    // ~2/sec quota when an event frame lands next to a timer frame — non-fatal.
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
  // describe() copies a link's raw href into ctx — redact it too, else a secret in
  // an <a href="…?token=…"> (clicked/hovered/annotated) leaks into timeline.json.
  if (event.ctx?.href) event = { ...event, ctx: { ...event.ctx, href: redactUrl(event.ctx.href) } };
  await db.append("timeline", { t: now(), ...event });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "is-recording") {
    // A content script asking on load whether it should be capturing. Answer
    // PER TAB: only tabs we've instrumented (the recording tab + ones the user
    // has entered) record. A tab the user never switched into stays inert — so
    // we don't snapshot the DOM of a password-manager / chat tab just because
    // it was open. paused + t0 ride along for the overlay clock.
    const tabId = sender.tab?.id;
    const tracked = tabId != null && state.tabIds.has(tabId);
    sendResponse({ ...overlayClock(), recording: state.recording && tracked });
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
    // Grab a frame at the precise moment of a click, navigation, or annotation.
    // For annotations the frame is the point — it captures the screen with the
    // user's drawn highlight / selected-element box still painted on it, so the
    // analyst sees exactly what was marked. The periodic frame timer covers
    // everything in between (including idle dwell), so we no longer take a frame on
    // every hover — that just competed with the timer for Chrome's ~2/sec
    // captureVisibleTab quota.
    if (e.kind === "click" || e.kind === "nav" || e.kind === "annotation:select" || e.kind === "annotation:draw") {
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
  // Heartbeat from the offscreen document so the MV3 service worker isn't torn down
  // mid-recording (especially while paused, when nothing else wakes it). Receiving
  // the message is the point — it resets the worker's idle timer; no work needed.
  if (msg.type === "keepalive") {
    return; // handled — keeps the worker warm
  }
  // The captured screen/window share ended on its own (user closed the window or hit
  // Chrome's "Stop sharing"). Record it; the rest of the capture (events, mic) keeps
  // going, but the manifest should reflect that video stopped early.
  if (msg.type === "video-track-ended") {
    state.videoEndedEarly = true;
    logError("offscreen-video", { message: "screen share ended mid-recording" });
  }
  // The offscreen doc finished the screen picker (the user picked, or cancelled →
  // video:false). Run the countdown, then go live. Sent once per recording.
  if (msg.type === "offscreen-armed") {
    // Whether the mic track is actually live — set before goLive() sends the first
    // overlay clock, so each overlay knows to show (or hide) the level meter.
    state.micActive = !!msg.mic;
    runCountdownThenGo();
  }
  // Live microphone loudness from the offscreen recorder (~12/sec). Fan it out to
  // every instrumented overlay so the focused tab's meter moves as the user talks.
  // Tiny payload; only while recording. Dropped if the mic isn't live.
  if (msg.type === "mic-level") {
    if (state.recording && state.micActive) {
      const payload = { type: "mic-level", level: msg.level };
      for (const tabId of state.tabIds) chrome.tabs.sendMessage(tabId, payload).catch(() => {});
    }
  }
  // Both the popup and the injected on-screen overlay drive the same verbs.
  if (msg.type === "popup-command" || msg.type === "overlay-command") {
    const c = msg.command;
    if (c === "start") {
      start(msg.tabId, msg.task, msg.purposes).then(sendResponse);
      return true; // async response
    }
    // "finish" is the overlay's word for stop+save+export; same as the popup's stop.
    if (c === "stop" || c === "finish") {
      stop().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (c === "pause") pause();
    if (c === "resume") resume();
    if (c === "restart") restart();
    if (c === "cancel") cancel();
    if (c === "status") {
      sendResponse({ recording: state.recording, paused: state.paused, arming: state.arming });
      return true;
    }
  }
});

// ---- offscreen video -----------------------------------------------------

// Tear down the offscreen doc (and with it any live screen/mic stream). Used at the
// start of a recording to clear an orphan left by a worker that was killed mid-arming
// — MV3 workers are ephemeral, and a stuck getDisplayMedia keeps the "sharing your
// screen" indicator lit with no way to stop it.
async function closeOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument();
  } catch {}
}

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
  // Frames live in IndexedDB (autoincrement seq = capture order). Read them back
  // here for the manifest list, the counts, and the file bytes.
  const frames = (await db.readAll("frames")).map(({ seq, ...f }) => f);
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
    // True if the screen share stopped on its own before the user finished (closed
    // the shared window / hit "Stop sharing") — video.webm ends early but the rest
    // of the capture (events, network, mic) ran to the end. See errors.json.
    video_ended_early: !!state.videoEndedEarly,
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
      // Redaction covers the STRUCTURED streams (timeline, network.har, DOM, URLs),
      // not the pixels: a secret visible on screen is visible in video.webm/frames.
      visual_streams_redacted: false,
    },
    frames: frames.map((f) => ({ t: f.t, file: f.file })),
    counts: {
      events: timeline.length,
      network: [...state.har.values()].length,
      frames: frames.length,
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
  for (const f of frames) files.push({ name: f.file, data: dataUrlToBytes(f.dataUrl) });
  if (videoDataUrl) files.push({ name: "video.webm", data: dataUrlToBytes(videoDataUrl) });

  await db.clearAll();
  return makeZip(files);
}

// The extension captures narration timing as `speech` timeline events if a
// transcriber feeds them in; absent that, emit a stub the user replaces with a
// real transcript (Whisper, etc.). See README.
function buildTranscript(timeline) {
  const cues = timeline.filter((e) => e.kind === "speech");
  if (!cues.length)
    return (
      "WEBVTT\n\nNOTE No narration captured in this stream. The spoken audio is in " +
      "video.webm — to fill this transcript, run `python analyze/pack.py <bundle>` " +
      "(or analyze/transcribe.py <bundle>) in the repo .venv. One-time setup: " +
      "analyze/setup.sh (Mac/Linux) or setup.ps1 (Windows); after that it's automatic.\n"
    );
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
