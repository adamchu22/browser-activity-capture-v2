#!/usr/bin/env python3
"""Turn a Capture Bundle into a portable, LLM-agnostic analysis pack.

No API keys, no SDK, no network — pure stdlib. It flattens the bundle into a
single readable `context.md`, copies the brief, frames, and raw files, and writes
a pack you can hand to *any* agent or harness:

  - point Claude Code (or any coding agent) at the pack directory
  - paste `context.md` + `BRIEF.md` into any chat LLM
  - feed it to your own harness via the optional adapters/ runners

The agent reads BRIEF.md, looks at context.md and frames/, and writes the asset
package (SOP.md, skills/<name>/SKILL.md, automation.suggestions.md, notes.md)
back into the pack.

Usage:
    python pack.py ../sample-bundle --out ./analysis-pack
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

_VTT_TIME = re.compile(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->")

BRIEF = Path(__file__).parent / "BRIEF.md"
NETFILTER = Path(__file__).parent / "netfilter.json"
SKILLS_DIR = Path(__file__).parent / "skills"  # preloaded, bundled into each pack
RAW_FILES = ["manifest.json", "timeline.json", "transcript.vtt", "network.har", "events.jsonl", "errors.json"]

# Which activity skills to bundle for a given purpose. `analyze-capture` (the
# consumption procedure) is always included; this maps the rest. Add a purpose→skill
# entry here when you drop a new skill into analyze/skills/.
SKILLS_FOR_PURPOSE = {
    "ux": ["ui-improvement"],
    "ui": ["ui-improvement"],
    "research": ["competitive-research"],
}


def skills_for(purposes: list[str]) -> list[str]:
    """The skill names to bundle: analyze-capture always, plus any mapped to the chosen
    purposes (deduped, stable order)."""
    names = ["analyze-capture"]
    for p in purposes or []:
        for s in SKILLS_FOR_PURPOSE.get(p, []):
            if s not in names:
                names.append(s)
    return [n for n in names if (SKILLS_DIR / n / "SKILL.md").exists()]

# Why the user recorded — picked at capture time. Each purpose is a reading LENS and a
# deliverable, so the same recording yields a skill, a doc, UX feedback, or an
# efficiency teardown depending on intent. Surfaced at the top of context.md to steer
# the analyzing agent; the keys match the extension popup.
PURPOSES = {
    "skill": {
        "label": "Build a skill / automation",
        "read": "Focus on replayable mechanics — exact selectors, URLs, API endpoints, "
                "required inputs, and the success signal (confirming response or redirect). "
                "Flag what's safe to automate vs. must stay human-in-the-loop.",
        "make": "`skills/<name>/SKILL.md` + `automation.suggestions.md`",
    },
    "docs": {
        "label": "Documentation / SOP",
        "read": "Focus on a clear human-followable procedure — preconditions, the happy "
                "path, decision points and eligibility checks the narrator mentioned, and "
                "the why behind each step.",
        "make": "`SOP.md`",
    },
    "ux": {
        "label": "UX / product feedback",
        "read": "Focus on friction — hesitation and long pauses, backtracking, dead-ends, "
                "repeated attempts, confusing labels, error/empty states, slow steps. Cite "
                "the frame and timestamp for each.",
        "make": "`feedback.md` — issues with severity and where they occurred",
    },
    "ui": {
        "label": "Propose UI changes",
        "read": "Find friction (as for UX feedback), then prescribe concrete UI changes "
                "grounded in the captured element (selector + accessible name) and the "
                "frame. If the app's source is available, implement the change. Follow the "
                "bundled `ui-improvement` skill.",
        "make": "`ui-changes.md` — proposed (and, with source, applied) changes ranked by impact",
    },
    "improve": {
        "label": "Find a better / faster way",
        "read": "Focus on inefficiency — redundant or manual steps, repeated navigation, "
                "things doable in fewer clicks or via an API instead of the UI, rekeying "
                "that could be batched.",
        "make": "`improvements.md` — concrete suggestions ranked by time saved",
    },
    "research": {
        "label": "Competitive / product research",
        "read": "This is another product worth learning from. Extract how it works — UX "
                "patterns from the frames, the flow from the steps, and the architecture / "
                "data model from the network (HAR). Note what they do well and gaps to "
                "differentiate on. Learn patterns and principles, never copy proprietary "
                "assets. Follow the bundled `competitive-research` skill.",
        "make": "`research.md` — a competitive teardown with takeaways for your own version",
    },
    "general": {
        "label": "General capture",
        "read": "No single lens — capture the full picture.",
        "make": "the standard pack (`SOP.md`, `skills/<name>/SKILL.md`, "
                "`automation.suggestions.md`, `notes.md`)",
    },
}


def render_purpose(purposes: list[str]) -> str:
    """A steer block from the user's chosen purpose(s). Empty when none were given
    (v1 bundles) — the agent falls back to the full BRIEF.md menu."""
    keys = [p for p in (purposes or []) if p in PURPOSES]
    if not keys:
        return ""
    lines = ["## Purpose of this recording",
             "The user recorded this specifically to do the following — read the capture "
             "through these lenses and produce these outputs (plus `notes.md`):", ""]
    for k in keys:
        p = PURPOSES[k]
        lines.append(f"- **{p['label']}** — {p['read']} → produce {p['make']}.")
    return "\n".join(lines) + "\n"

# Fallback if netfilter.json is missing, so pack.py stays zero-config.
_DEFAULT_BLOCKLIST = ["google-analytics", "googletagmanager", "doubleclick.net",
                      "chartbeat", "imrworldwide", "scorecardresearch", "taboola.com"]


def load_blocklist() -> list[str]:
    """Low-signal hostnames (analytics/ads/tracking) to collapse in context.md."""
    if NETFILTER.exists():
        try:
            data = json.loads(NETFILTER.read_text())
            return [h.lower() for h in data.get("blocklist", [])]
        except (json.JSONDecodeError, AttributeError):
            pass
    return _DEFAULT_BLOCKLIST


def host(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except ValueError:
        return ""


def is_low_signal(url: str, blocklist: list[str]) -> bool:
    """True when the URL is analytics/ad/tracking noise. Matches a blocklist entry as
    a case-insensitive substring of host (or host+path, for 'facebook.com/tr'-style
    rules)."""
    if not blocklist:
        return False
    h = host(url)
    if not h:
        return False
    hp = (h + urlparse(url).path).lower()
    return any(b in h or ("/" in b and b in hp) for b in blocklist)


def ms(t: int) -> str:
    return f"{t // 60000:02d}:{(t % 60000) // 1000:02d}.{t % 1000:03d}"


def pos(e: dict) -> str:
    """Resolution-independent pointer position, e.g. '  @(62%,18%)'. Empty when
    the event carries no coordinates (older bundles, non-pointer events)."""
    if e.get("xpct") is None or e.get("ypct") is None:
        return ""
    return f"  @({e['xpct']}%,{e['ypct']}%)"


def parse_vtt_cues(text: str) -> list[dict]:
    """Pull narration cues out of a transcript.vtt as speech timeline events
    (t in ms since t0), so they merge into the action timeline."""
    cues, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        m = _VTT_TIME.search(lines[i])
        if not m:
            i += 1
            continue
        h, mn, s, ms = (int(x) for x in m.groups())
        start = ((h * 60 + mn) * 60 + s) * 1000 + ms
        body, i = [], i + 1
        while i < len(lines) and lines[i].strip():
            body.append(lines[i].strip())
            i += 1
        if body:
            cues.append({"t": start, "kind": "speech", "text": " ".join(body)})
    return cues


def nearest_frame(t: int, frames: list[dict], window_ms: int = 2000) -> str | None:
    """The screenshot captured closest in time to an event (frames are grabbed at
    click/nav/hover moments, so this binds an action to what was on screen then).
    Returns the frame file, or None if none is within window_ms."""
    best, best_dt = None, window_ms + 1
    for f in frames:
        dt = abs(f.get("t", 0) - t)
        if dt < best_dt:
            best, best_dt = f, dt
    return (best.get("file") if best else None) if best_dt <= window_ms else None


def short_url(url: str) -> str:
    """Host + path, query stripped — readable in a procedure line."""
    base = url.split("?", 1)[0]
    return base or url


def action_label(e: dict) -> str:
    """Human phrase for an action, preferring the captured semantic context (ctx)
    over a raw selector: `button "Issue refund" in "Order actions"`. Falls back to
    the legacy label/selector (unquoted) when no ctx was captured (v1 bundles)."""
    ctx = e.get("ctx") or {}
    name, role, section = ctx.get("name"), ctx.get("role"), ctx.get("section")
    if name and role:
        s = f'{role} "{name}"'
    elif name:
        s = f'"{name}"'
    elif role:
        s = role
    else:
        return e.get("label") or e.get("selector", "")
    if section:
        s += f' in "{section}"'
    return s


def input_label(e: dict) -> str:
    ctx = e.get("ctx") or {}
    return f'"{ctx["name"]}"' if ctx.get("name") else e.get("selector", "")


def _collapsed_line(run: list[dict]) -> str:
    """One summary line standing in for a run of collapsed low-signal requests."""
    t = ms(run[0].get("t", 0))
    hosts = []
    for e in run:
        h = host(e.get("url", ""))
        if h and h not in hosts:
            hosts.append(h)
    shown = ", ".join(hosts[:6]) + (f", +{len(hosts) - 6} more" if len(hosts) > 6 else "")
    n = len(run)
    return f"- `{t}`  ⋯ {n} low-signal request{'s' if n != 1 else ''} collapsed · {shown}"


def render_timeline(events: list[dict], blocklist: list[str] | None = None,
                    tab_labels: dict | None = None) -> str:
    """One readable line per event. Consecutive low-signal network pings (analytics,
    ads, trackers) are collapsed into a single summary line so the timeline stays
    readable; pass blocklist=None to render everything verbatim. When the capture
    spans multiple tabs (tab_labels has >1 entry), a marker line is emitted each
    time the active tab changes, so the merged one-clock timeline reads as the user
    moving between tabs."""
    blocklist = blocklist or []
    tab_labels = tab_labels or {}
    multi_tab = len(tab_labels) > 1
    lines = []
    run: list[dict] = []  # accumulating consecutive low-signal network events
    current_tab = None

    def flush():
        if run:
            lines.append(_collapsed_line(run))
            run.clear()

    for e in events:
        if (e.get("kind") == "network" and blocklist
                and is_low_signal(e.get("url", ""), blocklist)):
            run.append(e)
            continue
        flush()
        t = ms(e.get("t", 0))
        # Mark a tab switch so a multi-tab recording reads in order.
        tab = e.get("tab")
        if multi_tab and tab is not None and tab in tab_labels and tab != current_tab:
            current_tab = tab
            lines.append(f"- `{t}`  ━━━ tab {tab_labels[tab]} ━━━")
        kind = e.get("kind", "?")
        if kind == "nav":
            body = f"→ navigate {e.get('url','')}"
        elif kind == "speech":
            body = f'🗣  "{e.get("text","")}"'
        elif kind == "click":
            body = f"click {action_label(e)}  [{e.get('selector','')}]" + pos(e)
        elif kind == "hover":
            body = f"👆 hover {action_label(e)}  [{e.get('selector','')}]" + pos(e)
        elif kind == "input":
            body = f"type into {input_label(e)} = {e.get('value','')}"
        elif kind == "key":
            body = f"key {e.get('key','')}"
        elif kind == "network":
            body = f"{e.get('method','')} {e.get('url','')} → {e.get('status','')} ({e.get('ms','?')}ms)"
            if e.get("request_body"):
                body += f"  body={json.dumps(e['request_body'])}"
        else:
            body = json.dumps({k: v for k, v in e.items() if k != "t"})
        frame = f"   {{frame: {e['frame']}}}" if e.get("frame") else ""
        lines.append(f"- `{t}`  {body}{frame}")
    flush()  # trailing run of low-signal events
    return "\n".join(lines)


# ---- step segmentation (the narrated procedure) --------------------------

def _effective_tabs(events: list[dict]) -> list:
    """A speech cue has no tab, but it narrates the action that FOLLOWS it — so for
    segmentation it should belong to the next action's tab. Forward-fill each speech
    event's tab from the next event that has one."""
    eff = [e.get("tab") for e in events]
    next_tab = None
    for i in range(len(events) - 1, -1, -1):
        if events[i].get("tab") is not None:
            next_tab = events[i]["tab"]
        elif events[i].get("kind") == "speech":
            eff[i] = next_tab
    return eff


