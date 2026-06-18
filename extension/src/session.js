// Durable snapshot of a live recording's worker state.
//
// The MV3 service worker holds the recording in a single in-memory `state` object
// (t0, pause accounting, the tab legend, the blocklist, …). If Chrome tears the
// worker down mid-recording — most likely during a pause, when nothing keeps it
// warm — that state is gone: the overlay goes dead and the capture is lost. These
// two pure functions convert the durable slice of `state` to/from a JSON-safe
// record that the worker persists to chrome.storage.local and rehydrates from on a
// cold restart. Bulk data (timeline, rrweb, frames, network) lives in IndexedDB and
// is NOT duplicated here — only the small scalars + collections the worker needs to
// keep controlling and finalising the recording.
//
// Pure + dependency-free so it can be unit-tested without chrome.* — see
// tests/test_session.mjs. Sets/Maps become arrays on the way out and back.

// Serialize the durable slice of `state`, or null when there's nothing to persist
// (no live recording — arming/idle states are intentionally not recoverable).
export function serializeSession(state) {
  if (!state || !state.recording) return null;
  return {
    v: 1,
    recording: true,
    t0: state.t0 || 0,
    paused: !!state.paused,
    manualPaused: !!state.manualPaused,
    autoPaused: !!state.autoPaused,
    pauseReason: state.pauseReason ?? null,
    pausedAccum: state.pausedAccum || 0,
    pauseStartedAt: state.pauseStartedAt || 0,
    task: state.task ?? null,
    purposes: Array.isArray(state.purposes) ? state.purposes : [],
    blocklist: Array.isArray(state.blocklist) ? state.blocklist : [],
    saveMode: state.saveMode ?? "folder",
    micActive: !!state.micActive,
    videoEndedEarly: !!state.videoEndedEarly,
    activeTabId: state.activeTabId ?? null,
    tabIds: [...(state.tabIds || [])],
    tabs: state.tabs ? [...state.tabs.values()] : [],
    urls: [...(state.urls || [])],
    errors: Array.isArray(state.errors) ? state.errors : [],
  };
}

// Apply a persisted record back onto the live `state` object (mutates it in place
// and returns it). Arrays become Sets/Maps again. Tolerant of a partial record.
export function applySession(state, record) {
  if (!state || !record) return state;
  state.recording = true;
  state.arming = false;
  state.t0 = record.t0 || 0;
  state.paused = !!record.paused;
  state.manualPaused = !!record.manualPaused;
  state.autoPaused = !!record.autoPaused;
  state.pauseReason = record.pauseReason ?? null;
  state.pausedAccum = record.pausedAccum || 0;
  state.pauseStartedAt = record.pauseStartedAt || 0;
  state.task = record.task ?? null;
  state.purposes = Array.isArray(record.purposes) ? record.purposes : [];
  state.blocklist = Array.isArray(record.blocklist) ? record.blocklist : [];
  state.saveMode = record.saveMode ?? "folder";
  state.micActive = !!record.micActive;
  state.videoEndedEarly = !!record.videoEndedEarly;
  state.activeTabId = record.activeTabId ?? null;
  state.tabIds = new Set(record.tabIds || []);
  state.tabs = new Map((record.tabs || []).map((t) => [t.id, t]));
  state.urls = new Set(record.urls || []);
  state.errors = Array.isArray(record.errors) ? record.errors : [];
  return state;
}
