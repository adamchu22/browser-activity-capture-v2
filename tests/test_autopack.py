"""autopack.py — pack every new capture zip in a location (idempotent, best-effort)."""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import autopack  # noqa: E402


def _write_capture_zip(path: Path, *, valid=True):
    with zipfile.ZipFile(path, "w") as zf:
        if valid:
            zf.writestr("manifest.json", json.dumps(
                {"capture_id": "x", "t0_wall": "2026-06-23T00:00:00.000Z",
                 "duration_ms": 1000, "purposes": [], "frames": []}))
            zf.writestr("timeline.json", json.dumps(
                [{"kind": "click", "t": 100, "selector": "#a", "ctx": {"name": "A"}}]))
            zf.writestr("transcript.vtt", "WEBVTT\n\nNOTE No narration captured\n")
            zf.writestr("network.har", json.dumps({"log": {"entries": []}}))
            zf.writestr("frames/0000000100.png", b"\x89PNG\r\n")
        else:
            zf.writestr("hello.txt", "not a capture")


class TestDiscovery(unittest.TestCase):
    def test_is_capture_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "capture-1.zip"
            bad = Path(tmp) / "other.zip"
            _write_capture_zip(good)
            _write_capture_zip(bad, valid=False)
            self.assertTrue(autopack.is_capture_zip(good))
            self.assertFalse(autopack.is_capture_zip(bad))

    def test_find_unpacked_skips_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            self.assertEqual(len(autopack.find_unpacked(loc, None)), 1)
            # simulate an already-built pack beside it
            (loc / "capture-1-pack").mkdir()
            self.assertEqual(autopack.find_unpacked(loc, None), [])

    def test_find_unpacked_ignores_non_capture_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            _write_capture_zip(loc / "junk.zip", valid=False)
            self.assertEqual(autopack.find_unpacked(loc, None), [])

    def test_pack_path_for_uses_packs_dir(self):
        z = Path("/x/capture-9.zip")
        self.assertEqual(autopack.pack_path_for(z, None), Path("/x/capture-9-pack"))
        self.assertEqual(autopack.pack_path_for(z, Path("/packs")),
                         Path("/packs/capture-9-pack"))


class TestPacking(unittest.TestCase):
    def test_pack_zip_produces_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            dest = loc / "capture-1-pack"
            autopack.pack_zip(z, dest, blocklist=[], transcribe=False)
            for f in ("context.md", "health.json", "friction.json", "todos.json", "BRIEF.md"):
                self.assertTrue((dest / f).exists(), f"{f} missing from pack")
            health = json.loads((dest / "health.json").read_text())
            self.assertEqual(health["frames"]["on_disk"], 1)

    def test_run_is_idempotent_and_best_effort(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            _write_capture_zip(loc / "capture-good.zip")
            # a corrupt "capture" zip that passes the marker check but fails to extract
            bad = loc / "capture-bad.zip"
            with zipfile.ZipFile(bad, "w") as zf:
                zf.writestr("manifest.json", "{}")  # marker present, but no timeline → build still runs
            s1 = autopack.run([loc], None, transcribe=False)
            self.assertEqual(len(s1["packed"]), 2)  # both attempt; build_pack never crashes
            # second pass: nothing new
            s2 = autopack.run([loc], None, transcribe=False)
            self.assertEqual(s2["packed"], [])

    def test_zip_slip_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "evil.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("manifest.json", "{}")
                zf.writestr("../escape.txt", "pwned")
            with self.assertRaises(ValueError):
                autopack.pack_zip(z, loc / "out", transcribe=False)


class TestConfig(unittest.TestCase):
    def test_cli_arg_wins(self):
        locs, packs = autopack.resolve_locations(["/tmp/foo"])
        self.assertEqual(locs, [Path("/tmp/foo")])

    def test_default_is_downloads(self):
        # no config file on disk in CI → ~/Downloads default
        if autopack.CONFIG.exists():
            self.skipTest("a real autopack.config.json is present")
        locs, packs = autopack.resolve_locations([])
        self.assertEqual(locs, [Path("~/Downloads").expanduser()])
        self.assertIsNone(packs)


if __name__ == "__main__":
    unittest.main()