def segment_steps(events: list[dict], gap_ms: int = 2500) -> list[dict]:
    """Group the flat event stream into intent-bearing steps. A new step starts at a
    navigation, a tab switch, or a >gap_ms pause — the natural seams in a task.
    Narration forward-binds to the action it introduces (a big pause before a cue
    starts a new step with that cue), so what the user SAID sits with what they DID."""
    steps: list[dict] = []
    eff = _effective_tabs(events)
    cur = None
    last_t = None
    last_tab = None
    for i, e in enumerate(events):
        kind, t, tab = e.get("kind"), e.get("t", 0), eff[i]
        boundary = (
            cur is None
            or kind == "nav"
            or (tab is not None and last_tab is not None and tab != last_tab)
            or (last_t is not None and t - last_t >= gap_ms)
        )
        if boundary:
            cur = {"t": t, "tab": tab, "events": []}
            steps.append(cur)
        cur["events"].append(e)
        last_t = t
        if tab is not None:
            last_tab = tab
    return steps


def _frame_ref(e: dict, frames: list[dict]) -> str:
    """A ` → frames/x.png @(x%,y%)` suffix pointing a vision agent at the exact
    screenshot and on-screen spot for this action. Empty if no frame matches."""
    f = nearest_frame(e.get("t", 0), frames) if frames else None
    if not f:
        return ""
    coord = pos(e).strip()  # '@(x%,y%)' or ''
    return f"  → {f}" + (f" {coord}" if coord else "")


