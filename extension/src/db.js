// Tiny IndexedDB store. MV3 service workers are ephemeral — they get torn down
// between events — so we cannot hold the recording in worker memory. Every event,
// rrweb node, frame, and network entry is written here as it arrives and read back
// at export (or on a worker restart, to rehydrate the live recording).

const DB_NAME = "bac-capture";
const DB_VERSION = 2;
// Append-only logs: autoincrement `seq` keys, written with append() (add).
const LOG_STORES = ["timeline", "rrweb", "frames"];
// Keyed stores: upserted by their own key with put() (e.g. a HAR entry is built
// across two CDP events, so it's written twice under the same requestId).
const KEYED_STORES = { har: "requestId" };
const ALL_STORES = [...LOG_STORES, ...Object.keys(KEYED_STORES)];

let connection = null;
let epoch = 0;

function open() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of LOG_STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "seq", autoIncrement: true });
        }
      }
      for (const [s, keyPath] of Object.entries(KEYED_STORES)) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); connection = null; };
      db.onclose = () => { connection = null; };
      resolve(db);
    };
    req.onerror = () => { connection = null; reject(req.error); };
  });
  return connection;
}

// Append to a log store (autoincrement key).
export async function append(store, record) {
  const started = epoch;
  const db = await open();
  if (started !== epoch) throw new Error("Stale capture write");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Upsert into a keyed store (the record must carry that store's keyPath).
export async function put(store, record) {
  const started = epoch;
  const db = await open();
  if (started !== epoch) throw new Error("Stale capture write");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(record);
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

// Count records in a store without loading them — used to build manifest counts
// (e.g. frames) cheaply, so the worker never pulls hundreds of frame PNGs into
// memory just to total them.
export async function count(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  ++epoch;
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALL_STORES, "readwrite");
    for (const s of ALL_STORES) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
