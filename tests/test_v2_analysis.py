import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analyze"))
import friction
import insights
import pack
import todos
import transcribe
import validate_bundle as vb


class V2Analysis(unittest.TestCase):
    def test_segment_offsets_preserve_gap_and_hours(self):
        cues = transcribe.offset_cues(
            "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n", 3_600_000)
        self.assertEqual(cues, [(3601.0, 3602.0, "hello")])

    def test_har_recording_clock_wins_over_wall_time(self):
        h = {"log": {"entries": [{
            "_t": 1000, "startedDateTime": "2026-01-01T00:01:00Z",
            "request": {"url": "/api/save", "method": "POST"}, "response": {"status": 200},
        }]}}
        self.assertEqual(pack.api_entries(h, "2026-01-01T00:00:00Z")[0]["_t"], 1000)
        self.assertIn("00:01.000", pack.render_api_table(h, t0_wall="2026-01-01T00:00:00Z"))

    def test_background_network_does_not_switch_tab(self):
        events = [
            {"t": 0, "kind": "click", "tab": 1},
            {"t": 10, "kind": "network", "tab": 2},
            {"t": 20, "kind": "click", "tab": 1},
        ]
        self.assertEqual(pack.render_timeline(events, tab_labels={1: "#1", 2: "#2"}).count("━━━ tab"), 1)
        self.assertEqual(len(pack.segment_steps(events)), 1)

    def test_intent_categories_and_honest_evidence(self):
        for text, category in [
            ("this should show the total", "feature-request"),
            ("it keeps resetting, frustrating", "ui-improvement"),
            ("here is how, first you open settings", "how-to"),
            ("let me open settings", "self-instruction"),
        ]:
            self.assertEqual(todos.classify(text), category)
        evidence = todos.extract_todos(
            [{"t": 100, "text": "can we change this"}],
            [{"t": 90, "kind": "click", "selector": "#save"}],
            [{"t": 100000, "file": "frames/far.png"}])[0]["evidence"]
        self.assertEqual(evidence["causality"], "unconfirmed")
        self.assertEqual(evidence["action_delta_ms"], -10)
        self.assertNotIn("frame", evidence)

    def test_friction_detectors(self):
        tl = [
            {"t": 0, "kind": "nav", "url": "/x"},
            {"t": 100, "kind": "nav", "url": "/y"},
            {"t": 200, "kind": "nav", "url": "/x"},
            {"t": 300, "kind": "input", "selector": "#q", "value": "a"},
            {"t": 400, "kind": "input", "selector": "#q", "value": ""},
            {"t": 500, "kind": "input", "selector": "#q", "value": "b"},
            {"t": 600, "kind": "focus", "focused": False},
            {"t": 700, "kind": "focus", "focused": True},
            *[{"t": 800 + i * 100, "kind": "scroll", "y": y}
              for i, y in enumerate([0, 100, 0, 100])],
            {"t": 2000, "kind": "click", "selector": "#dead"},
            {"t": 6000, "kind": "key", "key": "Tab"},
        ]
        result = friction.compute_friction(tl)
        for key in ("bounce_backs", "input_churn", "scroll_hunting", "focus_returns", "dead_clicks"):
            self.assertEqual(len(result[key]), 1, key)

    def test_validator_rejects_falsy_and_nonfinite_timelines(self):
        for value in [[], {}, None, False, [{"t": float("nan"), "kind": "click"}],
                      [{"t": float("inf"), "kind": "click"}], [{"t": -1, "kind": "click"}]]:
            report = vb.Report()
            vb.check_timeline(value, report)
            self.assertTrue(report.errors)

    def test_parsed_header_validation_handles_order_and_escapes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "manifest.json").write_text(json.dumps({
                "t0_wall": "x", "duration_ms": 1, "sync_mode": "self_record",
            }))
            (root / "timeline.json").write_text('[{"t":0,"kind":"click"}]')
            (root / "network.har").write_text(
                r'{"log":{"entries":[{"request":{"headers":[{"value":"secret","name":"Authoriz\u0061tion"}]}}]}}')
            with redirect_stdout(io.StringIO()):
                self.assertEqual(vb.validate(root), 1)

    def test_moments_select_one_frame_and_summarize_rest(self):
        events = [{"t": 100, "kind": "click", "selector": "#save"}]
        frames = [{"t": t, "file": f"frames/{t}.png"} for t in [0, 100, 200, 300]]
        moments = insights.build_moments(pack.segment_steps(events), frames, [])
        self.assertEqual(moments[0]["frame"], "frames/100.png")
        self.assertEqual(moments[0]["other_frames"]["count"], 2)

    def test_spoken_stub_phrase_is_not_placeholder(self):
        self.assertFalse(pack._transcript_is_stub(
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNo narration captured is the error I see.\n"))


if __name__ == "__main__":
    unittest.main()
