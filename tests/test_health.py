"""health.py — frame-index rebuild + manifest reconciliation (the self-validating step)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import health  # noqa: E402


def _bundle(tmp, manifest, frame_ts):
    """Write a throwaway bundle: manifest.json + frames/<padded t>.png for each t."""
    b = Path(tmp)
    (b / "frames").mkdir()
    for t in frame_ts:
        (b / "frames" / f"{str(t).zfill(10)}.png").write_bytes(b"\x89PNG\r\n")
    (b / "manifest.json").write_text(json.dumps(manifest))
    return b


class TestFramesFromDisk(unittest.TestCase):
    def test_parses_t_from_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, {}, [95, 3138, 6143])
            frames = health.frames_on_disk(b)
            self.assertEqual([f["t"] for f in frames], [95, 3138, 6143])
            self.assertEqual(frames[0]["file"], "frames/0000000095.png")

    def test_sorted_and_skips_non_integer_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, {}, [500, 100])
            (b / "frames" / "thumbnail.png").write_bytes(b"x")  # non-integer stem
            (b / "frames" / "notes.txt").write_bytes(b"x")      # non-png
            frames = health.frames_on_disk(b)
            self.assertEqual([f["t"] for f in frames], [100, 500])

    def test_no_frames_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(health.frames_on_disk(Path(tmp)), [])

    def test_canonical_falls_back_to_manifest_without_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = Path(tmp)
            man = {"frames": [{"t": 10, "file": "frames/0000000010.png"}]}
            self.assertEqual(health.canonical_frames(b, man), man["frames"])

    def test_canonical_prefers_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, {"frames": [{"t": 1, "file": "frames/0000000001.png"}]}, [10, 20])
            self.assertEqual([f["t"] for f in health.canonical_frames(b, {})], [10, 20])


class TestReconciliation(unittest.TestCase):
    def test_under_indexed_manifest_is_flagged(self):
        # The author's bug: disk has all frames, manifest indexes only the later ones.
        with tempfile.TemporaryDirectory() as tmp:
            disk = list(range(0, 30000, 3000))  # 10 frames on disk
            man = {"frames": [{"t": t, "file": f"frames/{str(t).zfill(10)}.png"}]
                   for t in disk[7:]}
            # build a real manifest with frames as a list
            man = {"frames": [{"t": t, "file": f"frames/{str(t).zfill(10)}.png"} for t in disk[7:]]}
            b = _bundle(tmp, man, disk)
            h = health.build_health(b)
            self.assertEqual(h["frames"]["on_disk"], 10)
            self.assertEqual(h["frames"]["in_manifest"], 3)
            self.assertEqual(h["frames"]["missing_from_manifest_count"], 7)
            self.assertTrue(any("under-indexed" in w for w in h["warnings"]))

    def test_clean_bundle_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            disk = [0, 3000, 6000]
            man = {"frames": [{"t": t, "file": f"frames/{str(t).zfill(10)}.png"} for t in disk]}
            b = _bundle(tmp, man, disk)
            h = health.build_health(b)
            self.assertTrue(h["ok"])
            self.assertEqual(h["warnings"], [])

    def test_missing_from_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            man = {"frames": [{"t": 0, "file": "frames/0000000000.png"},
                              {"t": 9999, "file": "frames/0000009999.png"}]}
            b = _bundle(tmp, man, [0])  # only frame 0 actually on disk
            h = health.build_health(b)
            self.assertEqual(h["frames"]["missing_from_disk"], ["frames/0000009999.png"])
            self.assertFalse(h["ok"])

    def test_frame_gap_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, {}, [0, 3000, 60000])  # 57s gap
            h = health.build_health(b)
            self.assertEqual(len(h["frame_gaps"]), 1)
            self.assertEqual(h["frame_gaps"][0]["gap_ms"], 57000)

    def test_partial_flags_surface(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, {"storage_full": True, "frames": []}, [0])
            h = health.build_health(b)
            self.assertTrue(h["partial_flags"]["storage_full"])
            self.assertFalse(h["ok"])
            self.assertTrue(any("storage_full" in w for w in h["warnings"]))

    def test_never_crashes_on_garbage_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = Path(tmp)
            (b / "frames").mkdir()
            (b / "manifest.json").write_text("not json {{{")
            h = health.build_health(b)  # must not raise
            self.assertIn("frames", h)

    def test_video_segments_warning_when_multiple_segments(self):
        # A recovered re-share: video.webm is stitched from 3 segments. The
        # take is NOT flagged video_ended_early (it was recovered), but the
        # gaps must be surfaced as a warning so a reader knows where video is
        # missing.
        with tempfile.TemporaryDirectory() as tmp:
            man = {"frames": [], "video_segments": [
                {"offset_ms": 0},
                {"offset_ms": 12000},
                {"offset_ms": 45000},
            ]}
            b = _bundle(tmp, man, [0])
            h = health.build_health(b)
            self.assertTrue(any("video_segments" in w and "3 segments" in w for w in h["warnings"]))
            # ok stays true: a recovered re-share is informational, not a hard
            # partial flag (the take didn't end early).
            self.assertTrue(h["ok"])

    def test_single_video_segment_no_warning(self):
        # A normal single-segment recording (or one that lists a single segment)
        # must NOT emit the video_segments warning.
        with tempfile.TemporaryDirectory() as tmp:
            man = {"frames": [], "video_segments": [{"offset_ms": 0}]}
            b = _bundle(tmp, man, [0])
            h = health.build_health(b)
            self.assertFalse(any("video_segments" in w for w in h["warnings"]))


if __name__ == "__main__":
    unittest.main()
