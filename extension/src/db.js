// Tiny IndexedDB append-log. MV3 service workers are ephemeral — they get torn
// down between events — so we cannot hold the recording in memory. Every event,
// rrweb node, and frame is appended here as it arrives and read back at export.

const DB_NAME = "bac-capture";
const STORES = ["timeline", "rrweb", "frames"]; // append-only, autoincrement keys

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "seq", autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function append(store, record) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function readAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    for (const s of STORES) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
