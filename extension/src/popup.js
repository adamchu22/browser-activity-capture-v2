// Popup: start/pause/stop, settings, and live status. All real work happens in
// the worker; the popup just sends commands and persists settings. The screen
// picker is Chrome's own getDisplayMedia dialog, shown from the offscreen
// document after Start — so it's fine if this popup closes when the dialog appears.

import { saveExportDir } from "./fsdir.js";

const $ = (id) => document.getElementById(id);
let paused = false;

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
  $("pause").textContent = paused ? "Resume" : "Pause";
  $("status").textContent = arming ? "Starting…" : live ? (paused ? "Paused" : "Recording…") : "";
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
      s.textContent = "Saved ✓";
      clearTimeout(saveSettings._clear);
      saveSettings._clear = setTimeout(() => (s.textContent = ""), 1500);
    }
  }, 250);
}

// Show the chosen auto-save folder (or that none is set → Downloads fallback), and
// flag if folder access lapsed (e.g. after a browser restart) so the user re-picks.
function renderFolder(name, needsRegrant) {
  const el = $("folderName");
  if (!el) return;
  if (needsRegrant && name) {
    el.textContent = `⚠ Lost access to “${name}” — click Choose folder to restore it.`;
    el.style.color = "#b35900";
  } else if (name) {
    el.textContent = `Saving to: ${name}`;
    el.style.color = "#2e7d32";
  } else {
    el.textContent = "No folder chosen — saves to Downloads.";
    el.style.color = "#999";
  }
}

// File System Access folder picker, scoped to this extension. The handle is kept
// in IndexedDB (fsdir.js) so the offscreen doc can write exports straight into it.
async function chooseFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      $("status").textContent = "Folder access wasn’t granted.";
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
    if (e?.name !== "AbortError") $("status").textContent = "Couldn’t open the folder picker.";
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
    $("status").textContent = "Allow the mic in the window that popped up, then press Start again.";
    return;
  }
  // The worker spins up the offscreen doc, which calls getDisplayMedia — Chrome's
  // "Choose what to share" dialog appears, then a short countdown, then capture.
  $("status").textContent = "Choose a screen/window to share in the dialog…";
  const task = $("task").value.trim();
  const res = await send("start", { tabId: await activeTabId(), task, purposes });
  if (res && !res.ok) {
    $("status").textContent = res.error || "Couldn't start.";
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
  $("status").textContent = "Exporting bundle…";
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
  $("micState").textContent = !micWanted
    ? ""
    : granted
      ? "Microphone enabled ✓"
      : "Microphone not enabled — narration won't record.";
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

chrome.storage.local
  .get(["blocklist", "micEnabled", "purposes", "saveMode", "exportDirName", "exportDirNeedsRegrant"])
  .then(({ blocklist = [], micEnabled = true, purposes = [], saveMode = "folder",
           exportDirName = "", exportDirNeedsRegrant = false }) => {
    $("blocklist").value = blocklist.join("\n");
    $("mic").checked = micEnabled;
    const modeEl = document.querySelector(`input[name="savemode"][value="${saveMode}"]`);
    if (modeEl) modeEl.checked = true;
    renderFolder(exportDirName, exportDirNeedsRegrant);
    for (const el of document.querySelectorAll('input[name="purpose"]')) {
      el.checked = purposes.includes(el.value);
    }
    refreshMicState();
  });

refresh();
