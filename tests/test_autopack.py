"""autopack.py — pack every new capture zip in a location, robust enough to run
unattended (idempotent, atomic, locked, fail-remembering, bomb-guarded)."""
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import autopack  # noqa: E402


def _write_capture_zip(path: Path, *, valid=True, manifest=None):
    with zipfile.ZipFile(path, "w") as zf:
        if valid:
            zf.writestr("manifest.json", json.dumps(manifest if manifest is not None else
                {"capture_id": "x", "t0_wall": "2026-06-23T00:00:00.000Z",
                 "duration_ms": 1000, "purposes": [], "frames": []}))
            zf.writestr("timeline.json", json.dumps(
                [{"kind": "click", "t": 100, "selector": "#a", "ctx": {"name": "A"}}]))
            zf.writestr("transcript.vtt", "WEBVTT\n\nNOTE No narration captured\n")
            zf.writestr("network.har", json.dumps({"log": {"entries": []}}))
            zf.writestr("frames/0000000100.png", b"\x89PNG\r\n")
        elif manifest is not None:
            zf.writestr("manifest.json", json.dumps(manifest))
        else:
            zf.writestr("hello.txt", "not a capture")


def _age(path: Path, seconds: float):
    """Backdate a file's mtime so the freshness gate treats it as settled."""
    st = path.stat()
    os.utime(path, (st.st_atime, st.st_mtime - seconds))


