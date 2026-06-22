// Popup: start/pause/stop, settings, and live status. All real work happens in
// the worker; the popup just sends commands and persists settings. The screen
// picker is Chrome's own getDisplayMedia dialog, shown from the offscreen
// document after Start — so it's fine if this popup closes when the dialog appears.

const $ = (id) => document.getElementById(id);
let paused = false;

// ── i18n ────────────────────────────────────────────────────────────────────
// Strings + table live in i18n.js (loaded as a classic script before this module,
// so it's on window). `lang` is the active UI language, persisted in storage.
const I18N = window.BAC_I18N;
let lang = "en";
const T = (key, vars) => (I18N ? I18N.t(lang, key, vars) : key);

// Swap every visible string to the chosen language and light the active segment.
// Static strings carry data-i18n / -ph / -html; JS-driven ones (status, mic state,
// pause label) are re-rendered by the helpers called at the end.
function applyLang(next) {
  lang = (I18N && I18N.normalize(next)) || "en";
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = T(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = T(el.dataset.i18nPh);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = T(el.dataset.i18nHtml);
  for (const b of document.querySelectorAll(".lang-opt")) b.classList.toggle("active", b.dataset.lang === lang);
  refreshMicState();
  refresh();
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function send(command, extra = {}) {
  return chrome.runtime.sendMessage({ type: "popup-command", command, ...extra });
}

async function refresh() {
  const res = await send("status");
  const live = res?.recording;
  const arming = res?.arming; // picker open / countdown running, before capture goes live
  paused = res?.paused;
  $("rec").hidden = live || arming;
  $("live").hidden = !live;
  $("pause").textContent = paused ? T("resume") : T("pause");
  $("status").textContent = arming ? T("stStarting") : live ? (paused ? T("stPaused") : T("stRecording")) : "";
  await refreshRecoverBanner();
}

// Loss guard surface: when a prior export failed, the take is kept in IndexedDB and
// `unsavedTake` is set. Show the banner (Retry / Discard) and hide the normal Start
// affordance — the worker blocks Start anyway, this just makes the reason visible.
async function refreshRecoverBanner() {
  const banner = $("exportFail");
  if (!banner) return;
  let unsaved = false;
  try {
    ({ unsavedTake: unsaved } = await chrome.storage.local.get("unsavedTake"));
  } catch {}
  banner.hidden = !unsaved;
  if (unsaved) $("rec").hidden = true; // can't start over an unsaved take
}

// Is the mic ready to record? A persisted `micGrantedOnce` flag is the fast path: once
// set (the first time a grant succeeds), it means the extension origin holds the
// permission, so Start proceeds with NO prompt and the offscreen recorder's getUserMedia
// succeeds silently — no nagging on every Start (the old `permissions.query` gate was
// unreliable in a popup and re-opened the grant window every time). The worker clears
// the flag if a recording's mic actually fails (revoked), so it self-heals.
async function micReady() {
  const { micGrantedOnce } = await chrome.storage.local.get("micGrantedOnce");
  return !!micGrantedOnce;
}

// Prompt for the mic IN THE CURRENT TAB. We inject an invisible extension-origin iframe
// (allow="microphone") into the active tab; requesting getUserMedia inside it makes
// Chrome's prompt appear anchored to that tab (not a separate window), and the grant is
// recorded for the extension origin. The iframe also doubles as a silent check — if the
// grant already exists it resolves with no prompt — and removes itself once the user
// chooses, so nothing lingers. Returns false if we can't inject (a restricted page like
// chrome://), so the caller can fall back to the dedicated grant window.
async function requestMicInTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return false;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectMicFrame,
      args: [chrome.runtime.getURL("src/request-mic.html")],
    });
    return true;
  } catch {
    return false; // restricted page / no host access → use the window fallback
  }
}

// Injected into the ACTIVE TAB (serialized by executeScript — must be self-contained).
// Adds the invisible mic-request iframe and removes it once the request reports back.
function injectMicFrame(url) {
  if (document.getElementById("__bac_mic_frame")) return; // already asking
  const f = document.createElement("iframe");
  f.id = "__bac_mic_frame";
  f.setAttribute("allow", "microphone");
  f.src = url;
  f.style.cssText = "position:fixed;width:1px;height:1px;border:0;opacity:0;left:-9999px;top:-9999px;z-index:2147483647";
  const onMsg = (e) => {
    if (e.data && e.data.__bacMicDone) {
      window.removeEventListener("message", onMsg);
      f.remove();
    }
  };
  window.addEventListener("message", onMsg);
  (document.body || document.documentElement).appendChild(f);
}

// Last-resort fallback when the active tab can't host the prompt (e.g. a chrome:// page):
// a dedicated extension page in a small window. Only reached when requestMicInTab fails.
function openMicGrant() {
  chrome.windows.create({
    url: chrome.runtime.getURL("src/mic-permission.html"),
    type: "popup",
    width: 440,
    height: 320,
  });
}

// Trigger a mic grant: in-tab prompt first, window only if the tab can't host it.
async function promptForMic() {
  if (!(await requestMicInTab())) openMicGrant();
}

function selectedPurposes() {
  return [...document.querySelectorAll('input[name="purpose"]:checked')].map((el) => el.value);
}

function readSettings() {
  return {
    blocklist: $("blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean),
    micEnabled: $("mic").checked,
  };
}

// Settings persist the moment they change — the old popup only wrote them on
// Start, so a blocklist typed and left unsubmitted was silently lost (which let a
// sensitive tab get captured). Debounced so typing in the blocklist doesn't thrash
// storage, with a brief "Saved ✓" confirmation.
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ ...readSettings(), purposes: selectedPurposes() });
    const s = $("saved");
    if (s) {
      s.textContent = T("saved");
      s.style.color = "#4ade80";
      clearTimeout(saveSettings._clear);
      saveSettings._clear = setTimeout(() => (s.textContent = ""), 1500);
    }
  }, 250);
}

