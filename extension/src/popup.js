// Popup: start/pause/stop, settings, and live status. All real work happens in
// the worker; the popup just sends commands and persists settings. The screen
// picker is Chrome's own getDisplayMedia dialog, shown from the offscreen
// document after Start — so it's fine if this popup closes when the dialog appears.

import { saveExportDir } from "./fsdir.js";

const $ = (id) => document.getElementById(id);
let paused = false;

// ── i18n ────────────────────────────────────────────────────────────────────
// Strings + table live in i18n.js (loaded as a classic script before this module,
// so it's on window). `lang` is the active UI language, persisted in storage.
const I18N = window.BAC_I18N;
let lang = "en";
const T = (key, vars) => (I18N ? I18N.t(lang, key, vars) : key);

// Last-known auto-save folder state, kept so applyLang() can re-render its
// message in the new language without re-reading storage.
let folderState = { name: "", needsRegrant: false };

// Swap every visible string to the chosen language and light the active segment.
// Static strings carry data-i18n / -ph / -html; JS-driven ones (status, mic state,
// folder, pause label) are re-rendered by the helpers called at the end.
function applyLang(next) {
  lang = (I18N && I18N.normalize(next)) || "en";
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = T(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = T(el.dataset.i18nPh);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = T(el.dataset.i18nHtml);
  for (const b of document.querySelectorAll(".lang-opt")) b.classList.toggle("active", b.dataset.lang === lang);
  renderFolder();
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
}

async function micGranted() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state === "granted";
  } catch {
    return false;
  }
}

function selectedPurposes() {
  return [...document.querySelectorAll('input[name="purpose"]:checked')].map((el) => el.value);
}

function saveMode() {
  const el = document.querySelector('input[name="savemode"]:checked');
  return el ? el.value : "folder"; // "folder" → chosen dir (fallback Downloads); "ask" → dialog
}

function readSettings() {
  return {
    blocklist: $("blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean),
    micEnabled: $("mic").checked,
    saveMode: saveMode(),
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

// Show the chosen auto-save folder (or that none is set → Downloads fallback), and
// flag if folder access lapsed (e.g. after a browser restart) so the user re-picks.
function renderFolder(name, needsRegrant) {
  // Called with args from storage/picker (updates state); called bare from
  // applyLang to re-render the stored state in the new language.
  if (name !== undefined) folderState = { name, needsRegrant: !!needsRegrant };
  const el = $("folderName");
  if (!el) return;
  const { name: n, needsRegrant: r } = folderState;
  if (r && n) {
    el.textContent = T("folderLost", { name: n });
    el.style.color = "#fbbf24";
  } else if (n) {
    el.textContent = T("folderSaving", { name: n });
    el.style.color = "#4ade80";
  } else {
    el.textContent = T("folderNone");
    el.style.color = "rgba(255,255,255,0.36)";
  }
}

// File System Access folder picker, scoped to this extension. The handle is kept
// in IndexedDB (fsdir.js) so the offscreen doc can write exports straight into it.
async function chooseFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      $("status").textContent = T("stFolderDenied");
      return;
    }
    await saveExportDir(handle);
    await chrome.storage.local.set({ exportDirName: handle.name, exportDirNeedsRegrant: false });
    // Picking a folder implies auto-save mode.
    const folderRadio = document.querySelector('input[name="savemode"][value="folder"]');
    if (folderRadio) folderRadio.checked = true;
    renderFolder(handle.name, false);
    saveSettings();
  } catch (e) {
    if (e?.name !== "AbortError") $("status").textContent = T("stPickerFail");
  }
}

$("rec").addEventListener("click", async () => {
  const settings = readSettings();
  // Purpose tells the analysis whether to make a skill, a doc, UX feedback, or an
  // efficiency teardown. If none is picked, default to "general" so Start is never
  // blocked — a recording shouldn't be lost over an unticked box.
  const purposes = selectedPurposes();
  if (!purposes.length) purposes.push("general");
  await chrome.storage.local.set({ ...settings, purposes });
  // Don't silently record without narration — if the mic is wanted but the
  // extension origin isn't granted yet, route through the grant page first. The
  // offscreen doc can't prompt, so starting now would just yield a silent video.
  if (settings.micEnabled && !(await micGranted())) {
    openMicGrant();
    $("status").textContent = T("stMicPrompt");
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

$("stop").addEventListener("click", async () => {
  await send("stop");
  $("status").textContent = T("stExporting");
  setTimeout(refresh, 500);
});

// Mic narration needs the extension origin to hold microphone permission. An
// offscreen doc can't prompt for it, so we surface the state here and route the
// grant through a dedicated page (mic-permission.html) that can.
async function refreshMicState() {
  const micWanted = $("mic").checked;
  let granted = false;
  try {
    const p = await navigator.permissions.query({ name: "microphone" });
    granted = p.state === "granted";
    p.onchange = refreshMicState;
  } catch {
    granted = false; // can't tell → assume not granted, let the user enable it
  }
  $("enableMic").hidden = granted || !micWanted;
  $("micState").textContent = !micWanted ? "" : granted ? T("micOn") : T("micOff");
}

// Open the one-time mic-grant page as a small floating popup window on the
// current screen instead of a full background tab — it pops up where the user is,
// grants, and closes, rather than burying itself behind everything.
function openMicGrant() {
  chrome.windows.create({
    url: chrome.runtime.getURL("src/mic-permission.html"),
    type: "popup",
    width: 440,
    height: 320,
  });
}

$("chooseFolder").addEventListener("click", chooseFolder);
$("enableMic").addEventListener("click", openMicGrant);
$("mic").addEventListener("change", () => {
  refreshMicState();
  saveSettings();
});

// Persist settings as they change (blocklist, save mode, purposes).
$("blocklist").addEventListener("input", saveSettings);
for (const el of document.querySelectorAll('input[name="savemode"]')) el.addEventListener("change", saveSettings);
for (const el of document.querySelectorAll('input[name="purpose"]')) el.addEventListener("change", saveSettings);

// Language toggle — re-render in the picked language and remember it.
for (const b of document.querySelectorAll(".lang-opt")) {
  b.addEventListener("click", () => {
    applyLang(b.dataset.lang);
    chrome.storage.local.set({ lang });
  });
}

chrome.storage.local
  .get(["blocklist", "micEnabled", "purposes", "saveMode", "exportDirName", "exportDirNeedsRegrant", "lang"])
  .then(({ blocklist = [], micEnabled = true, purposes = [], saveMode = "folder",
           exportDirName = "", exportDirNeedsRegrant = false, lang: savedLang }) => {
    $("blocklist").value = blocklist.join("\n");
    $("mic").checked = micEnabled;
    const modeEl = document.querySelector(`input[name="savemode"][value="${saveMode}"]`);
    if (modeEl) modeEl.checked = true;
    renderFolder(exportDirName, exportDirNeedsRegrant); // records folder state
    for (const el of document.querySelectorAll('input[name="purpose"]')) {
      el.checked = purposes.includes(el.value);
    }
    // Default to the browser's language (among en/es/pt) until the user picks one.
    // applyLang re-renders folder + mic state + live status in the chosen language.
    applyLang(savedLang || (I18N ? I18N.detect() : "en"));
  });

refresh();
