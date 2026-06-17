"""Tests for the v2 intent features in pack.py: semantic action labels and the
step-segmented narrated procedure.

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


class TestActionLabel(unittest.TestCase):
    def test_role_name_section(self):
        e = ev(0, "click", ctx={"role": "button", "name": "Issue refund", "section": "Order actions"})
        self.assertEqual(pack.action_label(e), 'button "Issue refund" in "Order actions"')

    def test_name_only(self):
        self.assertEqual(pack.action_label(ev(0, "click", ctx={"name": "Save"})), '"Save"')

    def test_role_only(self):
        self.assertEqual(pack.action_label(ev(0, "click", ctx={"role": "link"})), "link")

    def test_legacy_label_fallback_unquoted(self):
        # No ctx → legacy phrasing (keeps v1 bundles rendering as before).
        self.assertEqual(pack.action_label(ev(0, "click", label="A", selector="#a")), "A")

    def test_selector_last_resort(self):
        self.assertEqual(pack.action_label(ev(0, "click", selector="div:nth-of-type(3)")), "div:nth-of-type(3)")

    def test_input_label(self):
        self.assertEqual(pack.input_label(ev(0, "input", ctx={"name": "Reason"})), '"Reason"')
        self.assertEqual(pack.input_label(ev(0, "input", selector="#r")), "#r")


class TestSegmentSteps(unittest.TestCase):
    def test_nav_starts_new_step(self):
        events = [ev(0, "click", selector="#a"), ev(100, "nav", url="https://x.com"), ev(200, "click", selector="#b")]
        steps = pack.segment_steps(events)
        self.assertEqual(len(steps), 2)
        self.assertEqual(steps[1]["events"][0]["kind"], "nav")

    def test_tab_switch_starts_new_step(self):
        events = [ev(0, "click", tab=1, selector="#a"), ev(100, "click", tab=2, selector="#b")]
        self.assertEqual(len(pack.segment_steps(events)), 2)

    def test_large_gap_starts_new_step(self):
        events = [ev(0, "click", selector="#a"), ev(5000, "click", selector="#b")]  # 5s gap
        self.assertEqual(len(pack.segment_steps(events, gap_ms=2500)), 2)

    def test_small_gap_stays_in_step(self):
        events = [ev(0, "click", selector="#a"), ev(500, "click", selector="#b")]
        self.assertEqual(len(pack.segment_steps(events)), 1)

    def test_narration_forward_binds_after_gap(self):
        # A long pause then narration then a click = a NEW step that opens with the
        # narration (the cue introduces the action that follows it).
        events = [ev(0, "click", selector="#a"), ev(9000, "speech", text="hi"), ev(9100, "click", selector="#b")]
        steps = pack.segment_steps(events)
        self.assertEqual(len(steps), 2)
        self.assertEqual(steps[1]["events"][0]["kind"], "speech")  # step 2 opens with the cue

    def test_speech_binds_to_following_tab(self):
        # Speech before a tab-2 click belongs with that click, not the prior tab-1 step.
        events = [
            ev(0, "click", tab=1, selector="#a"),
            ev(5000, "speech", text="now in tab two"),
            ev(5100, "click", tab=2, selector="#b"),
        ]
        steps = pack.segment_steps(events)
        self.assertEqual(len(steps), 2)
        kinds = [e["kind"] for e in steps[1]["events"]]
        self.assertEqual(kinds, ["speech", "click"])  # narration + its action together


class TestRenderSteps(unittest.TestCase):
    def test_narration_and_actions(self):
        events = [
            ev(0, "nav", url="https://app.distru.com/orders?x=1"),
            ev(100, "speech", text="I open the order and issue a refund."),
            ev(200, "click", ctx={"role": "button", "name": "Issue refund", "section": "Order actions"}),
            ev(300, "input", ctx={"name": "Reason"}, value="damaged"),
            ev(400, "network", method="POST", url="https://app.distru.com/api/refunds?t=1", status=201),
        ]
        out = pack.render_steps(events)
        self.assertIn("### Step 1", out)
        self.assertIn("https://app.distru.com/orders", out)  # query stripped
        self.assertNotIn("?x=1", out)
        self.assertIn('🗣 "I open the order and issue a refund."', out)
        self.assertIn('- click button "Issue refund" in "Order actions"', out)
        self.assertIn('- type into "Reason" = damaged', out)
        self.assertIn("- POST https://app.distru.com/api/refunds → 201", out)

    def test_hovers_omitted_low_signal_collapsed(self):
        events = [
            ev(0, "click", ctx={"name": "X"}),
            ev(50, "hover", ctx={"name": "tooltip"}),
            ev(100, "network", method="GET", url="https://chartbeat.net/ping", status=200),
        ]
        out = pack.render_steps(events, blocklist=["chartbeat.net"])
        self.assertNotIn("tooltip", out)  # hover dropped from the procedure
        self.assertIn("1 low-signal request", out)

    def test_multitab_step_headers(self):
        events = [ev(0, "click", tab=11, ctx={"name": "A"}), ev(100, "click", tab=22, ctx={"name": "B"})]
        out = pack.render_steps(events, tab_labels={11: "#1", 22: "#2"})
        self.assertIn("tab #1", out)
        self.assertIn("tab #2", out)


class TestBuildContextIntent(unittest.TestCase):
    def test_steps_section_and_ctx_timeline(self):
        d = Path(tempfile.mkdtemp())
        manifest = {"capture_id": "c", "t0_wall": "now", "duration_ms": 100, "sync_mode": "self_record"}
        timeline = [
            ev(0, "nav", url="https://x.com"),
            ev(50, "click", ctx={"role": "button", "name": "Save", "section": "Footer"}, selector="#s"),
        ]
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps(timeline))
        ctx = pack.build_context(d)
        self.assertIn("## Steps (narrated procedure)", ctx)
        self.assertIn('button "Save" in "Footer"', ctx)            # steps view
        self.assertIn('click button "Save" in "Footer"  [#s]', ctx)  # timeline view keeps selector

    def test_task_goal_rendered_at_top(self):
        d = Path(tempfile.mkdtemp())
        manifest = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record",
                    "task": "Issue a refund for a damaged order"}
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        ctx = pack.build_context(d)
        self.assertIn("**Task (stated by the user):** Issue a refund for a damaged order", ctx)
        # And it sits above the timeline.
        self.assertLess(ctx.index("Task (stated"), ctx.index("## Steps"))

    def test_no_task_block_when_absent(self):
        d = Path(tempfile.mkdtemp())
        manifest = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record"}
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        self.assertNotIn("Task (stated", pack.build_context(d))


class TestPurpose(unittest.TestCase):
    def test_render_purpose_lists_lens_and_output(self):
        out = pack.render_purpose(["skill", "ux"])
        self.assertIn("## Purpose of this recording", out)
        self.assertIn("Build a skill / automation", out)
        self.assertIn("SKILL.md", out)
        self.assertIn("UX / product feedback", out)
        self.assertIn("feedback.md", out)

    def test_render_purpose_empty_for_none(self):
        self.assertEqual(pack.render_purpose([]), "")
        self.assertEqual(pack.render_purpose(["bogus"]), "")  # unknown keys ignored

    def test_build_context_includes_purpose_above_steps(self):
        d = Path(tempfile.mkdtemp())
        manifest = {"capture_id": "c", "t0_wall": "now", "duration_ms": 10, "sync_mode": "self_record",
                    "task": "Refund a damaged order", "purposes": ["improve"]}
        (d / "manifest.json").write_text(json.dumps(manifest))
        (d / "timeline.json").write_text(json.dumps([ev(0, "click", selector="#x")]))
        ctx = pack.build_context(d)
        self.assertIn("Find a better / faster way", ctx)
        self.assertIn("improvements.md", ctx)
        self.assertLess(ctx.index("Purpose of this recording"), ctx.index("## Steps"))


class TestFrames(unittest.TestCase):
    FRAMES = [{"t": 100, "file": "frames/0000000100.png"}, {"t": 5000, "file": "frames/0000005000.png"}]

    def test_nearest_frame(self):
        self.assertEqual(pack.nearest_frame(120, self.FRAMES), "frames/0000000100.png")
        self.assertEqual(pack.nearest_frame(4800, self.FRAMES), "frames/0000005000.png")

    def test_nearest_frame_out_of_window(self):
        self.assertIsNone(pack.nearest_frame(3000, self.FRAMES, window_ms=500))

    def test_nearest_frame_empty(self):
        self.assertIsNone(pack.nearest_frame(100, []))

    def test_steps_link_click_to_frame(self):
        events = [ev(110, "click", ctx={"name": "Save"}, xpct=58, ypct=22)]
        out = pack.render_steps(events, frames=self.FRAMES)
        self.assertIn("→ frames/0000000100.png @(58%,22%)", out)

    def test_annotated_html_draws_marker(self):
        events = [ev(100, "click", ctx={"name": "Issue refund", "role": "button"},
                     xpct=58, ypct=22, rect={"x": 100, "y": 50, "w": 80, "h": 30},
                     viewport={"w": 1000, "h": 800})]
        html = pack.build_annotated_frames_html(events, self.FRAMES)
        self.assertIn('src="frames/0000000100.png"', html)
        self.assertIn('class="dot" style="left:58%;top:22%"', html)
        self.assertIn('class="box"', html)        # element bounding box drawn
        self.assertIn("Issue refund", html)
        self.assertIn("(button)", html)

    def test_annotated_html_empty_when_nothing_to_mark(self):
        # No coords → nothing to annotate.
        self.assertEqual(pack.build_annotated_frames_html([ev(0, "nav", url="x")], self.FRAMES), "")


if __name__ == "__main__":
    unittest.main()
