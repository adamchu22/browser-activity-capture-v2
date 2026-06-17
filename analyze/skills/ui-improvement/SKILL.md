---
name: ui-improvement
description: Turn observed UI friction in a browser capture into concrete, grounded UI/UX improvements — and, when the app's source is available, into actual code changes. Use when the capture's purpose includes "UX / product feedback" or "Propose UI changes".
---

# UI improvement from a capture

A capture shows a real person using a real UI. That's the highest-signal usability
data there is: where they hesitated, backtracked, mis-clicked, or hunted for something
is a UI problem you can see. This skill turns those observations into fixes.

## 1. Find the friction (evidence first)

Scan the Steps and timeline for friction signals, each tied to a `timestamp` + frame:

- **Hesitation** — a long gap (the timeline shows pauses) before an action.
- **Backtracking** — navigating away and back, or undoing an action.
- **Hunting** — many hovers/scrolls before a click (the user searching for the control).
- **Mis-clicks** — a click followed quickly by a different click (first one wrong).
- **Repetition** — the same multi-step sequence done more than once.
- **Dead-ends / errors** — error or empty states in frames; 4xx/5xx in the network.
- **Narration tells** — "where is…", "I always have to…", "this is confusing",
  "you'd think…". Quote these; they're the user naming the problem.

For each, open `frames-annotated.html` at that timestamp to see exactly what was on
screen and which element was involved.

## 2. Propose changes — write `ui-changes.md`

One entry per change, ranked by impact (friction severity × frequency):

```
### <short title>
- **Where:** <page/section> · element `<accessible name / role>` · selector `<css>`
- **Observed:** <the friction, with `timestamp` and frame ref> — quote narration if any
- **Current:** <what the UI does now>
- **Proposed:** <the specific change — label, placement, default, affordance, flow>
- **Why it helps:** <the friction it removes>
- **Heuristic:** <e.g. visibility of system status / recognition over recall /
  error prevention / accessibility (contrast, target size, labels)>
```

Be concrete and grounded — cite the real selector/element from the capture, not a
generic "improve the layout". Prefer changes that remove a step over changes that
decorate one.

## 3. Make the change (when you have the source)

If the app's repository is available, go past proposing to **implementing**:

1. Locate the element. The capture gives you a unique CSS selector and the element's
   accessible name/text — grep the codebase for the id/test-id/visible text to find the
   component. Confirm it's the right one (the frame shows what it looks like).
2. Make the smallest change that fixes the observed friction. Keep it consistent with
   the surrounding code's conventions.
3. Verify: re-check it against the frame/flow, run the app's tests/linters, and note
   what you couldn't verify.
4. Record each applied change in `ui-changes.md` with the file + a one-line diff
   summary, linked back to the friction it fixes.

Never invent a problem to justify a change. If the capture shows a smooth flow with no
friction for some area, say so — "no UI issues observed in <area>".
