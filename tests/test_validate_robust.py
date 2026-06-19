"""Track C4 — validate_bundle.py + check_coverage.py never crash on a malformed /
untrusted bundle (type guards on manifest, timeline elements, frames, HAR).

The validator's job is to flag bad bundles, so it must survive the worst ones:
non-dict timeline entries, non-numeric timestamps, a top-level array where an
object is expected, non-UTF-8 files. It should return an exit code, never a
traceback.

Run from the project root:  python3 -m unittest discover -s tests
"""

import sys
import tempfile
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import validate_bundle as vb  # noqa: E402
import check_coverage as cc  # noqa: E402


def _bundle(files: dict) -> Path:
    d = Path(tempfile.mkdtemp())
    for name, data in files.items():
        p = d / name
        if isinstance(data, bytes):
            p.write_bytes(data)
        else:
            p.write_text(data, encoding="utf-8")
    return d


class TestValidateNeverCrashes(unittest.TestCase):
    def _validate(self, files):
        # Must return an int exit code, never raise.
        rc = vb.validate(_bundle(files))
        self.assertIn(rc, (0, 1))
        return rc

    def test_manifest_is_array(self):
        self._validate({"manifest.json": "[1,2,3]", "timeline.json": "[]"})

    def test_timeline_is_object(self):
        self._validate({"manifest.json": "{}", "timeline.json": '{"a":1}'})

    def test_timeline_non_dict_elements(self):
        self._validate({"manifest.json": "{}",
                        "timeline.json": '[1, "two", null, [3]]'})

    def test_timeline_non_numeric_t(self):
        self._validate({"manifest.json": "{}",
                        "timeline.json": '[{"t":"soon","kind":"click"}]'})

    def test_timeline_bool_t(self):
        # bool is an int subclass — must be rejected as non-numeric, not treated as 0/1.
        self._validate({"manifest.json": "{}",
                        "timeline.json": '[{"t":true,"kind":"nav"}]'})

    def test_manifest_garbage_shapes(self):
        m = '{"redaction":"nope","frames":"notalist","tabs":[1],"urls_visited":3}'
        self._validate({"manifest.json": m, "timeline.json": "[]"})

    def test_frames_with_non_string_file(self):
        m = '{"frames":[{"file":123},{"nofile":true},"x.png",5]}'
        self._validate({"manifest.json": m, "timeline.json": "[]"})

    def test_non_utf8_files(self):
        bad = b"\xff\xfe\x00garbage"
        self._validate({"manifest.json": bad, "timeline.json": bad})

    def test_truncated_json(self):
        self._validate({"manifest.json": '{"a":', "timeline.json": "[{"})


class TestTokenLockstep(unittest.TestCase):
    """C4 — the validator's TOKEN_RE must catch exactly what redact.js scrubs. The
    JWT shape had drifted ({10,} vs redact.js {6,}), so a short JWT that the
    extension would redact could slip past the gate unflagged."""

    SHORT_JWT = "eyJabcdef.ghijklmn"  # 6/8-char segments — redact.js {6,} catches it
    THREE_SEG_JWT = "eyJhdr123.eyJwl456.sigpart789"

    def test_short_jwt_now_flagged(self):
        self.assertRegex(self.SHORT_JWT, vb.TOKEN_RE)

    def test_three_segment_jwt_flagged(self):
        self.assertRegex(self.THREE_SEG_JWT, vb.TOKEN_RE)

    def test_too_short_jwt_not_flagged(self):
        # < 6 chars in a segment — neither tool treats this as a token.
        self.assertNotRegex("eyJab.cd", vb.TOKEN_RE)

    def test_end_to_end_short_jwt_fails_validation(self):
        d = _bundle({
            "manifest.json": '{"t0_wall":"x","duration_ms":1,"sync_mode":"self_record"}',
            "timeline.json": f'[{{"t":1,"kind":"nav","url":"https://x/?jwt={self.SHORT_JWT}"}}]',
        })
        self.assertEqual(vb.validate(d), 1)  # FAIL — leaked token caught


class TestAnalyzeCoverageNeverCrashes(unittest.TestCase):
    def test_non_dict_elements_skipped(self):
        r = cc.analyze_coverage([1, "x", None, {"t": 5, "kind": "click", "tab": 1}])
        self.assertTrue(r["ok"])

    def test_non_numeric_timestamps(self):
        cc.analyze_coverage([{"t": "bad", "kind": "click", "tab": 1}])  # no raise

    def test_unhashable_tab(self):
        # A dict tab id would blow up the by_tab key — must be coerced.
        cc.analyze_coverage([{"t": 1, "kind": "click", "tab": {"oops": 1}}])

    def test_malformed_frames(self):
        cc.analyze_coverage([], frames=[1, None, {"t": "x"}], duration_ms="huge")

    def test_timeline_not_a_list(self):
        cc.analyze_coverage({"a": 1})  # iterating a dict yields keys → all skipped


if __name__ == "__main__":
    unittest.main()