def render_steps(events: list[dict], blocklist: list[str] | None = None,
                 tab_labels: dict | None = None, tab_urls: dict | None = None,
                 frames: list[dict] | None = None) -> str:
    """A draft narrated procedure: each step's narration (the intent) above the
    actions that carried it out. Hovers and low-signal network are dropped here to
    keep it SOP-shaped — the full detail stays in the raw timeline below."""
    blocklist = blocklist or []
    tab_labels = tab_labels or {}
    tab_urls = tab_urls or {}
    frames = frames or []
    multi_tab = len(tab_labels) > 1
    steps = segment_steps(events)
    out: list[str] = []
    cur_url = ""
    for i, step in enumerate(steps, 1):
        evs = step["events"]
        nav = next((e for e in evs if e.get("kind") == "nav"), None)
        if nav:
            cur_url = nav.get("url", "")  # an explicit navigation in this step
        # The step's URL: its own nav if any, else the tab it ran in, else carry over.
        step_url = (nav.get("url", "") if nav else "") or tab_urls.get(step["tab"], "") or cur_url

        head = f"### Step {i} · `{ms(step['t'])}`"
        if multi_tab and step["tab"] in tab_labels:
            head += f" · tab {tab_labels[step['tab']]}"
        if step_url:
            head += f" · {short_url(step_url)}"
        out.append(head)

        narration = " ".join(e.get("text", "").strip() for e in evs if e.get("kind") == "speech").strip()
        if narration:
            out.append(f'🗣 "{narration}"')

        net_shown, net_collapsed = [], 0
        for e in evs:
            k = e.get("kind")
            if k == "nav":
                out.append(f"- → navigate {short_url(e.get('url', ''))}")
            elif k == "click":
                out.append(f"- click {action_label(e)}{_frame_ref(e, frames)}")
            elif k == "input":
                out.append(f"- type into {input_label(e)} = {e.get('value', '')}")
            elif k == "key":
                out.append(f"- press {e.get('key', '')}")
            elif k == "network":
                if blocklist and is_low_signal(e.get("url", ""), blocklist):
                    net_collapsed += 1
                else:
                    net_shown.append(e)
            # hover/speech intentionally omitted from the procedure view
        for e in net_shown:
            out.append(f"- {e.get('method', '')} {short_url(e.get('url', ''))} → {e.get('status', '')}")
        if net_collapsed:
            out.append(f"- _({net_collapsed} low-signal request(s))_")
        out.append("")
    return "\n".join(out).strip()