class TestDiscovery(unittest.TestCase):
    def test_is_capture_zip_requires_real_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "capture-1.zip"
            no_manifest = Path(tmp) / "other.zip"
            stub_manifest = Path(tmp) / "capture-2.zip"
            _write_capture_zip(good)
            _write_capture_zip(no_manifest, valid=False)
            _write_capture_zip(stub_manifest, valid=False, manifest={})  # marker only, no capture_id
            self.assertTrue(autopack.is_capture_zip(good))
            self.assertFalse(autopack.is_capture_zip(no_manifest))
            self.assertFalse(autopack.is_capture_zip(stub_manifest))

    def test_find_unpacked_skips_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            self.assertEqual(len(autopack.find_unpacked(loc, None)), 1)
            (loc / "capture-1-pack").mkdir()  # simulate an already-built pack
            self.assertEqual(autopack.find_unpacked(loc, None), [])

    def test_find_unpacked_ignores_non_capture_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            # right shape, wrong name → not the extension's output, skip it
            _write_capture_zip(loc / "report.zip")
            self.assertEqual(autopack.find_unpacked(loc, None), [])

    def test_find_unpacked_skips_fresh_then_picks_up_settled(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            now = z.stat().st_mtime + 0.1  # the zip is "fresh"
            self.assertEqual(autopack.find_unpacked(loc, None, min_age_s=10, now=now), [])
            later = z.stat().st_mtime + 30  # 30s on, it's settled
            self.assertEqual(len(autopack.find_unpacked(loc, None, min_age_s=10, now=later)), 1)

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

    def test_pack_zip_is_atomic_on_failure(self):
        # An interrupted build must leave NO dest dir (so it's retried, not skipped
        # forever) and NO leftover staging dir.
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            dest = loc / "capture-1-pack"
            orig = autopack.build_pack
            autopack.build_pack = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
            try:
                with self.assertRaises(RuntimeError):
                    autopack.pack_zip(z, dest, blocklist=[], transcribe=False)
            finally:
                autopack.build_pack = orig
            self.assertFalse(dest.exists())
            self.assertEqual(list(loc.glob(".*-pack.tmp-*")), [])

    def test_zip_bomb_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            self.addCleanup(setattr, autopack, "MAX_UNCOMPRESSED_BYTES",
                            autopack.MAX_UNCOMPRESSED_BYTES)
            autopack.MAX_UNCOMPRESSED_BYTES = 10  # any real bundle blows past this
            with self.assertRaises(ValueError):
                autopack.pack_zip(z, loc / "out", transcribe=False)

    def test_zip_slip_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "evil.zip"
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("manifest.json", "{}")
                zf.writestr("../escape.txt", "pwned")
            with self.assertRaises(ValueError):
                autopack.pack_zip(z, loc / "out", transcribe=False)

    def test_run_is_idempotent_and_best_effort(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            sf = loc / "state.json"
            _write_capture_zip(loc / "capture-good.zip")
            # a real-looking capture (valid manifest) but a corrupt timeline → it's
            # detected, and build_pack stays best-effort (never crashes → still packs).
            bad = loc / "capture-bad.zip"
            with zipfile.ZipFile(bad, "w") as zf:
                zf.writestr("manifest.json", json.dumps(
                    {"capture_id": "y", "t0_wall": "2026-06-23T00:00:00.000Z"}))
                zf.writestr("timeline.json", "not json{")
            s1 = autopack.run([loc], None, transcribe=False, state_file=sf)
            self.assertEqual(len(s1["packed"]), 2)
            s2 = autopack.run([loc], None, transcribe=False, state_file=sf)
            self.assertEqual(s2["packed"], [])  # nothing new


class TestFailureMemory(unittest.TestCase):
    def test_gives_up_after_max_attempts(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            sf = loc / "state.json"
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            orig = autopack.pack_zip
            autopack.pack_zip = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("nope"))
            try:
                for i in range(autopack.MAX_ATTEMPTS):
                    s = autopack.run([loc], None, transcribe=False, state_file=sf)
                    self.assertEqual(len(s["failed"]), 1, f"pass {i}")
                    self.assertEqual(s["gaveup"], [])
                # next pass: attempts maxed → given up, not retried
                s = autopack.run([loc], None, transcribe=False, state_file=sf)
                self.assertEqual(s["failed"], [])
                self.assertEqual(len(s["gaveup"]), 1)
            finally:
                autopack.pack_zip = orig
            # the failure was persisted
            self.assertEqual(json.loads(sf.read_text())["failures"]
                             [list(json.loads(sf.read_text())["failures"])[0]]["attempts"],
                             autopack.MAX_ATTEMPTS)

    def test_success_clears_failure_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            sf = loc / "state.json"
            z = loc / "capture-1.zip"
            _write_capture_zip(z)  # write first so the seeded key matches the runtime key
            autopack.save_state({"failures": {autopack.failure_key(z):
                                              {"attempts": 1, "last_error": "x"}}}, sf)
            autopack.run([loc], None, transcribe=False, state_file=sf)
            self.assertEqual(json.loads(sf.read_text()).get("failures"), {})


class TestLock(unittest.TestCase):
    def test_single_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            lp = Path(tmp) / "autopack.lock"
            h1 = autopack.acquire_lock(lp)
            self.assertIsNotNone(h1)
            self.assertIsNone(autopack.acquire_lock(lp))  # second instance blocked
            h1.close()
            h2 = autopack.acquire_lock(lp)  # released → reacquirable
            self.assertIsNotNone(h2)
            h2.close()


class TestActivityLog(unittest.TestCase):
    def test_log_line_written_only_when_work_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            sf, lf = loc / "state.json", loc / "autopack.log"
            # an empty folder → idle pass → no log line, but last_run is stamped
            autopack.run([loc], None, transcribe=False, state_file=sf, log_file=lf)
            self.assertFalse(lf.exists())
            self.assertIn("last_run", json.loads(sf.read_text()))
            # now a real capture → one line recording it
            _write_capture_zip(loc / "capture-1.zip")
            autopack.run([loc], None, transcribe=False, state_file=sf, log_file=lf)
            text = lf.read_text()
            self.assertEqual(text.count("\n"), 1)
            self.assertIn("packed=1", text)
            self.assertIn("capture-1-pack", text)

    def test_log_records_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            sf, lf = loc / "state.json", loc / "autopack.log"
            _write_capture_zip(loc / "capture-1.zip")
            orig = autopack.pack_zip
            autopack.pack_zip = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("nope"))
            try:
                autopack.run([loc], None, transcribe=False, state_file=sf, log_file=lf)
            finally:
                autopack.pack_zip = orig
            line = lf.read_text()
            self.assertIn("failed=1", line)
            self.assertIn("capture-1.zip", line)

    def test_append_log_rotates_at_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            lf = Path(tmp) / "autopack.log"
            autopack.append_log("first line that fills the log", path=lf, max_bytes=40)
            self.assertTrue(lf.exists())
            self.assertFalse(lf.with_name("autopack.log.1").exists())
            # next line would blow the 40-byte cap → rotate, fresh log holds line 2
            autopack.append_log("second line", path=lf, max_bytes=40)
            self.assertEqual(lf.read_text().strip(), "second line")
            self.assertIn("first line", lf.with_name("autopack.log.1").read_text())


class TestStatus(unittest.TestCase):
    def test_reports_last_run_and_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            loc = Path(tmp)
            z = loc / "capture-1.zip"
            _write_capture_zip(z)
            state = {
                "last_run": {"at": "2026-06-24T10:00:00", "packed": 2,
                             "failed": 1, "gaveup": 0},
                "failures": {f"{z}|1|2": {"attempts": 3, "last_error": "BadZipFile: x"}},
            }
            report = autopack.status_report([loc], None, state=state,
                                            now=z.stat().st_mtime + 120)
            self.assertIn(str(loc), report)
            self.assertIn("2 packed, 1 failed", report)
            self.assertIn("GIVEN UP", report)          # attempts >= MAX_ATTEMPTS
            self.assertIn("capture-1.zip", report)
            self.assertIn("1 capture zip(s)", report)  # saw the zip in the folder

    def test_clean_state_and_missing_folder(self):
        missing = Path("/no/such/autopack/dir")
        report = autopack.status_report([missing], None, state={}, now=0.0)
        self.assertIn("does not exist", report)
        self.assertIn("no record yet", report)
        self.assertIn("no failures recorded", report)


class TestConfig(unittest.TestCase):
    def test_cli_arg_wins(self):
        locs, packs = autopack.resolve_locations(["/tmp/foo"])
        self.assertEqual(locs, [Path("/tmp/foo")])

    def test_default_is_downloads(self):
        if autopack.CONFIG.exists():
            self.skipTest("a real autopack.config.json is present")
        locs, packs = autopack.resolve_locations([])
        self.assertEqual(locs, [Path("~/Downloads").expanduser()])
        self.assertIsNone(packs)


if __name__ == "__main__":
    unittest.main()
