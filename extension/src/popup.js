// Popup: start/pause/stop, settings, and live status. All real work happens in
// the worker; the popup just sends commands and persists settings. The screen
// picker is Chrome's own getDisplayMedia dialog, shown from the offscreen
// document after Start — so it's fine if this popup closes when the dialog appears.

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

// A download subfolder must be a relative path UNDER Downloads (chrome.downloads
// rejects absolute paths and `..`). Strip slashes and any parent-dir hops so the
// setting can't escape Downloads.
function cleanFolder(v) {
  return (v || "")
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .split(/[/\\]+/)
    .filter((seg) => seg && seg !== "..")
    .join("/");
}

function readSettings() {
  return {
    blocklist: $("blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean),
    micEnabled: $("mic").checked,
    downloadSubfolder: cleanFolder($("folder").value),
    askWhereToSave: $("askSave").checked,
  };
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
    chrome.tabs.create({ url: chrome.runtime.getURL("src/mic-permission.html") });
    $("status").textContent = "Allow the mic in the tab that opened, then press Start again.";
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

$("enableMic").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/mic-permission.html") });
});
$("mic").addEventListener("change", refreshMicState);

chrome.storage.local
  .get(["blocklist", "micEnabled", "purposes", "downloadSubfolder", "askWhereToSave"])
  .then(({ blocklist = [], micEnabled = true, purposes = [], downloadSubfolder = "", askWhereToSave = false }) => {
    $("blocklist").value = blocklist.join("\n");
    $("mic").checked = micEnabled;
    $("folder").value = downloadSubfolder;
    $("askSave").checked = askWhereToSave;
    for (const el of document.querySelectorAll('input[name="purpose"]')) {
      el.checked = purposes.includes(el.value);
    }
    refreshMicState();
  });

refresh();
