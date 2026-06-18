// Runs inside an invisible extension-origin iframe that a content script injects into
// the ACTIVE TAB (with allow="microphone"). Requesting getUserMedia here makes Chrome's
// microphone prompt appear IN the current tab — not a separate window — and the grant is
// recorded for the EXTENSION origin, so the offscreen recorder can use the mic on every
// future recording. This is the portable way to prompt for the mic from an MV3 extension
// (the action popup can't be relied on — it closes when the bubble appears, and in some
// Chromium forks like Comet a popup getUserMedia does nothing).
//
// On a result we persist the grant (so the popup never re-prompts) and tell the parent
// page to remove the iframe, so nothing lingers on screen after the user chooses.
(async () => {
  let ok = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // we only needed the grant
    await chrome.storage.local.set({ micGrantedOnce: true });
    ok = true;
  } catch {
    // Denied, or the page blocks the mic via Permissions-Policy — leave the flag unset.
  }
  // Ask the injector (content script in the page) to remove this iframe now we're done.
  try {
    window.parent.postMessage({ __bacMicDone: true, ok }, "*");
  } catch {}
})();
