"""Tests for HARDENING Track D — AI-usability of the analysis pack (pack.py):

  D2 — one authoritative API-calls table (method+URL+status+req/resp bodies on one clock)
  D3 — de-duplicated Steps / Timeline / Narration (narration no longer 3×; bodies single-sourced)
  D4 — the raw rrweb DOM stream (events.jsonl) is demoted out of the pack
  D6 — partial-capture flags (storage_full / narration_truncated / video_ended_early) surfaced

Run from the project root:  python3 -m unittest discover -s tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import pack  # noqa: E402


def ev(t, kind, **kw):
    return {"t": t, "kind": kind, **kw}


def har(entries):
    return {"log": {"version": "1.2", "entries": entries}}


def entry(started, method, url, status, req_body=None, resp_body=None):
    e = {"startedDateTime": started, "request": {"method": method, "url": url},
         "response": {"status": status, "content": {}}}
    if req_body is not None:
        e["request"]["postData"] = {"mimeType": "application/json", "text": req_body}
    if resp_body is not None:
        e["response"]["content"]["text"] = resp_body
    return e


# ---- D2 — the authoritative API-calls table ------------------------------

class TestApiTable(unittest.TestCase):
    T0 = "2026-06-04T14:30:00.000Z"

    def test_full_row_with_t_method_url_status_bodies(self):
        h = har([entry("2026-06-04T14:30:05.200Z", "POST",
                       "https://acme.example.com/api/refund", 200,
                       req_body='{"amount":"full"}', resp_body='{"refund_id":"rf_9"}')])
        out = pack.render_api_table(h, t0_wall=self.T0)
        self.assertIn("| `t` | method | URL | status | request body | response body |", out)
        # t derived from startedDateTime - t0_wall = 5200ms.
        self.assertIn("`00:05.200`", out)
        self.assertIn("POST", out)
        self.assertIn("https://acme.example.com/api/refund", out)  # FULL url, not truncated
        self.assertIn("200", out)
        self.assertIn('{"amount":"full"}', out)        # request body present
        self.assertIn('{"refund_id":"rf_9"}', out)     # response body present

    def test_missing_bodies_render_em_dash(self):
        h = har([entry("2026-06-04T14:30:01.000Z", "GET", "https://x.com/api/orders", 200)])
        out = pack.render_api_table(h, t0_wall=self.T0)
        # request + response body cells both empty → em dash.
        self.assertEqual(out.count("—"), 2)

    def test_t_em_dash_when_unparseable(self):
        h = har([entry("not-a-date", "GET", "https://x.com/a", 200)])
        self.assertIn("| — |", pack.render_api_table(h, t0_wall=self.T0))
        # ...and when t0_wall itself is missing/unparseable.
        h2 = har([entry("2026-06-04T14:30:05.000Z", "GET", "https://x.com/a", 200)])
        self.assertIn("| — |", pack.render_api_table(h2, t0_wall="now"))

    def test_low_signal_collapsed(self):
        h = har([
            entry("2026-06-04T14:30:01.000Z", "GET", "https://api.acme.com/real", 200),
            entry("2026-06-04T14:30:02.000Z", "GET", "https://www.google-analytics.com/collect", 200),
        ])
        out = pack.render_api_table(h, blocklist=["google-analytics.com"], t0_wall=self.T0)
        self.assertIn("api.acme.com/real", out)
        self.assertNotIn("google-analytics.com/collect", out)  # the tracker URL is gone
        self.assertIn("1 low-signal request(s) collapsed", out)

    def test_empty_and_missing(self):
        self.assertEqual(pack.render_api_table(har([])), "- (none)")
        self.assertEqual(pack.render_api_table({}), "- (none)")

    def test_pipe_escaped_so_table_never_breaks(self):
        h = har([entry("2026-06-04T14:30:01.000Z", "POST", "https://x.com/a", 200,
                       req_body='a|b|c')])
        out = pack.render_api_table(h, t0_wall=self.T0)
        self.assertIn(r"a\|b\|c", out)

    def test_long_body_size_capped(self):
        big = "x" * 5000
        h = har([entry("2026-06-04T14:30:01.000Z", "POST", "https://x.com/a", 200, req_body=big)])
        out = pack.render_api_table(h, t0_wall=self.T0)
        self.assertNotIn("x" * 5000, out)
        self.assertIn("…", out)

    def test_never_crashes_on_malformed(self):
        # non-list entries, non-dict entry, non-dict request/response, non-string url.
        for bad in ({"log": {"entries": "nope"}},
                    {"log": {"entries": [None, 42, "x"]}},
                    {"log": {"entries": [{"request": "x", "response": 5}]}},
                    {"log": {"entries": [{"request": {"url": 123}}]}},
                    "not even a dict", None, [1, 2, 3]):
            pack.render_api_table(bad, blocklist=["ads"], t0_wall=self.T0)  # must not raise

    def test_parse_iso_ms(self):
        self.assertAlmostEqual(pack._parse_iso_ms("2026-06-04T14:30:00.000Z")
                               - pack._parse_iso_ms("2026-06-04T14:30:00.000Z"), 0)
        self.assertIsNone(pack._parse_iso_ms("garbage"))
        self.assertIsNone(pack._parse_iso_ms(None))
        self.assertIsNone(pack._parse_iso_ms(12345))


class TestApiTableInContext(unittest.TestCase):
    def _ctx(self, manifest, timeline, network=None):
        d = Path(tempfile.mkdtemp())
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps(timeline))
        if network is not None:
            (d / "network.har").write_text(json.dumps(network))
        return pack.build_context(d)

    def test_context_has_api_calls_not_old_network_section(self):
        m = {"capture_id": "c", "t0_wall": "2026-06-04T14:30:00.000Z", "duration_ms": 10,
             "sync_mode": "self_record"}
        net = har([entry("2026-06-04T14:30:02.000Z", "GET", "https://x.com/api/orders", 200)])
        ctx = self._ctx(m, [ev(0, "click", selector="#x")], net)
        self.assertIn("## API calls", ctx)
        self.assertNotIn("## Network (HAR summary)", ctx)
        self.assertIn("https://x.com/api/orders", ctx)


# ---- D3 — de-duplication --------------------------------------------------

class TestTimelineDedup(unittest.TestCase):
    def test_speech_dropped_from_timeline(self):
        out = pack.render_timeline([ev(0, "speech", text="hello there"),
                                    ev(10, "click", ctx={"name": "Save"})])
        self.assertNotIn("hello there", out)   # narration not repeated in the timeline
        self.assertNotIn("🗣", out)
        self.assertIn("Save", out)             # real actions stay

    def test_network_line_has_no_body(self):
        out = pack.render_timeline([ev(0, "network", method="POST", url="/api/x", status=200,
                                       ms=12, request_body={"a": 1})])
        self.assertIn("POST /api/x → 200 (12ms)", out)
        self.assertNotIn("body=", out)         # bodies live only in the API table now
        self.assertNotIn('{"a": 1}', out)

    def test_narration_present_in_steps_and_narration_not_timeline(self):
        d = Path(tempfile.mkdtemp())
        m = {"capture_id": "c", "t0_wall": "now", "duration_ms": 100, "sync_mode": "self_record"}
        (d / "manifest.json").write_text(json.dumps(m))
        (d / "timeline.json").write_text(json.dumps([
            ev(0, "nav", url="https://x.com"),
            ev(50, "click", ctx={"name": "Save"}),
        ]))
        (d / "transcript.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nI click save to finish.\n")
        ctx = pack.build_context(d)
        # narration shows in Steps (bound) and in the verbatim Narration section...
        self.assertIn("## Narration (transcript)", ctx)
        self.assertEqual(ctx.count("I click save to finish."), 2)  # Steps + Narration, NOT timeline
        # ...and the verbatim block sits after the timeline.
        self.assertLess(ctx.index("## Timeline"), ctx.index("## Narration"))


# ---- D4 — events.jsonl demoted out of the pack ---------------------------

class TestEventsJsonlDemoted(unittest.TestCase):
    def test_not_in_raw_files(self):
        self.assertNotIn("events.jsonl", pack.RAW_FILES)

    def test_build_pack_omits_events_jsonl(self):
        src = Path(tempfile.mkdtemp())
        m = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record"}
        (src / "manifest.json").write_text(json.dumps(m))
        (src / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        (src / "events.jsonl").write_text('{"type":3,"data":{}}\n')  # raw rrweb stream present
        out = Path(tempfile.mkdtemp()) / "pack"
        pack.build_pack(src, out, transcribe=False)
        self.assertFalse((out / "bundle" / "events.jsonl").exists())
        self.assertTrue((out / "bundle" / "timeline.json").exists())  # structured actions still ship
        # ...and the README explains the omission (not a silent drop).
        self.assertIn("events.jsonl", (out / "README.md").read_text())


# ---- D6 — partial-capture flags surfaced ---------------------------------

class TestPartialCaptureFlags(unittest.TestCase):
    def _ctx(self, **manifest_extra):
        d = Path(tempfile.mkdtemp())
        m = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record",
             **manifest_extra}
        (d / "manifest.json").write_text(json.dumps(m))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        return pack.build_context(d)

    def test_each_flag_surfaced(self):
        for flag in ("storage_full", "narration_truncated", "video_ended_early"):
            ctx = self._ctx(**{flag: True})
            self.assertIn("## ⚠ Capture issues", ctx)
            self.assertIn(flag, ctx)

    def test_no_issues_block_when_clean(self):
        ctx = self._ctx(storage_full=False, narration_truncated=False, video_ended_early=False)
        self.assertNotIn("## ⚠ Capture issues", ctx)

    def test_flags_appear_above_per_error_lines(self):
        d = Path(tempfile.mkdtemp())
        m = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record",
             "storage_full": True}
        (d / "manifest.json").write_text(json.dumps(m))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        (d / "errors.json").write_text(json.dumps([{"t": 5, "where": "worker", "message": "boom"}]))
        ctx = pack.build_context(d)
        self.assertIn("storage_full", ctx)
        self.assertIn("boom", ctx)
        self.assertLess(ctx.index("storage_full"), ctx.index("boom"))  # summary flag first


# ---- D5 — guarantee narration travels into the pack ----------------------

STUB_VTT = "WEBVTT\n\nNOTE No narration captured in this stream. Audio is in video.webm.\n"
REAL_VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHere is what I'm doing.\n"


class TestNarrationCarry(unittest.TestCase):
    def _bundle(self, vtt, *, narration_in_video=True, with_video=True, video="video.webm"):
        d = Path(tempfile.mkdtemp())
        m = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record",
             "narration_in_video": narration_in_video, "video": video}
        (d / "manifest.json").write_text(json.dumps(m))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        (d / "transcript.vtt").write_text(vtt)
        if with_video:
            (d / "video.webm").write_bytes(b"\x1aE\xdf\xa3fake-webm")  # stand-in audio source
        return d

    def _pack(self, bundle):
        out = Path(tempfile.mkdtemp()) / "pack"
        pack.build_pack(bundle, out, transcribe=False)  # no ASR engine path in tests
        return out

    def test_stub_transcript_carries_video_into_pack(self):
        out = self._pack(self._bundle(STUB_VTT))
        self.assertTrue((out / "bundle" / "video.webm").exists())  # audio preserved for recovery
        # README + context.md both point at the recovery path so it's not a silent inclusion.
        self.assertIn("video.webm", (out / "README.md").read_text())
        self.assertIn("Recover it with ffmpeg", (out / "context.md").read_text())

    def test_real_transcript_does_not_carry_video(self):
        out = self._pack(self._bundle(REAL_VTT))
        self.assertFalse((out / "bundle" / "video.webm").exists())  # words already in transcript.vtt
        self.assertNotIn("Recover it with ffmpeg", (out / "context.md").read_text())

    def test_no_carry_when_manifest_says_no_narration(self):
        out = self._pack(self._bundle(STUB_VTT, narration_in_video=False))
        self.assertFalse((out / "bundle" / "video.webm").exists())

    def test_no_crash_when_video_missing(self):
        out = self._pack(self._bundle(STUB_VTT, with_video=False))
        self.assertFalse((out / "bundle" / "video.webm").exists())  # nothing to carry, no error

    def test_hostile_video_path_is_basename_stripped(self):
        # A tampered manifest can't make us copy a file from outside the bundle.
        b = self._bundle(STUB_VTT, video="../../../etc/passwd")
        # the real audio still lives at bundle/video.webm; the basename of the hostile path
        # ("passwd") doesn't exist in the bundle, so nothing is copied — and nothing escapes.
        out = self._pack(b)
        self.assertFalse((out / "bundle" / "passwd").exists())
        self.assertFalse((out / "bundle" / "video.webm").exists())


if __name__ == "__main__":
    unittest.main()
