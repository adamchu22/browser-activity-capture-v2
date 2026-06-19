// Turn the bulk IndexedDB capture streams into Capture-Bundle file entries.
//
// These streams (the rrweb DOM log, the merged timeline, and the frame PNGs) are
// the BIG part of a bundle — a long recording's events.jsonl + frames can be tens
// of MB. They must never be shipped through chrome.runtime.sendMessage (hard-capped
// at 64MiB) or base64-inflated into a data: URL. So the assembly that touches them
// reads straight from IndexedDB in whichever context owns the destination:
//   - normal export: the OFFSCREEN document (it already holds the video Blob and can
//     createWritable()/createObjectURL at any size);
//   - crash salvage: the SERVICE WORKER (no offscreen doc to lean on).
// Both call these pure helpers, so the two sites can't drift. No chrome.* here —
// unit-tested in tests/test_bundle_streams.mjs.

// data: URL ("data:image/png;base64,AAAA…") -> the raw bytes. Used for the frame
// PNGs, which are stored in IndexedDB as data URLs from captureVisibleTab.
export function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl || "").split(",")[1] || "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Project a frame's IndexedDB record down to the manifest's {t, file} shape without
// carrying the (large) dataUrl — so the worker can build manifest.frames from the
// frame metadata alone, never loading the image bytes into the service worker.
export function frameMeta(frames) {
  return (frames || []).map((f) => ({ t: f.t, file: f.file }));
}

// The three bulk streams as bundle files. `timeline`/`rrweb`/`frames` are the raw
// IndexedDB records (each may carry an autoincrement `seq` key, stripped here).
// Frames become real PNG bytes under their stored `file` name (e.g. frames/…png).
export function streamFiles(timeline, rrweb, frames) {
  const tl = (timeline || []).map(({ seq, ...e }) => e);
  const rr = (rrweb || []).map(({ seq, ...e }) => e);
  const files = [
    { name: "timeline.json", data: JSON.stringify(tl, null, 2) },
    { name: "events.jsonl", data: rr.map((e) => JSON.stringify(e)).join("\n") },
  ];
  for (const f of frames || []) {
    files.push({ name: f.file, data: dataUrlToBytes(f.dataUrl) });
  }
  return files;
}
