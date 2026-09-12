"""Track C1 — pack.py never crashes on a malformed / untrusted bundle.

The "never crash on a bad bundle" contract: a truncated, non-JSON, non-UTF-8,
wrong-shape, or missing file must yield a (possibly thin) pack, not a traceback.

Run from the project root:  python3 -m unittest discover -s tests
"""

import sys
import tempfile
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import pack  # noqa: E402


class TempBundle:
    """A throwaway bundle dir whose files you set explicitly (bytes or str)."""

    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def write(self, name: str, data):
        p = self.dir / name
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            p.write_bytes(data)
        else:
            p.write_text(data, encoding="utf-8")
        return self

    def close(self):
        self._tmp.cleanup()


class TestBuildContextNeverCrashes(unittest.TestCase):
    def _ctx(self, files: dict):
        b = TempBundle()
        try:
            for name, data in files.items():
                b.write(name, data)
            return pack.build_context(b.dir)  # must not raise
        finally:
            b.close()

    def test_empty_bundle(self):
        # No files at all — defaults kick in, still produces a context.
        self.assertIn("Analysis context", self._ctx({}))

    def test_truncated_timeline(self):
        out = self._ctx({"timeline.json": '[{"t":1,"kind":"click"', "manifest.json": "{}"})
        self.assertIn("Analysis context", out)

    def test_timeline_not_a_list(self):
        # A JSON object where a list is expected → falls back to [].
        self._ctx({"timeline.json": '{"oops": true}', "manifest.json": "{}"})

    def test_timeline_with_non_dict_elements(self):
        self._ctx({"timeline.json": '[1, "two", null, {"t":5,"kind":"nav","url":"x"}]',
                   "manifest.json": "{}"})

    def test_non_numeric_timestamp(self):
        self._ctx({"timeline.json": '[{"t":"soon","kind":"click"}]', "manifest.json": "{}"})

    def test_manifest_not_an_object(self):
        # A top-level array where a dict is expected → falls back to {}.
        self._ctx({"manifest.json": "[1,2,3]", "timeline.json": "[]"})

    def test_non_utf8_files(self):
        bad = b"\xff\xfe\x00not utf8"
        self._ctx({"manifest.json": bad, "timeline.json": bad, "transcript.vtt": bad})

    def test_garbage_shapes_in_manifest(self):
        m = '{"urls_visited": "notalist", "tabs": [1, 2], "frames": "nope", "narration_error": 5}'
        self._ctx({"manifest.json": m, "timeline.json": "[]"})

    def test_malformed_har_and_errors(self):
        self._ctx({
            "manifest.json": "{}",
            "timeline.json": "[]",
            "network.har": '{"log": "notadict"}',
            "errors.json": '"a string, not a list"',
        })


class TestBuildPackNeverCrashes(unittest.TestCase):
    def test_build_pack_on_malformed_bundle(self):
        b = TempBundle()
        out = Path(tempfile.mkdtemp()) / "pack"
        try:
            b.write("timeline.json", "{not json")
            b.write("manifest.json", "[]")
            # The "never crash" contract: a malformed bundle must still produce a
            # readable pack (best-effort defaults), never raise.
            pack.build_pack(b.dir, out, transcribe=False)
            self.assertTrue((out / "context.md").exists())
        finally:
            b.close()


if __name__ == "__main__":
    unittest.main()