def _esc(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def build_annotated_frames_html(events: list[dict], frames: list[dict]) -> str:
    """The 'draw on screen' view: each click/hover frame with a marker drawn on the
    targeted element — a ring at the click %coords and (when known) the element's
    bounding box. Pure HTML/CSS layered over the copied frames/ PNGs; open it in a
    browser. Returns '' if there's nothing to annotate."""
    cards = []
    for e in events:
        if e.get("kind") not in ("click", "hover"):
            continue
        if e.get("xpct") is None or e.get("ypct") is None:
            continue
        f = nearest_frame(e.get("t", 0), frames)
        if not f:
            continue
        ctx = e.get("ctx") or {}
        label = ctx.get("name") or e.get("label") or e.get("selector", "")
        role = ctx.get("role", "")
        x, y = e["xpct"], e["ypct"]
        # Optional element box, as % of the viewport/screenshot.
        box = ""
        rect, vp = e.get("rect"), e.get("viewport")
        if rect and vp and vp.get("w") and vp.get("h"):
            bx, by = rect["x"] / vp["w"] * 100, rect["y"] / vp["h"] * 100
            bw, bh = rect["w"] / vp["w"] * 100, rect["h"] / vp["h"] * 100
            box = f'<div class="box" style="left:{bx:.1f}%;top:{by:.1f}%;width:{bw:.1f}%;height:{bh:.1f}%"></div>'
        cards.append(
            f'<figure>\n'
            f'  <figcaption><code>{ms(e.get("t",0))}</code> · {_esc(e.get("kind"))} '
            f'<b>{_esc(label)}</b>{(" (" + _esc(role) + ")") if role else ""}</figcaption>\n'
            f'  <div class="shot">\n'
            f'    <img src="{_esc(f)}" loading="lazy" alt="{_esc(label)}">\n'
            f'    {box}\n'
            f'    <div class="dot" style="left:{x}%;top:{y}%"></div>\n'
            f'  </div>\n'
            f'</figure>'
        )
    if not cards:
        return ""
    return (
        "<!doctype html>\n<html><head><meta charset='utf-8'><title>Annotated frames</title>\n"
        "<style>\n"
        "body{font:14px system-ui,sans-serif;margin:0;padding:16px;background:#f4f4f5}\n"
        "h1{font-size:16px}\n"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}\n"
        "figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:6px;overflow:hidden}\n"
        "figcaption{padding:6px 8px;font-size:12px;color:#333;border-bottom:1px solid #eee}\n"
        ".shot{position:relative;line-height:0}\n"
        ".shot img{width:100%;height:auto}\n"
        ".dot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:3px solid #e11;"
        "border-radius:50%;box-shadow:0 0 0 2px #fff,0 0 6px rgba(0,0,0,.5)}\n"
        ".box{position:absolute;border:2px solid rgba(225,17,17,.7);background:rgba(225,17,17,.08)}\n"
        "</style></head><body>\n"
        "<h1>Annotated frames — where each action landed</h1>\n"
        f"<div class='grid'>\n{chr(10).join(cards)}\n</div>\n</body></html>\n"
    )


