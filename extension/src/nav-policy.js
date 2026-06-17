// What to do with a tab on a chrome.tabs.onUpdated event while recording.
//
// Pure + unit-tested on purpose. The post-navigation re-attach contract is what
// broke once: a full-page navigation (every click in a server-rendered app)
// tears down the content script but leaves the CDP debugger attached, so network
// kept recording while clicks/rrweb/frames silently died for the rest of the
// session. The fix is to re-arm the content script on every navigation. Keeping
// the decision here, separate from the chrome.* plumbing, means that contract
// can't regress without a test failing. See learnings.md 2026-06-17.
//
// Returns an array (a tab can both be first-seen and complete on the same event):
//   "instrument" — first sight of an eligible tab: attach debugger + content script.
//   "reattach"   — a tracked tab finished (re)loading or changed URL in place:
//                  re-arm the content-script capture (debugger is left alone).
export function navActions(changeInfo, { recording, eligible, tracked }) {
  const actions = [];
  if (!recording || !eligible) return actions;
  if (changeInfo.status === "loading") actions.push("instrument");
  if ((changeInfo.status === "complete" || changeInfo.url) && tracked) actions.push("reattach");
  return actions;
}
