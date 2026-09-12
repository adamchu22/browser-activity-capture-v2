"""Grounded, provider-neutral moment and automation indexes. Stdlib only."""
from __future__ import annotations

from collections import Counter
import re

ACTIONS = {"click", "input", "key", "annotation:select", "annotation:draw", "nav"}
STABLE = re.compile(r"^#[A-Za-z][\w-]*$|\[data-(?:testid|test-id|test|cy|qa|automation-id)=")


def number(value):
    try:
        import math
        n = float(value)
        return n if math.isfinite(n) else 0
    except (TypeError, ValueError):
        return 0


def label(event):
    ctx = event.get("ctx") if isinstance(event.get("ctx"), dict) else {}
    return ctx.get("name") or event.get("label") or event.get("selector") or event.get("kind")


def build_moments(steps, frames, api):
    """One record per step; selection is an explicit metadata heuristic, not vision."""
    out = []
    frames = [f for f in frames if isinstance(f, dict)]
    for i, step in enumerate(steps):
        events = step["events"]
        lo = number(step["t"])
        hi = number(steps[i + 1]["t"]) if i + 1 < len(steps) else max(
            [number(e.get("t")) for e in events] + [lo]) + 2000
        actions = [e for e in events if e.get("kind") in ACTIONS]
        # Explicit marks > clicks > inputs > navigation. Prefer later ties,
        # which are more likely to show the completed state.
        priority = {"annotation:select": 5, "annotation:draw": 5, "click": 4,
                    "input": 3, "key": 2, "nav": 1}
        action = max(actions, key=lambda e: (priority.get(e.get("kind"), 0), number(e.get("t"))),
                     default=None)
        candidates = [f for f in frames if lo <= number(f.get("t")) < hi]
        target = number(action.get("t")) if action else lo
        frame = min(candidates, key=lambda f: abs(number(f.get("t")) - target), default=None)
        endpoints = []
        for entry in api:
            if not lo <= number(entry.get("_t")) < hi:
                continue
            if step.get("tab") is not None and entry.get("_tab") is not None and step["tab"] != entry["_tab"]:
                continue
            req, resp = entry.get("request", {}), entry.get("response", {})
            endpoints.append({"t": entry.get("_t"), "method": req.get("method"),
                              "url": req.get("url"), "status": resp.get("status")})
        out.append({
            "step": i + 1, "t": lo, "end_t": hi, "tab": step.get("tab"),
            "frame": frame.get("file") if frame else None,
            "frame_t": frame.get("t") if frame else None,
            "selection_reason": "nearest in-step frame to highest-priority observed action",
            "other_frames": {"count": max(0, len(candidates) - bool(frame)),
                             "from_t": candidates[0].get("t") if candidates else None,
                             "to_t": candidates[-1].get("t") if candidates else None},
            "action": action,
            "actions": actions,
            "narration": [{"t": e.get("t"), "text": e.get("text")}
                          for e in events if e.get("kind") == "speech"],
            "endpoints": endpoints,
            "relationship": "same-step temporal context, not proven causality",
        })
    return out


def automation_candidates(timeline, api):
    selectors, fields, signals = [], [], []
    sequence = []
    for e in timeline:
        sel = e.get("selector")
        if isinstance(sel, str) and STABLE.search(sel):
            selectors.append({"t": e.get("t"), "tab": e.get("tab"), "selector": sel, "label": label(e)})
        if e.get("kind") == "input":
            fields.append({"t": e.get("t"), "tab": e.get("tab"), "selector": sel, "label": label(e)})
        if e.get("kind") in ("click", "input", "key") and (sel or e.get("key")):
            sequence.append((e.get("tab"), e.get("kind"), sel or e.get("key")))
        if e.get("kind") == "nav":
            signals.append({"t": e.get("t"), "kind": "navigation", "url": e.get("url"),
                            "meaning": "observed transition; verify workflow success"})
    endpoints = []
    for e in api:
        req, resp = e.get("request", {}), e.get("response", {})
        row = {"t": e.get("_t"), "tab": e.get("_tab"), "method": req.get("method"),
               "url": req.get("url"), "status": resp.get("status")}
        endpoints.append(row)
        if isinstance(resp.get("status"), int) and 200 <= resp["status"] < 300:
            signals.append({**row, "kind": "HTTP success",
                            "meaning": "transport/application response only; verify task outcome"})
    pairs = Counter(tuple(sequence[i:i + 2]) for i in range(len(sequence) - 1)
                    if sequence[i][0] == sequence[i + 1][0])
    repeated = [{"sequence": pair, "count": count} for pair, count in pairs.items() if count > 1]
    return {"stable_selectors": selectors, "form_fields": fields, "endpoints": endpoints,
            "success_signals": signals, "repeated_sequences": repeated}


def render_moments(moments, fmt):
    lines = ["## Moments", "_One metadata-selected frame per step; inspect it before treating it as the most informative view._"]
    for m in moments:
        action = m["action"]
        text = f"{action.get('kind')} {label(action)}" if action else "no foreground action"
        lines.append(f"- Step {m['step']} · `{fmt(m['t'])}` · {text} · "
                     f"`{m['frame']}` · {m['other_frames']['count']} other frame(s) summarized")
        if m["narration"]:
            lines.append("  - Narration cue(s): " + ", ".join(f"`{fmt(c['t'])}`" for c in m["narration"]))
        if m["endpoints"]:
            lines.append("  - Endpoints in this step: " + "; ".join(
                f"{e['method']} {e['url']} → {e['status']}" for e in m["endpoints"][:8]))
    return "\n".join(lines)


def render_automation(data, fmt):
    lines = ["## Automation candidates",
             "_Observed building blocks, not a recommendation to automate irreversible actions._"]
    for key, title in (
        ("stable_selectors", "Stable selectors"), ("form_fields", "Form fields"),
        ("endpoints", "HAR endpoints"), ("success_signals", "Candidate success signals"),
        ("repeated_sequences", "Repeated two-action sequences"),
    ):
        lines.append(f"### {title}")
        rows = data[key]
        if not rows:
            lines.append("- None observed.")
        for row in rows[:20]:
            if key == "repeated_sequences":
                lines.append(f"- {row['count']}× `{row['sequence']}`")
            else:
                detail = row.get("selector") or row.get("url") or row.get("label") or "unlabelled"
                lines.append(f"- `{fmt(row.get('t', 0))}` {row.get('method', '')} `{detail}`"
                             + (f" → {row['status']}" if row.get("status") is not None else ""))
        if len(rows) > 20:
            lines.append(f"- {len(rows) - 20} more observed; see raw timeline/HAR.")
    return "\n".join(lines)
