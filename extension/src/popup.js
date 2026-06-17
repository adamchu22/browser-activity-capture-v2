// Popup: start/pause/stop, blocklist, and live status. All real work happens in
// the worker; the popup just sends commands.

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
  paused = res?.paused;
  $("rec").hidden = live;
  $("live").hidden = !live;
  $("pause").textContent = paused ? "Resume" : "Pause";
  $("status").textContent = live ? (paused ? "Paused" : "Recording…") : "";
}

async function micGranted() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state === "granted";
  } catch {
    return false;
  }
}

$("rec").addEventListener("click", async () => {
  const blocklist = $("blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const micEnabled = $("mic").checked;
  await chrome.storage.local.set({ blocklist, micEnabled });
  // Don't silently record without narration — if the mic is wanted but the
  // extension origin isn't granted yet, route through the grant page first. The
  // offscreen doc can't prompt, so starting now would just yield a silent video.
  if (micEnabled && !(await micGranted())) {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/mic-permission.html") });
    $("status").textContent = "Allow the mic in the tab that opened, then press Start again.";
    return;
  }
  // Starting opens Chrome's screen picker, which may steal focus and close this
  // popup — that's fine, the worker runs start() independently. `res` is only seen
  // if the popup survives. Pick a screen/window in the picker to record video.
  $("status").textContent = "Pick a screen/window in the picker to record…";
  const task = $("task").value.trim();
  const res = await send("start", { tabId: await activeTabId(), task });
  if (res && !res.ok) {
    $("status").textContent = res.error || "Couldn't start.";
    return;
  }
  if (res && res.video === false) {
    $("status").textContent = `Recording ${res.tabs} tab(s) without video (picker cancelled).`;
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

chrome.storage.local.get(["blocklist", "micEnabled"]).then(({ blocklist = [], micEnabled = true }) => {
  $("blocklist").value = blocklist.join("\n");
  $("mic").checked = micEnabled;
  refreshMicState();
});

refresh();
