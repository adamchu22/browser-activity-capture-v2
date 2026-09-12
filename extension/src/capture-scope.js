// Decide whether a tab is part of the surface the user is actually recording, so the
// overlay + annotation tools + instrumentation don't leak onto windows/tabs that
// aren't in video.webm (Adam's ask: "it should only work in the place I'm recording —
// 1 tab then 1 tab, 1 window 1 window, 1 screen just that screen").
//
// The surface comes from the captured video track's `getSettings().displaySurface`:
//   "browser"  → a single shared tab
//   "window"   → one OS window
//   "monitor"  → a whole display (screen share)
//
// Hard limitation: getDisplayMedia does NOT tell the extension WHICH tab/window/display
// the user picked, so we use the tab the recording started in (and its window) as the
// proxy — correct for tab and window shares, which you start from the thing you share.
//   • browser → only the start tab (follows its navigations; the id is stable).
//   • window  → only tabs in the start window.
//   • monitor / unknown → not display-scoped in v1: a whole-screen share is treated as
//     "everywhere" (correct on a single monitor; scoping a multi-monitor screen share to
//     just the windows on the captured display needs window-geometry↔display matching —
//     staged as a refinement). Defaulting to true here never UNDER-captures.
//
// Pure + dependency-free so it can be unit-tested without chrome.* (tests/test_capture_scope.mjs).
export function inCaptureScope(tab, { surface, captureTabId, captureWindowId } = {}) {
  if (!tab) return false;
  if (surface === "browser") return captureTabId != null && tab.id === captureTabId;
  if (surface === "window") return captureWindowId != null && tab.windowId === captureWindowId;
  return true; // "monitor" / null / unknown — whole screen, not display-scoped in v1
}
