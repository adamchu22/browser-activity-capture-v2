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
RAW_FILES = ["manifest.json", "timeline.json", "transcript.vtt", "network.har", "events.jsonl", "errors.json"]

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


def render_steps(events: list[dict], blocklist: list[str] | None = None,
                 tab_labels: dict | None = None, tab_urls: dict | None = None) -> str:
    """A draft narrated procedure: each step's narration (the intent) above the
    actions that carried it out. Hovers and low-signal network are dropped here to
    keep it SOP-shaped — the full detail stays in the raw timeline below."""
    blocklist = blocklist or []
    tab_labels = tab_labels or {}
    tab_urls = tab_urls or {}
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
                out.append(f"- click {action_label(e)}")
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

    return f"""# Analysis context — {manifest.get('capture_id', bundle.name)}

Captured {manifest.get('t0_wall','?')} · duration {manifest.get('duration_ms','?')} ms ·
sync mode `{manifest.get('sync_mode','?')}`. Secrets redacted as `‹redacted›`.
{issues_block}{tabs_block}
## URLs visited
{urls_block}

## Steps (narrated procedure)
_Auto-segmented from the recording; the user's narration is the intent, the bullets
are what they did. See the raw timeline below for full detail (hovers, every request)._

{render_steps(timeline, blocklist, tab_labels, tab_urls)}

## Timeline (one clock, ms since t0)
{render_timeline(timeline, blocklist, tab_labels)}

## Narration (transcript)
```
{transcript.strip()}
```

## Network (HAR summary)
{network_summary or '- (none)'}

## Frames
Screenshots at key moments — open these from the pack's `frames/` directory:
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

    # Raw structured files, for agents that prefer machine-readable input.
    raw = out / "bundle"
    raw.mkdir(exist_ok=True)
    for name in RAW_FILES:
        if (bundle / name).exists():
            shutil.copyfile(bundle / name, raw / name)

    (out / "README.md").write_text(
        f"""# Analysis pack — {bundle.name}

Hand this whole folder to any agent or LLM. There is no provider lock-in here.

- **Coding agent (Claude Code, etc.):** point it at this directory and tell it to
  follow `BRIEF.md`. It will read `context.md` + `frames/` and write `SOP.md`,
  `skills/<name>/SKILL.md`, `automation.suggestions.md`, and `notes.md` here.
- **Any chat LLM:** paste `BRIEF.md` then `context.md`. Attach the `frames/`
  images if the model supports vision.
- **Your own harness:** see `../adapters/` for optional reference runners.

Everything the agent needs is self-contained: `BRIEF.md` (the task),
`context.md` (the flattened recording), `frames/` (screenshots), `bundle/` (raw
structured files).
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
