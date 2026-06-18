// Persisted "auto-save here" folder, chosen via the File System Access API.
//
// The user picks a folder in the popup (showDirectoryPicker); we keep the returned
// FileSystemDirectoryHandle so every export writes straight into it — no per-file
// dialog, no being limited to the browser's Downloads tree. A handle can't live in
// chrome.storage (it isn't JSON), so it goes in its own tiny IndexedDB, separate
// from db.js's capture store (which clearAll() wipes each recording).
//
// The popup stores the handle; the OFFSCREEN document reads it back and does the
// write (a Window context — service workers can't reliably createWritable()). If
// folder permission has lapsed (e.g. after a browser restart) the caller falls
// back to a normal Downloads download, so a recording is never lost.
const DB = "bac-fs";
const STORE = "handles";
const KEY = "exportDir";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveExportDir(handle) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadExportDir() {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function clearExportDir() {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
