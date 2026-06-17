// What to do with a tab on a chrome.tabs.onUpdated event while recording.
//
// Pure + unit-tested on purpose. Two contracts live here:
//
//  1. Re-attach on navigation. A full-page navigation (every click in a
//     server-rendered app) tears down the content script but leaves the CDP
//     debugger attached — so without a re-arm, network keeps recording while
//     clicks/rrweb/frames silently die. Any TRACKED tab that finishes loading or
//     changes URL in place gets "reattach".
//
//  2. Capture only tabs the user actually enters. We do NOT instrument every
//     open tab — that swept up background tabs (a password manager, chat,
//     calendar) the user never touched. Instead the worker instruments the tab
//     recording starts in, plus each tab as the user focuses it
//     (tabs.onActivated). The only onUpdated-driven instrumentation is the
//     ACTIVE tab finishing a load while still untracked — which covers the
//     recording tab navigating from a restricted page (chrome://) to a real one.
//
// See learnings.md 2026-06-17. Returns an array (actions are independent):
//   "reattach"   — tracked tab (re)loaded / changed URL: re-arm content capture.
//   "instrument" — active, untracked tab finished loading: start capturing it.
export function navActions(changeInfo, { recording, eligible, tracked, active }) {
  const actions = [];
  if (!recording || !eligible) return actions;
  if (tracked && (changeInfo.status === "complete" || changeInfo.url)) {
    actions.push("reattach");
  }
  if (!tracked && active && changeInfo.status === "complete") {
    actions.push("instrument");
  }
  return actions;
}
