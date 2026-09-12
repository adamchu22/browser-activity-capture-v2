"""Computed UX friction signals — friction.json.

The recording carries the raw signals of where a user struggled; nothing was
computing them, so every analyzing agent re-derived pause detection and
rage-click detection by hand. This module pre-bakes them: long hesitations,
repeated clicks on one target, actions retried across the session, and
error-shaped labels/responses. For a `ux`-purpose capture this IS most of the
deliverable.

Pure and defensive: takes already-parsed `timeline` (list of event dicts) and
optional `api` entries (HAR-style, for non-2xx responses); every field access
is guarded so a malformed event can't raise. Thresholds are conservative so a
signal means something.
"""
from __future__ import annotations

import re

# A hesitation: this long between two consecutive user ACTIONS with nothing in
# between. Long enough that it's not normal reading rhythm — the user was stuck,
# hunting, or waiting on something that didn't respond.
LONG_PAUSE_MS = 30_000
# A rage/repeat burst: this many clicks on the SAME target inside this window.
RAGE_WINDOW_MS = 3_000
RAGE_MIN_CLICKS = 3
# A retried action: the same labelled action performed at least this many times
# across the whole session (e.g. "Load menus" hammered 3×).
RETRY_MIN = 3

# Labels / text that read as an error or dead-end the user hit.
_ERROR_RE = re.compile(
    r"(couldn'?t|could not|cannot|can'?t|fail(ed|ure)?|error|invalid|denied|"
    r"unable|not found|went wrong|try again|retry|⚠|❌|✗)",
    re.IGNORECASE,
)
# Negated error phrasing is GOOD news, not friction ("No failed pushes", "without
# errors", "0 issues"). Strip these before testing so a success message isn't flagged.
_NEG_RE = re.compile(
    r"\b(no|without|zero|0)\s+(\w+\s+){0,2}(fail\w*|error\w*|problem\w*|issue\w*)",
    re.IGNORECASE,
)

# Event kinds that count as a deliberate user action (used for pause detection).
_ACTION_KINDS = {"click", "input", "key", "nav", "annotation:select", "annotation:draw"}


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _target(e: dict) -> str:
    """A stable-ish identity for "the same thing was clicked": prefer the CSS
    selector, fall back to the semantic label / accessible name."""
    sel = e.get("selector")
    if isinstance(sel, str) and sel:
        return sel
    ctx = e.get("ctx") if isinstance(e.get("ctx"), dict) else {}
    for k in ("label", "name", "text"):
        v = e.get(k) or ctx.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _label(e: dict) -> str:
    """Human label for reporting (what the user would recognise)."""
    ctx = e.get("ctx") if isinstance(e.get("ctx"), dict) else {}
    for k in ("label", "name", "text"):
        v = e.get(k) or ctx.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return _target(e) or e.get("kind", "?")


def _long_pauses(actions: list[dict]) -> list[dict]:
    out = []
    for a, b in zip(actions, actions[1:]):
        gap = _num(b.get("t")) - _num(a.get("t"))
        if gap >= LONG_PAUSE_MS:
            out.append({
                "from_t": int(_num(a.get("t"))),
                "to_t": int(_num(b.get("t"))),
                "gap_ms": int(gap),
                "before": _label(b),  # the action they took once unstuck
            })
    return out


def _repeat_clicks(clicks: list[dict]) -> list[dict]:
    """Bursts of ≥RAGE_MIN_CLICKS on one target within RAGE_WINDOW_MS."""
    out = []
    i = 0
    n = len(clicks)
    while i < n:
        tgt = _target(clicks[i])
        if not tgt:
            i += 1
            continue
        j = i + 1
        while (j < n and _target(clicks[j]) == tgt
               and _num(clicks[j].get("t")) - _num(clicks[i].get("t")) <= RAGE_WINDOW_MS):
            j += 1
        count = j - i
        if count >= RAGE_MIN_CLICKS:
            out.append({
                "t": int(_num(clicks[i].get("t"))),
                "target": tgt,
                "label": _label(clicks[i]),
                "count": count,
            })
            i = j
        else:
            i += 1
    return out


def _retried_actions(clicks: list[dict]) -> list[dict]:
    """The same labelled action performed ≥RETRY_MIN times across the session."""
    groups: dict[str, list[float]] = {}
    labels: dict[str, str] = {}
    for e in clicks:
        tgt = _target(e)
        if not tgt:
            continue
        groups.setdefault(tgt, []).append(_num(e.get("t")))
        labels.setdefault(tgt, _label(e))
    out = []
    for tgt, ts in groups.items():
        if len(ts) >= RETRY_MIN:
            ts.sort()
            out.append({
                "target": tgt,
                "label": labels[tgt],
                "count": len(ts),
                "first_t": int(ts[0]),
                "last_t": int(ts[-1]),
            })
    out.sort(key=lambda r: r["count"], reverse=True)
    return out


