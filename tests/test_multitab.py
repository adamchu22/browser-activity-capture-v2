"""Tests for v2 multi-tab rendering in pack.py (tab-switch markers + legend).

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


def ev(t, kind, tab=None, **kw):
    e = {"t": t, "kind": kind, **kw}
    if tab is not None:
        e["tab"] = tab
    return e


class TestTabSwitchMarkers(unittest.TestCase):
    def setUp(self):
        self.labels = {11: "#1", 22: "#2"}

    def test_marker_on_tab_change(self):
        events = [
            ev(0, "click", tab=11, selector="#a", label="A"),
            ev(10, "click", tab=11, selector="#b", label="B"),
            ev(20, "click", tab=22, selector="#c", label="C"),
            ev(30, "click", tab=11, selector="#d", label="D"),
        ]
        out = pack.render_timeline(events, [], self.labels)
        markers = [l for l in out.splitlines() if "━━━ tab" in l]
        # #1 (initial), switch to #2, switch back to #1 = 3 markers.
        self.assertEqual(len(markers), 3)
        self.assertIn("tab #1", markers[0])
        self.assertIn("tab #2", markers[1])
        self.assertIn("tab #1", markers[2])

    def test_no_marker_when_single_tab(self):
        events = [ev(0, "click", tab=11, selector="#a"), ev(10, "click", tab=11, selector="#b")]
        out = pack.render_timeline(events, [], {11: "#1"})  # only one tab
        self.assertNotIn("━━━ tab", out)

    def test_no_markers_without_labels(self):
        events = [ev(0, "click", tab=11, selector="#a"), ev(10, "click", tab=22, selector="#b")]
        out = pack.render_timeline(events, [], None)
        self.assertNotIn("━━━ tab", out)

    def test_events_without_tab_dont_switch(self):
        # A speech cue (no tab) between two same-tab clicks must not emit a marker.
        events = [
            ev(0, "click", tab=11, selector="#a"),
            ev(5, "speech", text="hello"),
            ev(10, "click", tab=11, selector="#b"),
        ]
        out = pack.render_timeline(events, [], self.labels)
        self.assertEqual(out.count("━━━ tab"), 1)  # only the initial #1


class TestBuildContextV2(unittest.TestCase):
    def _bundle(self, manifest, timeline):
        d = Path(tempfile.mkdtemp())
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps(timeline))
        return d

    def test_tabs_section_and_markers(self):
        manifest = {
            "capture_id": "cap-1", "t0_wall": "now", "duration_ms": 100, "sync_mode": "self_record",
            "capture_scope": "all_tabs",
            "tabs": [
                {"id": 11, "url": "https://distru.com/orders", "title": "Orders"},
                {"id": 22, "url": "https://metrc.com/transfers", "title": "Transfers"},
            ],
        }
        timeline = [
            ev(0, "click", tab=11, selector="#a", label="A"),
            ev(20, "click", tab=22, selector="#b", label="B"),
        ]
        ctx = pack.build_context(self._bundle(manifest, timeline))
        self.assertIn("## Tabs (recorded in parallel)", ctx)
        self.assertIn("**#1** https://distru.com/orders — Orders", ctx)
        self.assertIn("**#2** https://metrc.com/transfers — Transfers", ctx)
        self.assertIn("━━━ tab #1", ctx)
        self.assertIn("━━━ tab #2", ctx)

    def test_v1_bundle_unaffected(self):
        # No tabs legend, events have no `tab` — render exactly as before.
        manifest = {"capture_id": "cap-0", "t0_wall": "now", "duration_ms": 50, "sync_mode": "self_record"}
        timeline = [ev(0, "click", selector="#a", label="A"), ev(10, "nav", url="https://x.com")]
        ctx = pack.build_context(self._bundle(manifest, timeline))
        self.assertNotIn("## Tabs", ctx)
        self.assertNotIn("━━━ tab", ctx)
        self.assertIn("click A", ctx)


if __name__ == "__main__":
    unittest.main()
