"""Intent extraction — todos.json (the franchise feature).

The narration is the one layer no other capture format carries: the user says
*why*, and explicitly flags "add that as a to-do." Until now nothing extracted
it, so every analyzing agent re-read the transcript and pulled the intent by
hand. This classifies each narration utterance into bug / to-do / question /
praise / research / decision and attaches the EVIDENCE around it — the nearest
frame, the element the user was on, the API call it triggered — so each item is
born ready to act on, not just a quote.

This is the heuristic core: keyword/shape classification, stdlib-only, so it
runs with no model and no network (preserving pack.py's no-provider-lock-in
default). An optional LLM pass can refine/augment it later (catching implicit
intent the keywords miss). Pure and defensive: takes
parsed `speech` cues (`[{"t", "text"}]`) and the merged `timeline`; never raises.
"""
from __future__ import annotations

import re

# Ordered by priority — the FIRST matching category wins, so an utterance that
# is both a question and a to-do ("should we add a filter?") is classed by the
# strongest signal. Each pattern is intentionally high-precision: a miss (left
# unclassified) is cheaper than a false to-do.
_CATEGORIES = [
    ("feature-request", re.compile(
        r"\b(this should (do|show|be)|would be (better|nice|helpful) if|"
        r"i wish (this|it) would|can we change|what if this was|make it easier to)\b",
        re.IGNORECASE)),
    ("ui-improvement", re.compile(
        r"\b(it keeps|every time i|annoying|frustrating|confusing)\b", re.IGNORECASE)),
    ("how-to", re.compile(
        r"\b(here'?s how|this is how|to do this|the way to|first you|then you)\b",
        re.IGNORECASE)),
    ("self-instruction", re.compile(
        r"\b(i (need to|have to|must)|let me|next i|now i (click|open|select|type|press))\b",
        re.IGNORECASE)),
    ("to-do", re.compile(
        r"\b(add (that|this)?\s*(as )?a? ?(to-?do|task)|to-?do|"
        r"make a (task|ticket|note)|we should|we need to|need to|"
        r"let'?s (add|make|build|fix|change)|remind me to|put (that|this) on the list|"
        r"action item|follow ?up)\b", re.IGNORECASE)),
    ("bug", re.compile(
        r"\b(that'?s a bug|this is (a bug|broken)|is broken|doesn'?t work|"
        r"not working|shouldn'?t (be|do|happen)|that'?s wrong|this is wrong|"
        r"broke(n)?|glitch|why (is|did) (this|that|it).*(fail|break|error))\b",
        re.IGNORECASE)),
    # A question: ends with '?' (ASR punctuates these reliably), OR opens with an
    # interrogative modal phrase. The bare wh-word-at-start branch was dropped — it
    # mis-fires on declaratives ("What they would have to do is …").
    ("question", re.compile(
        r"(\?\s*$|^\s*(can we|could we|should we|do we|should i|can i|how do i|how does|"
        r"is there|are there|what if|why (is|does|are|can'?t|won'?t))\b)", re.IGNORECASE)),
    ("research", re.compile(
        r"\b(look into|figure out|find out|investigate|research|dig into|"
        r"check (whether|if)|not sure (how|why|if|whether)|wonder (if|whether|how))\b",
        re.IGNORECASE)),
    ("decision", re.compile(
        r"\b(let'?s (go with|use|keep|stick with)|we'?ll (use|go with|keep)|"
        r"decided? to|going to (use|go with)|i'?ll (use|keep))\b", re.IGNORECASE)),
    ("praise", re.compile(
        r"\b(i (like|love)|that'?s (nice|great|good|clean|slick)|looks? (good|great|nice|clean)|"
        r"works? (well|great|nicely)|love (this|that|it)|nice(ly)?)\b", re.IGNORECASE)),
]

_ACTION_KINDS = {"click", "input", "key", "nav", "annotation:select", "annotation:draw"}


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def classify(text: str) -> str | None:
    """The category of an utterance, or None if it carries no actionable intent."""
    if not isinstance(text, str) or not text.strip():
        return None
    for label, pat in _CATEGORIES:
        if pat.search(text):
            return label
    return None


def _nearest(items: list[dict], t: float, key="t"):
    """The item closest in time to t (items need not be sorted). None if empty."""
    best, best_d = None, None
    for it in items:
        d = abs(_num(it.get(key)) - t)
        if best_d is None or d < best_d:
            best, best_d = it, d
    return best


def _evidence(t: float, timeline: list[dict], frames: list[dict] | None,
              api: list[dict] | None, window_ms: int = 6000) -> dict:
    """The element / frame / endpoint around an utterance at time t — what makes
    a to-do actionable instead of just a quote."""
    ev: dict = {"relationship": "temporal-proximity", "causality": "unconfirmed"}
    # Nearest user action within the window → the element the user was on.
    actions = [e for e in timeline
               if isinstance(e, dict) and e.get("kind") in _ACTION_KINDS
               and abs(_num(e.get("t")) - t) <= window_ms]
    act = _nearest(actions, t)
    if act:
        ev["action_t"] = int(_num(act.get("t")))
        ev["action_delta_ms"] = int(_num(act.get("t")) - t)
        ev["action_kind"] = act.get("kind")
        ev["tab"] = act.get("tab")
        ctx = act.get("ctx") if isinstance(act.get("ctx"), dict) else {}
        label = act.get("label") or ctx.get("name") or ctx.get("label")
        if label:
            ev["element"] = str(label)
        if act.get("selector"):
            ev["selector"] = str(act["selector"])
    # Nearest frame (visual ground truth).
    fr = _nearest(frames or [], t)
    if fr and fr.get("file") and abs(_num(fr.get("t")) - t) <= window_ms:
        ev["frame"] = fr["file"]
        ev["frame_delta_ms"] = int(_num(fr.get("t")) - t)
    # Nearest API call within the window → the endpoint the action hit.
    near_api = [e for e in (api or [])
                if isinstance(e, dict) and abs(_num(e.get("_t")) - t) <= window_ms
                and (not act or act.get("tab") is None or e.get("_tab") is None
                     or act.get("tab") == e.get("_tab"))]
    a = _nearest(near_api, t, key="_t")
    if a:
        ev["endpoint_delta_ms"] = int(_num(a.get("_t")) - t)
        ev["endpoint_tab"] = a.get("_tab")
        req = a.get("request") if isinstance(a.get("request"), dict) else {}
        if req.get("url"):
            ev["endpoint"] = f"{req.get('method', '')} {req['url']}".strip()
    return ev


def extract_todos(speech: list[dict], timeline: list[dict] | None = None,
                  frames: list[dict] | None = None, api: list[dict] | None = None) -> list[dict]:
    """Classify every narration utterance and attach its evidence. Returns the
    actionable ones (unclassified chatter is dropped), in time order."""
    timeline = [e for e in (timeline or []) if isinstance(e, dict)]
    out = []
    for cue in (speech or []):
        if not isinstance(cue, dict):
            continue
        text = cue.get("text")
        text = text.strip() if isinstance(text, str) else ""
        cat = classify(text)
        if not cat:
            continue
        t = _num(cue.get("t"))
        out.append({
            "t": int(t),
            "type": cat,
            "text": text,
            "evidence": _evidence(t, timeline, frames, api),
        })
    out.sort(key=lambda x: x["t"])
    return out