def _error_events(timeline: list[dict], api: list[dict] | None) -> list[dict]:
    out = []
    for e in timeline:
        if not isinstance(e, dict):
            continue
        text = " ".join(str(e.get(k, "")) for k in ("label", "text"))
        ctx = e.get("ctx") if isinstance(e.get("ctx"), dict) else {}
        text += " " + " ".join(str(ctx.get(k, "")) for k in ("label", "name", "text"))
        if _ERROR_RE.search(_NEG_RE.sub(" ", text)):
            out.append({"t": int(_num(e.get("t"))), "label": _label(e), "source": "ui"})
    for entry in (api or []):
        if not isinstance(entry, dict):
            continue
        resp = entry.get("response") if isinstance(entry.get("response"), dict) else {}
        status = resp.get("status")
        if isinstance(status, int) and status >= 400:
            req = entry.get("request") if isinstance(entry.get("request"), dict) else {}
            out.append({
                "t": int(_num(entry.get("_t"))),
                "label": f"{req.get('method', '?')} {req.get('url', '')} → {status}",
                "source": "network",
            })
    out.sort(key=lambda x: x["t"])
    return out


def _interaction_signals(timeline):
    """Candidates, not diagnoses: absence of a response is not proof of failure."""
    out = {k: [] for k in (
        "dead_clicks", "bounce_backs", "input_churn", "scroll_hunting", "focus_returns"
    )}
    groups = {}
    for e in sorted(timeline, key=lambda e: _num(e.get("t"))):
        tab = e.get("tab")
        if not isinstance(tab, (str, int, type(None))):
            tab = None
        groups.setdefault(tab, []).append(e)
    for tab, events in groups.items():
        end = max((_num(e.get("t")) for e in events), default=0)
        responses = [e for e in events if e.get("kind") in ("nav", "network")]
        navs, inputs, scrolls = [], {}, []
        away = None
        for e in events:
            t, kind = _num(e.get("t")), e.get("kind")
            base = {"t": int(t), "tab": tab, "confidence": "heuristic"}
            if kind == "click" and end >= t + 3000:
                if not any(t < _num(r.get("t")) <= t + 3000 for r in responses):
                    out["dead_clicks"].append({
                        **base, "target": _target(e), "label": _label(e),
                        "window_ms": 3000,
                        "meaning": "no observed same-tab navigation/network response; local UI may have changed",
                    })
            if kind == "nav" and isinstance(e.get("url"), str):
                if not navs or navs[-1].get("url") != e["url"]:
                    navs.append(e)
                if len(navs) >= 3:
                    a, b, c = navs[-3:]
                    if a["url"] == c["url"] != b["url"] and t - _num(a.get("t")) <= 15000:
                        out["bounce_backs"].append({
                            **base, "from_t": int(_num(a.get("t"))),
                            "route": [a["url"], b["url"], c["url"]],
                        })
            if kind == "input" and _target(e):
                history = inputs.setdefault(_target(e), [])
                if not history or history[-1].get("value") != e.get("value"):
                    history.append(e)
                if len(history) >= 3:
                    a, b, c = history[-3:]
                    values = [x.get("value") for x in (a, b, c)]
                    if (all(isinstance(v, str) and "‹redacted" not in v for v in values)
                            and values[0] and values[1] == "" and values[2]
                            and t - _num(a.get("t")) <= 5000):
                        out["input_churn"].append({
                            **base, "from_t": int(_num(a.get("t"))), "target": _target(e),
                        })
            if kind == "scroll":
                scrolls.append(e)
                scrolls = [s for s in scrolls if t - _num(s.get("t")) <= 3000]
                if len(scrolls) >= 4:
                    deltas = [_num(b.get("y")) - _num(a.get("y"))
                              for a, b in zip(scrolls, scrolls[1:])]
                    signs = [1 if d > 0 else -1 for d in deltas if abs(d) >= 20]
                    turns = sum(a != b for a, b in zip(signs, signs[1:]))
                    if turns >= 2:
                        out["scroll_hunting"].append({**base, "reversals": turns, "window_ms": 3000})
                        scrolls = []
            if kind == "focus":
                if e.get("focused") is False:
                    away = t
                elif e.get("focused") is True and away is not None:
                    out["focus_returns"].append({
                        **base, "from_t": int(away), "away_ms": int(t - away),
                    })
                    away = None
    return out


def compute_friction(timeline: list[dict], api: list[dict] | None = None) -> dict:
    """All friction signals from a parsed timeline (+ optional HAR entries)."""
    timeline = [e for e in (timeline or []) if isinstance(e, dict)]
    actions = sorted((e for e in timeline if e.get("kind") in _ACTION_KINDS),
                     key=lambda e: _num(e.get("t")))
    clicks = [e for e in actions if e.get("kind") == "click"]

    long_pauses = _long_pauses(actions)
    repeat_clicks = _repeat_clicks(clicks)
    retried = _retried_actions(clicks)
    errors = _error_events(timeline, api)

    extra = _interaction_signals(timeline)
    return {
        "schema_version": 2,
        **extra,
        "long_pauses": long_pauses,
        "repeat_clicks": repeat_clicks,
        "retried_actions": retried,
        "error_events": errors,
        "summary": {
            **{key: len(value) for key, value in extra.items()},
            "long_pauses": len(long_pauses),
            "repeat_clicks": len(repeat_clicks),
            "retried_actions": len(retried),
            "error_events": len(errors),
        },
    }
