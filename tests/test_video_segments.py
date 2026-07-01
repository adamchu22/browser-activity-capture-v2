"""Tests for the re-share video_segments rendering in pack.py.

When the user clicks "Stop sharing" mid-recording and then re-shares, video.webm
is stitched from multiple segments with gaps between them. The manifest carries
`video_segments: [{offset_ms}]` and pack.py renders a block in `## ⚠ Capture
issues` so the analyzing AI knows which event ranges have no corresponding video.

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


def bundle(manifest):
    d = Path(tempfile.mkdtemp())
    (d / "manifest.json").write_text(json.dumps(manifest))
    (d / "timeline.json").write_text("[]")
    (d / "errors.json").write_text("[]")
    return d


def base_manifest(**over):
    m = {
        "capture_id": "cap-1",
        "t0_wall": "now",
        "duration_ms": 60000,
        "sync_mode": "self_record",
        "capture_scope": "all_tabs",
        "tabs": [],
        "video": "video.webm",
        "video_segments": [],
    }
    m.update(over)
    return m


class TestVideoSegmentsRendering(unittest.TestCase):
    def test_no_segments_no_block(self):
        # A normal single-take recording: video_segments is empty/absent.
        ctx = pack.build_context(bundle(base_manifest()))
        self.assertNotIn("video segments", ctx)

    def test_single_segment_no_block(self):
        # One segment is the normal case even if the field is present — no gap
        # to warn about, so no block.
        ctx = pack.build_context(bundle(base_manifest(video_segments=[{"offset_ms": 0}])))
        self.assertNotIn("video segments", ctx)

    def test_multiple_segments_render_gaps(self):
        # Two re-shares → three segments with two gaps. The block must list
        # each segment with its offset and flag the gaps.
        m = base_manifest(video_segments=[
            {"offset_ms": 0},
            {"offset_ms": 12000},
            {"offset_ms": 45000},
        ])
        ctx = pack.build_context(bundle(m))
        self.assertIn("## ⚠ Capture issues", ctx)
        self.assertIn("video segments", ctx)
        self.assertIn("3 segments", ctx)
        # Each segment's offset should be referenced.
        self.assertIn("segment 1 starts at", ctx)
        self.assertIn("segment 2 starts at", ctx)
        self.assertIn("segment 3 starts at", ctx)
        # The gap between segment 1 (0ms) and 2 (12000ms) is ~12s.
        self.assertIn("12s after the previous segment", ctx)
        # The gap between segment 2 (12000ms) and 3 (45000ms) is ~33s.
        self.assertIn("33s after the previous segment", ctx)

    def test_segments_tolerate_non_dict_entries(self):
        # A malformed segment (non-dict) must not crash the renderer.
        m = base_manifest(video_segments=[{"offset_ms": 0}, "junk", {"offset_ms": 20000}])
        ctx = pack.build_context(bundle(m))
        self.assertIn("video segments", ctx)

    def test_segments_tolerate_missing_offset(self):
        # A segment dict missing offset_ms should default to 0, not crash.
        m = base_manifest(video_segments=[{"offset_ms": 0}, {}])
        ctx = pack.build_context(bundle(m))
        self.assertIn("video segments", ctx)

    def test_segments_tolerate_non_list_value(self):
        # A non-list video_segments should be treated as empty (no block).
        m = base_manifest(video_segments="not a list")
        ctx = pack.build_context(bundle(m))
        self.assertNotIn("video segments", ctx)


if __name__ == "__main__":
    unittest.main()