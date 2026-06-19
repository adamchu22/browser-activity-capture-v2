"""Tests for P4 auto-transcribe: pack.maybe_transcribe() fills a stub transcript
from the bundle's audio, best-effort and never fatal. The real transcriber is
mocked — these tests don't need ffmpeg or any speech engine.

Run from the project root:  python3 -m unittest discover -s tests
"""

import json
import subprocess
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
    def _run(self, bundle, enabled=True, ffmpeg="/usr/bin/ffmpeg", engine="parakeet", rc=0):
        """Call maybe_transcribe with the engine probe + transcribe subprocess mocked
        (no ffmpeg / speech engine needed); return the subprocess.run mock. `engine`
        is what _engine_for would detect (None = nothing installed); `rc` is the
        transcribe subprocess exit code."""
        run_mock = mock.MagicMock(return_value=mock.Mock(returncode=rc, stdout="", stderr=""))
        with mock.patch.object(pack.shutil, "which", return_value=ffmpeg), \
                mock.patch.object(pack, "_venv_python", return_value=None), \
                mock.patch.object(pack, "_engine_for", return_value=engine), \
                mock.patch.object(pack.subprocess, "run", run_mock):
            pack.maybe_transcribe(bundle, enabled)
        return run_mock

    def test_runs_when_stub_and_audio_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_mock = self._run(_bundle(tmp))
            run_mock.assert_called_once()
            cmd = run_mock.call_args.args[0]  # [py, transcribe.py, bundle, --engine, parakeet]
            self.assertIn("--engine", cmd)
            self.assertEqual(cmd[cmd.index("--engine") + 1], "parakeet")
            self.assertTrue(str(cmd[1]).endswith("transcribe.py"))
            # C2: the transcribe subprocess is bounded so a wedged engine can't hang
            # the pack forever.
            self.assertEqual(run_mock.call_args.kwargs.get("timeout"), pack.TRANSCRIBE_TIMEOUT_S)

    def test_transcribe_timeout_is_not_fatal(self):
        # C2: a wedged transcribe/ffmpeg (TimeoutExpired) must be caught, not raised —
        # "never fatal" has to cover hangs, not just crashes.
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp)
            timeout = subprocess.TimeoutExpired(cmd="transcribe", timeout=pack.TRANSCRIBE_TIMEOUT_S)
            with mock.patch.object(pack.shutil, "which", return_value="/usr/bin/ffmpeg"), \
                    mock.patch.object(pack, "_venv_python", return_value=None), \
                    mock.patch.object(pack, "_engine_for", return_value="parakeet"), \
                    mock.patch.object(pack.subprocess, "run", side_effect=timeout):
                pack.maybe_transcribe(b, True)  # must not raise

    def test_uses_whisper_when_thats_what_is_installed(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_mock = self._run(_bundle(tmp), engine="whisper")
            cmd = run_mock.call_args.args[0]
            self.assertEqual(cmd[cmd.index("--engine") + 1], "whisper")

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

    def test_skips_when_no_engine_installed(self):
        # _engine_for returns None when neither mlx-audio nor faster-whisper is
        # importable — skip cleanly, never invoke transcribe, never raise.
        with tempfile.TemporaryDirectory() as tmp:
            self._run(_bundle(tmp), engine=None).assert_not_called()

    def test_transcribe_nonzero_exit_is_not_fatal(self):
        # The transcribe subprocess failing (bad weights, OOM) must not break the pack.
        with tempfile.TemporaryDirectory() as tmp:
            self._run(_bundle(tmp), rc=1)  # must not raise

    def test_unexpected_error_is_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = _bundle(tmp)
            with mock.patch.object(pack.shutil, "which", return_value="/usr/bin/ffmpeg"), \
                    mock.patch.object(pack, "_venv_python", return_value=None), \
                    mock.patch.object(pack, "_engine_for", return_value="parakeet"), \
                    mock.patch.object(pack.subprocess, "run", side_effect=RuntimeError("boom")):
                pack.maybe_transcribe(b, True)  # must not raise

    def test_malformed_manifest_is_not_fatal(self):
        # A corrupt manifest.json must not crash the pack build (reads are inside try).
        with tempfile.TemporaryDirectory() as tmp:
            b = Path(tmp)
            (b / "transcript.vtt").write_text("WEBVTT\n\nNOTE No narration captured.\n")
            (b / "manifest.json").write_text("{ not json ")
            (b / "video.webm").write_bytes(b"\x00")
            pack.maybe_transcribe(b, True)  # must not raise

    def test_non_utf8_transcript_is_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = Path(tmp)
            (b / "transcript.vtt").write_bytes(b"\xff\xfe not utf8")
            (b / "manifest.json").write_text(json.dumps({"video": "video.webm"}))
            (b / "video.webm").write_bytes(b"\x00")
            pack.maybe_transcribe(b, True)  # must not raise


if __name__ == "__main__":
    unittest.main()
