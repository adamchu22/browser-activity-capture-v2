"""Track C3 — nearest_frame is O(log n) (cached sorted index + bisect) and robust.

Verifies the rewrite still picks the correct frame, handles unsorted/malformed
input, and that the identity cache doesn't return a stale index when a different
frame list reuses an id.

Run from the project root:  python3 -m unittest discover -s tests
"""

import sys
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import pack  # noqa: E402


class TestNearestFrame(unittest.TestCase):
    def test_picks_closest_within_window(self):
        frames = [{"t": 0, "file": "a.png"}, {"t": 1000, "file": "b.png"},
                  {"t": 5000, "file": "c.png"}]
        self.assertEqual(pack.nearest_frame(1100, frames), "b.png")
        self.assertEqual(pack.nearest_frame(4800, frames), "c.png")
        self.assertEqual(pack.nearest_frame(0, frames), "a.png")

    def test_exact_match(self):
        frames = [{"t": 0, "file": "a.png"}, {"t": 1000, "file": "b.png"}]
        self.assertEqual(pack.nearest_frame(1000, frames), "b.png")

    def test_returns_none_outside_window(self):
        frames = [{"t": 0, "file": "a.png"}]
        self.assertIsNone(pack.nearest_frame(99999, frames))

    def test_empty_frames(self):
        self.assertIsNone(pack.nearest_frame(0, []))

    def test_malformed_frame_elements(self):
        # Non-dict elements are dropped, not crashed on.
        self.assertIsNone(pack.nearest_frame(0, [1, "two", None]))
        frames = [1, {"t": 100, "file": "ok.png"}, None]
        self.assertEqual(pack.nearest_frame(120, frames), "ok.png")

    def test_non_numeric_times_coerce_to_zero(self):
        frames = [{"t": "bad", "file": "a.png"}, {"t": 1000, "file": "b.png"}]
        self.assertEqual(pack.nearest_frame(0, frames), "a.png")
        self.assertEqual(pack.nearest_frame("nope", frames), "a.png")

    def test_unsorted_input(self):
        frames = [{"t": 5000, "file": "c.png"}, {"t": 0, "file": "a.png"},
                  {"t": 1000, "file": "b.png"}]
        self.assertEqual(pack.nearest_frame(900, frames), "b.png")
        self.assertEqual(pack.nearest_frame(4900, frames), "c.png")

    def test_cache_is_per_list_not_stale(self):
        # Two different lists, queried interleaved, must each use their own index.
        a = [{"t": 0, "file": "a0.png"}, {"t": 9000, "file": "a9.png"}]
        b = [{"t": 0, "file": "b0.png"}, {"t": 9000, "file": "b9.png"}]
        self.assertEqual(pack.nearest_frame(100, a), "a0.png")
        self.assertEqual(pack.nearest_frame(100, b), "b0.png")
        self.assertEqual(pack.nearest_frame(8900, a), "a9.png")

    def test_matches_bruteforce_on_random_like_data(self):
        # Cross-check the bisect result against an O(n) scan over many queries. Both
        # iterate the SAME sorted list so equidistant ties resolve identically.
        frames = sorted(
            ({"t": (i * 137) % 10000, "file": f"f{i}.png"} for i in range(200)),
            key=lambda f: f["t"],
        )

        def brute(t, window=2000):
            best, best_dt = None, window + 1
            for f in frames:
                dt = abs(f["t"] - t)
                if dt < best_dt:
                    best, best_dt = f["file"], dt
            return best if best_dt <= window else None

        for t in range(0, 10000, 53):
            self.assertEqual(pack.nearest_frame(t, frames), brute(t),
                             msg=f"mismatch at t={t}")


if __name__ == "__main__":
    unittest.main()
