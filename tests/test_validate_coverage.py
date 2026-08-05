"""The coverage check is wired into validate_bundle.py.

A capture gap (content script died, only network survived) must surface as a
loud WARNING in validation — but NOT fail an otherwise well-formed bundle
(it's still usable, just incomplete).
"""

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analyze"))
import validate_bundle  # noqa: E402


def write_bundle(tmp: Path, timeline):
    manifest = {
        "t0_wall": "2026-06-17T00:00:00.000Z",
        "duration_ms": timeline[-1]["t"] if timeline else 0,
        "sync_mode": "self_record",
        "redaction": {"password_fields_masked": True},
        "frames": [],
    }
    (tmp / "manifest.json").write_text(json.dumps(manifest))
    (tmp / "timeline.json").write_text(json.dumps(timeline))


def run_validate(timeline):
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        write_bundle(tmp, timeline)
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = validate_bundle.validate(tmp)
        return code, buf.getvalue()


class TestValidateCoverage(unittest.TestCase):
    def test_capture_gap_warns_but_still_passes(self):
        # clicks stop at 3s; network runs to 300s — the bug.
        timeline = [
            {"t": 0, "kind": "nav", "tab": 1},
            {"t": 1000, "kind": "click", "tab": 1},
            {"t": 2000, "kind": "click", "tab": 1},
            {"t": 3000, "kind": "click", "tab": 1},
        ] + [{"t": t, "kind": "network", "tab": 1} for t in range(4000, 300000, 1000)]
        code, out = run_validate(timeline)
        self.assertEqual(code, 0, "a capture gap is a warning, not a hard failure")
        self.assertIn("CAPTURE GAP", out)
        self.assertIn("PASS", out)

    def test_healthy_session_reports_coverage_ok(self):
        timeline = [
            {"t": 0, "kind": "nav", "tab": 1},
            {"t": 1000, "kind": "click", "tab": 1},
            {"t": 60000, "kind": "click", "tab": 1},
            {"t": 61000, "kind": "network", "tab": 1},
            {"t": 120000, "kind": "click", "tab": 1},
            {"t": 121000, "kind": "network", "tab": 1},
        ]
        code, out = run_validate(timeline)
        self.assertEqual(code, 0)
        self.assertNotIn("CAPTURE GAP", out)
        self.assertIn("capture coverage OK", out)


if __name__ == "__main__":
    unittest.main()
