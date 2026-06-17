# Sample Capture Bundle — `capture-2026-06-04-1430`

A hand-crafted example of what the Chrome extension will emit. It exists so the
**compiler** has a realistic, stable input to develop against before any capture
code is written. The workflow recorded here: *issuing a full refund for a damaged
item in an internal admin dashboard.*

## Contents

| File | What it is |
|---|---|
| `manifest.json` | Session metadata: `t0`, duration, sync mode, URLs, redaction policy, tool versions, frame index. |
| `timeline.json` | ⭐ The merged, pre-aligned stream — every modality (`nav`, `speech`, `click`, `input`, `key`, `network`) on one `t` (ms since `t0`). This is what the compiler reads. |
| `events.jsonl` | Raw rrweb-style event log (one per line), replayable. |
| `network.har` | Standard HAR. Auth headers, cookies, and secret values redacted **before** write. |
| `transcript.vtt` | WebVTT narration cues, ms-aligned to `t0`. |
| `frames/*.png` | Screenshots at key moments. Filename = ms offset. (Placeholder solid-color images in this sample.) |

## Notes

- **Redaction is already applied.** Password fields and `Authorization` headers
  show `‹redacted›` — the raw values never leave the browser.
- **One clock.** Because every modality is stamped against the same `t0`, the
  compiler never has to guess which click caused which request.
- Regenerate the placeholder frames with `python3 ../tools/genframes.py` (the
  generator used to create them is reproduced under `tools/` for reference).
