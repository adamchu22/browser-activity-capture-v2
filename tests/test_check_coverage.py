"""Tests for the capture-coverage checker (analyze/check_coverage.py).

Locks the detector for the "content script died mid-session, only network kept
recording" bug — the failure mode that lost ~4.5 min of a 6 min server-rendered
session.
"""

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analyze"))
from check_coverage import analyze_coverage  # noqa: E402


def tl(*events):
    return [{"t": t, "kind": k, "tab": tab} for (t, k, tab) in events]


class TestCoverage(unittest.TestCase):
    def test_healthy_session_passes(self):
        # Content + network both run the full session on the same tab.
        events = tl(
            (0, "nav", 1), (1000, "click", 1), (1500, "network", 1),
            (60000, "click", 1), (61000, "network", 1),
            (120000, "click", 1), (121000, "network", 1),
        )
        r = analyze_coverage(events)
        self.assertTrue(r["ok"], r["failures"])
        self.assertEqual(r["failures"], [])

    def test_content_dies_network_continues_fails(self):
        # The bug: clicks stop early; network keeps going for minutes.
        events = tl(
            (0, "nav", 1), (1000, "click", 1), (2000, "click", 1), (3000, "click", 1),
        ) + [{"t": t, "kind": "network", "tab": 1} for t in range(4000, 300000, 1000)]
        r = analyze_coverage(events)
        self.assertFalse(r["ok"])
        self.assertTrue(any("tab 1" in f and "stopped" in f for f in r["failures"]))

    def test_clean_end_no_trailing_network_passes(self):
        # Both content and network stop together (user finished) — not a gap.
        events = tl(
            (0, "nav", 1), (1000, "click", 1), (2000, "click", 1), (3000, "click", 1),
            (3500, "network", 1),
        )
        r = analyze_coverage(events)
        self.assertTrue(r["ok"], r["failures"])

    def test_untouched_tab_not_flagged(self):
        # A tab the user merely had open (1 nav, then background network) is not
        # "capture died" — it was never actively captured.
        events = tl((0, "nav", 2)) + [
            {"t": t, "kind": "network", "tab": 2} for t in range(1000, 200000, 1000)
        ]
        r = analyze_coverage(events)
        self.assertTrue(r["ok"], r["failures"])

    def test_small_gap_under_threshold_passes(self):
        # A short trailing network burst (e.g. a final XHR after the last click)
        # is normal, not a coverage failure.
        events = tl(
            (0, "nav", 1), (1000, "click", 1), (2000, "click", 1), (3000, "click", 1),
            (20000, "network", 1),  # 17s after last click — under the 45s threshold
        )
        r = analyze_coverage(events)
        self.assertTrue(r["ok"], r["failures"])

    def test_per_tab_isolation(self):
        # One healthy tab + one broken tab → fails, and names the broken tab only.
        good = tl((0, "click", 1), (1000, "click", 1), (2000, "click", 1), (2000, "network", 1))
        bad = tl((0, "click", 9), (1000, "click", 9), (2000, "click", 9)) + [
            {"t": t, "kind": "network", "tab": 9} for t in range(3000, 200000, 1000)
        ]
        r = analyze_coverage(good + bad)
        self.assertFalse(r["ok"])
        self.assertEqual(len(r["failures"]), 1)
        self.assertIn("tab 9", r["failures"][0])

    def test_frame_gap_warns_but_does_not_fail(self):
        events = tl((0, "click", 1), (1000, "network", 1))
        frames = [{"t": 0}, {"t": 2000}, {"t": 200000}]  # huge gap
        r = analyze_coverage(events, frames=frames, duration_ms=200000)
        self.assertTrue(r["ok"])  # frame gaps are warnings, not failures
        self.assertTrue(r["warnings"])

    def test_regular_frames_no_warning(self):
        events = tl((0, "click", 1), (1000, "network", 1))
        frames = [{"t": t} for t in range(0, 60000, 3000)]  # every 3s
        r = analyze_coverage(events, frames=frames, duration_ms=60000)
        self.assertEqual(r["warnings"], [])


if __name__ == "__main__":
    unittest.main()
