"""Tests for the network-noise collapse in pack.py.

Run from the project root:  python3 -m unittest discover -s tests
"""

import sys
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import pack  # noqa: E402

BL = ["google-analytics.com", "chartbeat.net", "imrworldwide.com", "facebook.com/tr"]


def net(t, url):
    return {"t": t, "kind": "network", "method": "GET", "url": url, "status": 200, "ms": 10}


class TestClassification(unittest.TestCase):
    def test_low_signal_host_match(self):
        self.assertTrue(pack.is_low_signal("https://chartbeat.net/ping?x=1", BL))
        self.assertTrue(pack.is_low_signal("https://pespn.chartbeat.net/ping", BL))  # subdomain
        self.assertTrue(pack.is_low_signal("https://www.google-analytics.com/collect", BL))

    def test_high_signal_not_matched(self):
        self.assertFalse(pack.is_low_signal("https://api.distru.com/v1/orders", BL))
        self.assertFalse(pack.is_low_signal("https://espn.api.edge.bamgrid.com/x", BL))

    def test_path_rule(self):
        # 'facebook.com/tr' must match the pixel path but not the main domain.
        self.assertTrue(pack.is_low_signal("https://www.facebook.com/tr?id=1", BL))
        self.assertFalse(pack.is_low_signal("https://www.facebook.com/groups/x", BL))

    def test_empty_blocklist_matches_nothing(self):
        self.assertFalse(pack.is_low_signal("https://chartbeat.net/x", []))

    def test_malformed_url(self):
        self.assertFalse(pack.is_low_signal("not a url", BL))


class TestTimelineCollapse(unittest.TestCase):
    def test_consecutive_run_collapses_to_one_line(self):
        events = [
            {"t": 0, "kind": "click", "label": "Start"},
            net(100, "https://chartbeat.net/a"),
            net(120, "https://imrworldwide.com/b"),
            net(140, "https://chartbeat.net/c"),
            {"t": 200, "kind": "nav", "url": "https://example.com"},
        ]
        out = pack.render_timeline(events, BL)
        lines = out.splitlines()
        collapsed = [l for l in lines if "low-signal" in l]
        self.assertEqual(len(collapsed), 1)
        self.assertIn("3 low-signal requests collapsed", collapsed[0])
        self.assertIn("chartbeat.net", collapsed[0])
        self.assertIn("imrworldwide.com", collapsed[0])
        # The real events survive.
        self.assertTrue(any("click Start" in l for l in lines))
        self.assertTrue(any("navigate" in l for l in lines))
        # The giant tracker URLs are gone from the rendered text.
        self.assertNotIn("chartbeat.net/a", out)

    def test_high_signal_network_preserved(self):
        events = [net(10, "https://api.distru.com/orders")]
        out = pack.render_timeline(events, BL)
        self.assertIn("api.distru.com/orders", out)
        self.assertNotIn("low-signal", out)

    def test_interleaving_breaks_runs(self):
        events = [
            net(10, "https://chartbeat.net/a"),
            {"t": 20, "kind": "click", "label": "X"},
            net(30, "https://chartbeat.net/b"),
        ]
        out = pack.render_timeline(events, BL)
        self.assertEqual(out.count("low-signal"), 2)  # two separate runs

    def test_disabled_when_no_blocklist(self):
        events = [net(10, "https://chartbeat.net/a")]
        out = pack.render_timeline(events, None)
        self.assertIn("chartbeat.net/a", out)
        self.assertNotIn("low-signal", out)

    def test_trailing_run_flushed(self):
        events = [{"t": 0, "kind": "click", "label": "X"}, net(10, "https://chartbeat.net/z")]
        out = pack.render_timeline(events, BL)
        self.assertIn("1 low-signal request collapsed", out)  # singular


class TestRealBundle(unittest.TestCase):
    def test_collapses_real_noisy_bundle(self):
        bundle = ANALYZE.parent / "outputs" / "4th-attempt-at-working-mic"
        if not (bundle / "timeline.json").exists():
            self.skipTest("real bundle not present")
        ctx = pack.build_context(bundle, pack.load_blocklist())
        self.assertIn("low-signal", ctx)
        self.assertNotIn("imrworldwide.com/cgi-bin", ctx)  # the giant tracker URL is gone


class TestDefaultBlocklistLoads(unittest.TestCase):
    def test_load(self):
        bl = pack.load_blocklist()
        self.assertTrue(bl)
        self.assertTrue(all(b == b.lower() for b in bl))


if __name__ == "__main__":
    unittest.main()
