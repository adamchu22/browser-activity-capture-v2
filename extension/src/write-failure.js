// Classify an IndexedDB write failure: is this a real STORAGE quota error (the disk
// is full, so EVERY subsequent write — frames, timeline, rrweb, HAR — will fail and
// the capture is now silently truncating) or something else that self-heals?
//
// The trap this guards against: chrome.tabs.captureVisibleTab's ~2/sec rate limit
// throws "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."
// — which contains the word "quota" but is a harmless, self-healing SCREENSHOT
// throttle, not a full disk. The old classifier used /quota|storage/i, so that
// rate-limit message matched and a good recording tripped the fatal truncation alarm
// (red `!` badge, false errors.json truncation note, manifest.storage_full = true)
// even though nothing was lost. So: match the canonical DOM storage error
// (QuotaExceededError by name), explicitly EXCLUDE the capture-rate message, and only
// fall back to message text that actually names persistent storage — never bare
// "quota", which the rate limit also uses.
export function isStorageQuotaError(e) {
  if (!e) return false;
  const message = String(e.message || "");
  // Chrome's screenshot rate limit is never a storage problem — exclude it outright.
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message)) return false;
  // The canonical DOM signal for a full IndexedDB / storage area.
  if (e.name === "QuotaExceededError") return true;
  // Fallback for environments that drop the error name: require words that actually
  // mean persistent storage. Deliberately NOT bare "quota" (the rate limit uses it).
  return /storage|indexeddb|disk space/i.test(message);
}