def build_context(bundle: Path, blocklist: list[str] | None = None) -> str:
    blocklist = blocklist or []
    manifest = json.loads((bundle / "manifest.json").read_text()) if (bundle / "manifest.json").exists() else {}
    timeline = json.loads((bundle / "timeline.json").read_text())
    transcript = (bundle / "transcript.vtt").read_text() if (bundle / "transcript.vtt").exists() else ""

    # Merge narration cues into the action timeline so "click X" and what the user
    # said while doing it sit next to each other on one clock.
    speech = parse_vtt_cues(transcript)
    timeline = sorted(timeline + speech, key=lambda e: e.get("t", 0))

    network_summary = ""
    har_path = bundle / "network.har"
    if har_path.exists():
        har = json.loads(har_path.read_text())
        rows, collapsed = [], []
        for entry in har.get("log", {}).get("entries", []):
            req = entry.get("request", {})
            url = req.get("url", "")
            if blocklist and is_low_signal(url, blocklist):
                collapsed.append(host(url))
                continue
            rows.append(f"- {req.get('method','')} {url} → "
                        f"{entry.get('response',{}).get('status','')}")
        if collapsed:
            uniq = []
            for h in collapsed:
                if h and h not in uniq:
                    uniq.append(h)
            shown = ", ".join(uniq[:8]) + (f", +{len(uniq) - 8} more" if len(uniq) > 8 else "")
            rows.append(f"- _({len(collapsed)} low-signal request(s) collapsed · {shown})_")
        network_summary = "\n".join(rows)

    # The manifest's urls_visited list also picks up tracker/ad request URLs; drop the
    # low-signal ones (and note how many) so this list reads as real destinations.
    urls = manifest.get("urls_visited", [])
    kept_urls = [u for u in urls if not (blocklist and is_low_signal(u, blocklist))]
    dropped = len(urls) - len(kept_urls)
    urls_block = "\n".join("- " + u for u in kept_urls) or "- (none recorded)"
    if dropped:
        urls_block += f"\n- _({dropped} low-signal URL(s) hidden)_"

    # Multi-tab legend (v2 bundles). Map each tab id to a short ordinal (#1, #2…)
    # used both here and as the timeline's tab-switch markers.
    tabs = manifest.get("tabs", [])
    tab_labels = {t["id"]: f"#{i + 1}" for i, t in enumerate(tabs) if "id" in t}
    tab_urls = {t["id"]: t.get("url", "") for t in tabs if "id" in t}
    tabs_block = ""
    if len(tabs) > 1:
        rows = [f"- **#{i + 1}** {t.get('url', '')}" + (f" — {t['title']}" if t.get("title") else "")
                for i, t in enumerate(tabs)]
        tabs_block = "\n## Tabs (recorded in parallel)\n" + "\n".join(rows) + "\n"

    frames = manifest.get("frames", [])
    frame_index = "\n".join(f"- `{ms(f['t'])}` → `frames/{Path(f['file']).name}`" for f in frames)

    # Surface capture problems up top: anything in errors.json plus the specific
    # narration failure reason, so a bad run is obvious without digging.
    errors = []
    err_path = bundle / "errors.json"
    if err_path.exists():
        try:
            errors = json.loads(err_path.read_text())
        except json.JSONDecodeError:
            errors = []
    issue_lines = [f"- `{ms(e.get('t', 0))}` **{e.get('where','?')}**: {e.get('message','')}" for e in errors]
    if manifest.get("narration_error"):
        issue_lines.insert(0, f"- **narration**: {manifest['narration_error']} (no voice in video.webm)")
    issues_block = ("\n## ⚠ Capture issues\n" + "\n".join(issue_lines) + "\n") if issue_lines else ""

    # The user's stated goal + why they recorded — up top, the anchors for everything.
    task = (manifest.get("task") or "").strip()
    task_block = f"\n> **Task (stated by the user):** {task}\n" if task else ""
    purpose_block = render_purpose(manifest.get("purposes", []))
    purpose_block = ("\n" + purpose_block) if purpose_block else ""

    return f"""# Analysis context — {manifest.get('capture_id', bundle.name)}
{task_block}{purpose_block}
Captured {manifest.get('t0_wall','?')} · duration {manifest.get('duration_ms','?')} ms ·
sync mode `{manifest.get('sync_mode','?')}`. Secrets redacted as `‹redacted›`.
{issues_block}{tabs_block}
## URLs visited
{urls_block}

## Steps (narrated procedure)
_Auto-segmented from the recording; the user's narration is the intent, the bullets
are what they did. See the raw timeline below for full detail (hovers, every request)._

{render_steps(timeline, blocklist, tab_labels, tab_urls, frames)}

## Timeline (one clock, ms since t0)
{render_timeline(timeline, blocklist, tab_labels)}

## Narration (transcript)
```
{transcript.strip()}
```

## Network (HAR summary)
{network_summary or '- (none)'}

## Frames
Screenshots at key moments — open these from the pack's `frames/` directory.
Open **`frames-annotated.html`** to see each click/hover drawn on the page (a ring at
the click point + the element's box).
{frame_index or '- (none)'}

---
Raw structured files are in `bundle/` if you prefer them over this flattened view.
"""


