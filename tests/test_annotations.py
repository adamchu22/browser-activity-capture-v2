"""Tests for P4: pack.py rendering of the P2 annotation events
(annotation:select / annotation:draw) — timeline, steps, the dedicated
Annotations section, and the frames-annotated.html marks.

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


SELECT = ev(
    1000, "annotation:select",
    selector="#refund", label="Issue refund",
    ctx={"role": "button", "name": "Issue refund", "section": "Order actions"},
    xpct=40, ypct=22, viewport={"w": 1000, "h": 500},
    rect={"x": 300, "y": 80, "w": 120, "h": 36},
)
DRAW = ev(
    2000, "annotation:draw",
    points=[{"xpct": 10, "ypct": 20}, {"xpct": 30, "ypct": 25}, {"xpct": 50, "ypct": 60}],
    bbox={"xpct": 10, "ypct": 20, "wpct": 40, "hpct": 40},
    viewport={"w": 1000, "h": 500},
)


class TestDrawRegion(unittest.TestCase):
    def test_bbox_summary(self):
        self.assertEqual(pack._draw_region(DRAW), "@(10%,20%) 40×40%")

    def test_no_bbox(self):
        self.assertEqual(pack._draw_region(ev(0, "annotation:draw")), "")
        self.assertEqual(pack._draw_region(ev(0, "annotation:draw", bbox={})), "")


class TestTimeline(unittest.TestCase):
    def test_select_renders_semantic(self):
        out = pack.render_timeline([SELECT])
        self.assertIn("✦ marked", out)
        self.assertIn('button "Issue refund" in "Order actions"', out)
        self.assertIn("[#refund]", out)
        self.assertIn("@(40%,22%)", out)

    def test_draw_renders_region(self):
        out = pack.render_timeline([DRAW])
        self.assertIn("✦ drew on screen", out)
        self.assertIn("@(10%,20%) 40×40%", out)

    def test_not_raw_json(self):
        # The old else-branch dumped unknown kinds as raw JSON — make sure we don't.
        out = pack.render_timeline([SELECT, DRAW])
        self.assertNotIn('"kind"', out)


class TestSteps(unittest.TestCase):
    def test_annotations_appear_in_procedure(self):
        out = pack.render_steps([SELECT, DRAW])
        self.assertIn("✦ marked", out)
        self.assertIn('button "Issue refund"', out)
        self.assertIn("✦ drew on screen", out)
        self.assertIn("@(10%,20%)", out)


class TestAnnotatedFramesHtml(unittest.TestCase):
    FRAMES = [{"t": 1000, "file": "frames/sel.png"}, {"t": 2000, "file": "frames/draw.png"}]

    def test_select_card_is_blue_and_boxed(self):
        html = pack.build_annotated_frames_html([SELECT], self.FRAMES)
        self.assertIn("✦ marked", html)
        self.assertIn("box sel", html)   # blue element box
        self.assertIn("dot sel", html)   # blue ring
        self.assertIn("frames/sel.png", html)

    def test_draw_card_traces_a_polyline(self):
        html = pack.build_annotated_frames_html([DRAW], self.FRAMES)
        self.assertIn("<svg", html)
        self.assertIn("<polyline", html)
        self.assertIn("10,20 30,25 50,60", html)   # the %-coord points
        self.assertIn("#0a84ff", html)             # the Select/Draw blue
        self.assertIn("frames/draw.png", html)

    def test_draw_with_one_point_is_skipped(self):
        one = ev(2000, "annotation:draw", points=[{"xpct": 10, "ypct": 20}])
        self.assertEqual(pack.build_annotated_frames_html([one], self.FRAMES), "")

    def test_no_frame_match_no_card(self):
        # Annotation far from any frame (>2s window) → nothing to draw.
        far = [{"t": 99999, "file": "frames/x.png"}]
        self.assertEqual(pack.build_annotated_frames_html([SELECT, DRAW], far), "")

    def test_click_still_red(self):
        # Regression: a normal click keeps the plain (red) box/dot, no 'sel' class.
        click = ev(1000, "click", selector="#a", ctx={"name": "A"}, xpct=5, ypct=5,
                   viewport={"w": 100, "h": 100}, rect={"x": 0, "y": 0, "w": 10, "h": 10})
        html = pack.build_annotated_frames_html([click], self.FRAMES)
        self.assertIn('class="box"', html)
        self.assertNotIn("box sel", html)


class TestContextSection(unittest.TestCase):
    def _bundle(self, tmp):
        b = Path(tmp)
        manifest = {
            "capture_id": "cap-1",
            "frames": [{"t": 1000, "file": "frames/sel.png"}, {"t": 2000, "file": "frames/draw.png"}],
        }
        (b / "manifest.json").write_text(json.dumps(manifest))
        (b / "timeline.json").write_text(json.dumps([SELECT, DRAW]))
        return b

    def test_annotations_section_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = pack.build_context(self._bundle(tmp))
        self.assertIn("## ✦ Annotations", ctx)
        self.assertIn("selected button \"Issue refund\"", ctx)
        self.assertIn("[#refund]", ctx)
        self.assertIn("drew on screen · @(10%,20%) 40×40%", ctx)
        self.assertIn("frames/sel.png", ctx)

    def test_no_annotations_no_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = Path(tmp)
            (b / "manifest.json").write_text(json.dumps({"capture_id": "c"}))
            (b / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#a")]))
            ctx = pack.build_context(b)
        self.assertNotIn("## ✦ Annotations", ctx)


if __name__ == "__main__":
    unittest.main()
