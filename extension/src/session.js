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

// Caps on the two unbounded collections in the snapshot. chrome.storage.local has a
// per-extension quota (a few MB without unlimitedStorage); a long, error-heavy or
// many-nav session could push the snapshot past it, and the persist would then start
// FAILING — silently disarming the very crash recovery this exists for. errors and
// urls are the only fields that grow without bound (tabs is bounded by tabs entered),
// so cap them to the most-recent N. The full lists still live in IndexedDB-adjacent
// state for the export; this snapshot only needs enough to keep CONTROLLING and
// finalising the recording after a restart.
const MAX_SNAPSHOT_ERRORS = 50;
const MAX_SNAPSHOT_URLS = 1000;

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
    micActive: !!state.micActive,
    micEndedEarly: !!state.micEndedEarly,
    videoEndedEarly: !!state.videoEndedEarly,
    // Re-share state: the screen share died mid-recording and the overlay is
    // showing the Re-share button. Persist so a worker restart during the
    // awaiting window still surfaces the button after rehydration. videoSegments
    // is a small array of offset markers (one per re-share so far) and is bounded
    // by the realistic number of re-shares in a single recording.
    awaitingReshare: !!state.awaitingReshare,
    videoSegments: Array.isArray(state.videoSegments) ? state.videoSegments : [],
    captureSurface: state.captureSurface ?? null,
    captureTabId: state.captureTabId ?? null,
    captureWindowId: state.captureWindowId ?? null,
    activeTabId: state.activeTabId ?? null,
    storageFull: !!state.storageFull,
    tabIds: [...(state.tabIds || [])],
    tabs: state.tabs ? [...state.tabs.values()] : [],
    urls: [...(state.urls || [])].slice(-MAX_SNAPSHOT_URLS),
    errors: (Array.isArray(state.errors) ? state.errors : []).slice(-MAX_SNAPSHOT_ERRORS),
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
  state.micActive = !!record.micActive;
  state.micEndedEarly = !!record.micEndedEarly;
  state.storageFull = !!record.storageFull;
  state.videoEndedEarly = !!record.videoEndedEarly;
  state.awaitingReshare = !!record.awaitingReshare;
  state.videoSegments = Array.isArray(record.videoSegments) ? record.videoSegments : [];
  state.captureSurface = record.captureSurface ?? null;
  state.captureTabId = record.captureTabId ?? null;
  state.captureWindowId = record.captureWindowId ?? null;
  state.activeTabId = record.activeTabId ?? null;
  state.tabIds = new Set(record.tabIds || []);
  state.tabs = new Map((record.tabs || []).map((t) => [t.id, t]));
  state.urls = new Set(record.urls || []);
  state.errors = Array.isArray(record.errors) ? record.errors : [];
  return state;
}
