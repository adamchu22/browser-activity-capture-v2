"""Tests for P4 auto-transcribe: pack.maybe_transcribe() fills a stub transcript
from the bundle's audio, best-effort and never fatal. The real transcriber is
mocked — these tests don't need ffmpeg or any speech engine.

Run from the project root:  python3 -m unittest discover -s tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import pack  # noqa: E402


class TestTranscriptIsStub(unittest.TestCase):
    def test_empty_or_blank_is_stub(self):
        self.assertTrue(pack._transcript_is_stub(""))
        self.assertTrue(pack._transcript_is_stub("   \n  "))

    def test_export_placeholder_is_stub(self):
        self.assertTrue(pack._transcript_is_stub("WEBVTT\n\nNOTE No narration captured. Drop a transcript here.\n"))

    def test_header_without_cues_is_stub(self):
        self.assertTrue(pack._transcript_is_stub("WEBVTT\n\nNOTE engine=parakeet\n"))

    def test_real_cues_not_stub(self):
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello there\n"
        self.assertFalse(pack._transcript_is_stub(vtt))


def _bundle(tmp, *, transcript="WEBVTT\n\nNOTE No narration captured.\n",
            manifest=None, video=True):
    b = Path(tmp)
    (b / "transcript.vtt").write_text(transcript)
    (b / "manifest.json").write_text(json.dumps(manifest if manifest is not None else {"video": "video.webm"}))
    if video:
        (b / "video.webm").write_bytes(b"\x00")  # presence is all maybe_transcribe checks
    return b


class TestMaybeTranscribe(unittest.TestCase):
    def _run(self, bundle, enabled=True, ffmpeg="/usr/bin/ffmpeg"):
        """Call maybe_transcribe with the real transcriber mocked; return the mock."""
        fake = mock.MagicMock()
        with mock.patch.object(pack.shutil, "which", return_value=ffmpeg):
            with mock.patch.dict(sys.modules):
                import transcribe  # noqa: E402
                with mock.patch.object(transcribe, "transcribe", fake):
                    pack.maybe_transcribe(bundle, enabled)
        return fake

    def test_runs_when_stub_and_audio_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = self._run(_bundle(tmp))
            fake.assert_called_once()
            # called as transcribe(bundle, "parakeet", "", 8.0, None)
            args = fake.call_args.args
            self.assertEqual(args[1], "parakeet")

    def test_disabled_does_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._run(_bundle(tmp), enabled=False).assert_not_called()

    def test_skips_when_transcript_already_real(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, transcript="WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n")
            self._run(b).assert_not_called()

    def test_skips_when_narration_in_video_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, manifest={"video": "video.webm", "narration_in_video": False})
            self._run(b).assert_not_called()

    def test_skips_when_no_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp, video=False)
            self._run(b).assert_not_called()

    def test_skips_when_ffmpeg_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._run(_bundle(tmp), ffmpeg=None).assert_not_called()

    def test_engine_missing_is_not_fatal(self):
        # transcribe.py sys.exit()s when an engine isn't installed — maybe_transcribe
        # must swallow it so the pack still builds.
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp)
            with mock.patch.object(pack.shutil, "which", return_value="/usr/bin/ffmpeg"):
                import transcribe  # noqa: E402
                with mock.patch.object(transcribe, "transcribe", side_effect=SystemExit("no engine")):
                    pack.maybe_transcribe(b, True)  # must not raise

    def test_unexpected_error_is_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp)
            with mock.patch.object(pack.shutil, "which", return_value="/usr/bin/ffmpeg"):
                import transcribe  # noqa: E402
                with mock.patch.object(transcribe, "transcribe", side_effect=RuntimeError("boom")):
                    pack.maybe_transcribe(b, True)  # must not raise


if __name__ == "__main__":
    unittest.main()
