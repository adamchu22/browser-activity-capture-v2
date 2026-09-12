"""friction.py — computed UX signals (long pauses, rage clicks, retries, errors)."""
import sys
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import friction  # noqa: E402


def click(t, selector=None, label=None):
    e = {"kind": "click", "t": t}
    if selector:
        e["selector"] = selector
    if label:
        e["ctx"] = {"label": label}
    return e


class TestLongPauses(unittest.TestCase):
    def test_gap_over_threshold(self):
        tl = [click(0, "#a"), click(40000, "#b")]  # 40s gap
        f = friction.compute_friction(tl)
        self.assertEqual(f["summary"]["long_pauses"], 1)
        self.assertEqual(f["long_pauses"][0]["gap_ms"], 40000)

    def test_short_gaps_ignored(self):
        tl = [click(0, "#a"), click(5000, "#b"), click(9000, "#c")]
        self.assertEqual(friction.compute_friction(tl)["summary"]["long_pauses"], 0)


class TestRageClicks(unittest.TestCase):
    def test_three_clicks_same_target_in_window(self):
        tl = [click(0, "#load"), click(800, "#load"), click(1500, "#load")]
        f = friction.compute_friction(tl)
        self.assertEqual(f["summary"]["repeat_clicks"], 1)
        self.assertEqual(f["repeat_clicks"][0]["count"], 3)

    def test_spread_out_clicks_are_not_rage(self):
        tl = [click(0, "#load"), click(5000, "#load"), click(10000, "#load")]
        # outside the 3s window → not a rage burst (but IS a retried action)
        f = friction.compute_friction(tl)
        self.assertEqual(f["summary"]["repeat_clicks"], 0)
        self.assertEqual(f["summary"]["retried_actions"], 1)

    def test_different_targets_not_rage(self):
        tl = [click(0, "#a"), click(500, "#b"), click(900, "#c")]
        self.assertEqual(friction.compute_friction(tl)["summary"]["repeat_clicks"], 0)


class TestRetries(unittest.TestCase):
    def test_label_used_when_no_selector(self):
        tl = [click(0, label="Load menus"), click(9000, label="Load menus"),
              click(20000, label="Load menus")]
        f = friction.compute_friction(tl)
        self.assertEqual(f["summary"]["retried_actions"], 1)
        self.assertEqual(f["retried_actions"][0]["label"], "Load menus")
        self.assertEqual(f["retried_actions"][0]["count"], 3)


class TestErrorEvents(unittest.TestCase):
    def test_error_label_in_ui(self):
        tl = [click(1000, label="⚠ Couldn't load categories")]
        f = friction.compute_friction(tl)
        self.assertEqual(f["summary"]["error_events"], 1)
        self.assertEqual(f["error_events"][0]["source"], "ui")

    def test_non_2xx_response_from_api(self):
        api = [{"_t": 5000, "request": {"method": "POST", "url": "https://x/api/apply"},
                "response": {"status": 500}}]
        f = friction.compute_friction([], api)
        self.assertEqual(f["summary"]["error_events"], 1)
        self.assertEqual(f["error_events"][0]["source"], "network")
        self.assertIn("500", f["error_events"][0]["label"])

    def test_negated_success_not_flagged(self):
        # "No failed pushes" is good news, not friction.
        tl = [click(1000, label="✓ All clear — no failed pushes")]
        self.assertEqual(friction.compute_friction(tl)["summary"]["error_events"], 0)

    def test_2xx_not_flagged(self):
        api = [{"_t": 1, "request": {"method": "GET", "url": "x"}, "response": {"status": 200}}]
        self.assertEqual(friction.compute_friction([], api)["summary"]["error_events"], 0)


class TestRobustness(unittest.TestCase):
    def test_handles_malformed_events(self):
        tl = [None, {"kind": "click"}, {"kind": "click", "t": "bad"}, 42]
        friction.compute_friction(tl)  # must not raise

    def test_empty(self):
        f = friction.compute_friction([])
        self.assertTrue(all(value == 0 for value in f["summary"].values()))
        self.assertEqual(f["schema_version"], 2)
        self.assertIn("dead_clicks", f)
        self.assertIn("focus_returns", f)


if __name__ == "__main__":
    unittest.main()