$("rec").addEventListener("click", async () => {
  const settings = readSettings();
  // Purpose tells the analysis whether to make a skill, a doc, UX feedback, or an
  // efficiency teardown. If none is picked, default to "general" so Start is never
  // blocked — a recording shouldn't be lost over an unticked box.
  const purposes = selectedPurposes();
  if (!purposes.length) purposes.push("general");
  await chrome.storage.local.set({ ...settings, purposes });
  // Don't silently record without narration — if the mic is wanted, make sure the grant
  // is in place first (the offscreen doc can't prompt, so starting ungranted yields a
  // silent video). micReady() is the persisted-flag fast path; if it's not yet granted,
  // prompt in the current tab and have the user press Start again once allowed.
  if (settings.micEnabled && !(await micReady())) {
    await promptForMic(); // prompt appears in the current tab; window only on restricted pages
    $("status").textContent = T("stMicPrompt");
    refreshMicState();
    return;
  }
  // The worker spins up the offscreen doc, which calls getDisplayMedia — Chrome's
  // "Choose what to share" dialog appears, then a short countdown, then capture.
  $("status").textContent = T("stPickShare");
  const task = $("task").value.trim();
  const res = await send("start", { tabId: await activeTabId(), task, purposes });
  if (res && !res.ok) {
    $("status").textContent = res.error || T("stStartFail");
    return;
  }
  setTimeout(refresh, 200);
});

$("pause").addEventListener("click", async () => {
  await send(paused ? "resume" : "pause");
  setTimeout(refresh, 100);
});

// Loss guard: retry a failed export (re-saves the kept take), or discard it.
$("retryExport").addEventListener("click", async () => {
  $("status").textContent = "Retrying save…";
  const res = await send("retry-export");
  $("status").textContent = res?.ok ? "Saved." : res?.error || "Retry failed — the recording is still kept.";
  await refresh();
});
$("discardTake").addEventListener("click", async () => {
  if (!confirm("Discard the unsaved recording? This permanently deletes it.")) return;
  await send("discard-take");
  $("status").textContent = "Discarded.";
  await refresh();
});

$("stop").addEventListener("click", async () => {
  await send("stop");
  $("status").textContent = T("stExporting");
  setTimeout(refresh, 500);
});

// Mic narration needs the extension origin to hold microphone permission. An
// offscreen doc can't prompt for it, so we surface the state here; the grant is
// requested in the current tab via promptForMic() (on Start or the Enable button).
//
// We drive this off `micReady()` (the persisted micGrantedOnce flag — the SAME signal
// Start gates on), NOT navigator.permissions.query. In some Chromium forks (Comet)
// permissions.query reports "granted" while getUserMedia still can't capture, which
// used to HIDE the Enable button and leave the user with no recourse. Keying off the
// real grant flag keeps a clickable Enable affordance until the mic actually works.
async function refreshMicState() {
  const micWanted = $("mic").checked;
  const ready = await micReady();
  $("enableMic").hidden = ready || !micWanted;
  $("micState").textContent = !micWanted ? "" : ready ? T("micOn") : T("micOff");
}

// Enable mic: prompt in the current tab (silent if already granted). The outcome comes
// back asynchronously via the "mic-grant-result" message below (success → flag set →
// micState flips; failure → window fallback + guidance), so the click gives immediate
// feedback rather than appearing to do nothing.
$("enableMic").addEventListener("click", async () => {
  if (await micReady()) {
    refreshMicState();
    return;
  }
  $("status").textContent = T("stMicPrompt");
  await promptForMic();
});

// The injected mic iframe (request-mic.js) reports whether the grant actually took.
// On success the flag is set (storage.onChanged refreshes the UI). On failure — denied,
// or the browser never surfaced a prompt (the Comet case) — open the dedicated grant
// window and show the manual "set Microphone to Allow" guidance, so a failed in-tab
// prompt is never a silent dead end.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "mic-grant-result") return;
  if (msg.ok) {
    $("status").textContent = T("micGranted");
  } else {
    openMicGrant();
    $("status").textContent = T("micNoPrompt");
  }
  refreshMicState();
});

// Keep the mic UI in sync the instant a grant is recorded (or cleared by the worker
// when a recording's mic fails) — from this popup, the grant window, or anywhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "micGrantedOnce" in changes) refreshMicState();
});
$("mic").addEventListener("change", () => {
  refreshMicState();
  saveSettings();
});

// Persist settings as they change (blocklist, purposes).
$("blocklist").addEventListener("input", saveSettings);
for (const el of document.querySelectorAll('input[name="purpose"]')) el.addEventListener("change", saveSettings);

// Language toggle — re-render in the picked language and remember it.
for (const b of document.querySelectorAll(".lang-opt")) {
  b.addEventListener("click", () => {
    applyLang(b.dataset.lang);
    chrome.storage.local.set({ lang });
  });
}

chrome.storage.local
  .get(["blocklist", "micEnabled", "purposes", "lang"])
  .then(({ blocklist = [], micEnabled = true, purposes = [], lang: savedLang }) => {
    $("blocklist").value = blocklist.join("\n");
    $("mic").checked = micEnabled;
    for (const el of document.querySelectorAll('input[name="purpose"]')) {
      el.checked = purposes.includes(el.value);
    }
    // Default to the browser's language (among en/es/pt) until the user picks one.
    // applyLang re-renders mic state + live status in the chosen language.
    applyLang(savedLang || (I18N ? I18N.detect() : "en"));
  });

refresh();