def build_pack(bundle: Path, out: Path, blocklist: list[str] | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)

    # The neutral instructions and the flattened context — the two things every
    # agent reads.
    shutil.copyfile(BRIEF, out / "BRIEF.md")
    (out / "context.md").write_text(build_context(bundle, blocklist), encoding="utf-8")

    # Frames, for agents that can see images.
    frames_src = bundle / "frames"
    if frames_src.is_dir():
        shutil.copytree(frames_src, out / "frames", dirs_exist_ok=True)

    # The "draw on screen" view — markers on the clicked elements. Only written when
    # there's something to annotate.
    manifest = json.loads((bundle / "manifest.json").read_text()) if (bundle / "manifest.json").exists() else {}
    timeline = json.loads((bundle / "timeline.json").read_text()) if (bundle / "timeline.json").exists() else []
    annotated = build_annotated_frames_html(timeline, manifest.get("frames", []))
    if annotated:
        (out / "frames-annotated.html").write_text(annotated, encoding="utf-8")

    # The post-transfer step: bundle the skills the receiving agent uses — the
    # analyze-capture procedure always, plus activity skills (e.g. ui-improvement)
    # mapped to the recording's purpose. They travel WITH the pack so it's self-driving.
    bundled_skills = skills_for(manifest.get("purposes", []))
    for name in bundled_skills:
        shutil.copytree(SKILLS_DIR / name, out / "agent-skills" / name, dirs_exist_ok=True)

    # Raw structured files, for agents that prefer machine-readable input.
    raw = out / "bundle"
    raw.mkdir(exist_ok=True)
    for name in RAW_FILES:
        if (bundle / name).exists():
            shutil.copyfile(bundle / name, raw / name)

    (out / "README.md").write_text(
        f"""# Analysis pack — {bundle.name}

Hand this whole folder to any agent or LLM. There is no provider lock-in here, and
the pack carries its own instructions — it's self-driving.

- **Coding agent (Claude Code, etc.):** point it at this directory and tell it to
  **read `agent-skills/analyze-capture/SKILL.md` first** — that skill is the procedure
  (read the purpose → narration → identify → analyze under the lens → produce the
  outputs). It then reads `context.md` + `frames/`, follows any other skill in
  `agent-skills/` (e.g. `ui-improvement`), and writes its outputs here.
- **Any chat LLM:** paste `BRIEF.md` then `context.md`. Attach the `frames/`
  images if the model supports vision.
- **Your own harness:** see `../adapters/` for optional reference runners.

Self-contained: `agent-skills/` (how to use this pack + activity skills),
`context.md` (the flattened recording, with the purpose steer up top), `frames/` +
`frames-annotated.html` (screenshots), `bundle/` (raw structured files), `BRIEF.md`
(the neutral output spec).
""",
        encoding="utf-8",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Build an LLM-agnostic analysis pack from a Capture Bundle.")
    ap.add_argument("bundle", type=Path, help="path to a capture bundle directory")
    ap.add_argument("--out", type=Path, default=Path("./analysis-pack"), help="output pack directory")
    ap.add_argument("--no-net-filter", action="store_true",
                    help="render every network request verbatim (don't collapse analytics/tracking noise)")
    args = ap.parse_args()

    if not (args.bundle / "timeline.json").exists():
        sys.exit(f"error: no timeline.json in {args.bundle} — is that a capture bundle?")

    blocklist = [] if args.no_net_filter else load_blocklist()
    build_pack(args.bundle, args.out, blocklist)
    print(f"✓ analysis pack written to {args.out}")
    print(f"  hand it to any agent: it reads {args.out}/BRIEF.md + {args.out}/context.md + {args.out}/frames/")


if __name__ == "__main__":
    main()
