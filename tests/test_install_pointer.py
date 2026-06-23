"""Tests for analyze/install_pointer.py — the machine-local pointer that lets an
agent handed a bundle from any directory locate the analyze pipeline and build the
fused context.md spine. Run: python3 -m unittest tests.test_install_pointer
"""
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "analyze"))
import install_pointer as ip  # noqa: E402


class TestRecord(unittest.TestCase):
    def test_build_record_has_locators_and_runnable_cmd(self):
        rec = ip.build_record(adir=Path("/opt/cap/analyze"), python="/opt/cap/.venv/bin/python")
        self.assertEqual(rec["tool"], "browser-activity-capture")
        self.assertEqual(rec["analyze_dir"], "/opt/cap/analyze")
        self.assertEqual(rec["python"], "/opt/cap/.venv/bin/python")
        # pack_cmd is a ready-to-run template: names pack.py + the bundle placeholder.
        self.assertIn("pack.py", rec["pack_cmd"])
        self.assertIn("<bundle>", rec["pack_cmd"])
        self.assertIn("/opt/cap/.venv/bin/python", rec["pack_cmd"])

    def test_defaults_point_at_this_install(self):
        rec = ip.build_record()
        # analyze_dir defaults to the real analyze/ dir (where install_pointer lives).
        self.assertEqual(Path(rec["analyze_dir"]).name, "analyze")
        self.assertTrue((Path(rec["analyze_dir"]) / "pack.py").exists())


class TestWriteRead(unittest.TestCase):
    def test_write_then_read_roundtrip(self):
        with TemporaryDirectory() as d:
            dest = Path(d) / "install.json"
            ip.write_pointer(adir=Path("/x/analyze"), python="/x/py", dest=dest)
            self.assertTrue(dest.exists())
            rec = ip.read_pointer(dest)
            self.assertEqual(rec["analyze_dir"], "/x/analyze")
            self.assertEqual(rec["python"], "/x/py")

    def test_write_creates_parent_dirs(self):
        with TemporaryDirectory() as d:
            dest = Path(d) / "nested" / "deeper" / "install.json"
            ip.write_pointer(adir=Path("/x/analyze"), python="/x/py", dest=dest)
            self.assertTrue(dest.exists())

    def test_read_missing_returns_none(self):
        with TemporaryDirectory() as d:
            self.assertIsNone(ip.read_pointer(Path(d) / "nope.json"))

    def test_read_malformed_returns_none(self):
        with TemporaryDirectory() as d:
            bad = Path(d) / "install.json"
            bad.write_text("{not json", encoding="utf-8")
            self.assertIsNone(ip.read_pointer(bad))

    def test_read_non_dict_or_empty_returns_none(self):
        with TemporaryDirectory() as d:
            for payload in ("[]", "\"hi\"", "{}", '{"python": "/x"}'):
                p = Path(d) / "install.json"
                p.write_text(payload, encoding="utf-8")
                self.assertIsNone(ip.read_pointer(p), payload)


class TestPointerPath(unittest.TestCase):
    def test_honors_xdg_config_home(self):
        old = os.environ.get("XDG_CONFIG_HOME")
        try:
            os.environ["XDG_CONFIG_HOME"] = "/tmp/xdgtest"
            p = ip.pointer_path()
            self.assertEqual(
                p, Path("/tmp/xdgtest/browser-activity-capture/install.json")
            )
        finally:
            if old is None:
                os.environ.pop("XDG_CONFIG_HOME", None)
            else:
                os.environ["XDG_CONFIG_HOME"] = old

    def test_default_is_under_config_home(self):
        old = os.environ.pop("XDG_CONFIG_HOME", None)
        try:
            p = ip.pointer_path()
            self.assertEqual(p.parent.name, "browser-activity-capture")
            self.assertEqual(p.name, "install.json")
            self.assertIn(".config", str(p))
        finally:
            if old is not None:
                os.environ["XDG_CONFIG_HOME"] = old

    def test_main_writes_to_pointer_path(self):
        with TemporaryDirectory() as d:
            old = os.environ.get("XDG_CONFIG_HOME")
            os.environ["XDG_CONFIG_HOME"] = d
            try:
                ip.write_pointer()  # uses pointer_path() → the redirected dir
                written = Path(d) / "browser-activity-capture" / "install.json"
                self.assertTrue(written.exists())
                rec = json.loads(written.read_text(encoding="utf-8"))
                self.assertEqual(rec["tool"], "browser-activity-capture")
            finally:
                if old is None:
                    os.environ.pop("XDG_CONFIG_HOME", None)
                else:
                    os.environ["XDG_CONFIG_HOME"] = old


if __name__ == "__main__":
    unittest.main()
