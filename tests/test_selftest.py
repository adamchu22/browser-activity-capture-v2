"""Tests for transcribe.py --selftest: the install-time check that verifies the
whole transcription chain (ffmpeg + a speech engine) works on THIS machine before
setup claims success. The engine + ffmpeg synth are mocked — these tests need
neither installed.

Run from the project root:  python3 -m unittest discover -s tests
"""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import transcribe  # noqa: E402


class TestExtractAudioTimeout(unittest.TestCase):
    def test_passes_timeout_to_ffmpeg(self):
        # C2: a corrupt video must not let ffmpeg wedge the pipeline forever.
        run_mock = mock.MagicMock()
        with mock.patch.object(transcribe.subprocess, "run", run_mock):
            transcribe.extract_audio(Path("in.webm"), Path("out.wav"))
        self.assertEqual(run_mock.call_args.kwargs.get("timeout"), transcribe.FFMPEG_TIMEOUT_S)
        # bound is sane (positive, generous)
        self.assertGreater(transcribe.FFMPEG_TIMEOUT_S, 0)

    def test_timeout_propagates(self):
        # extract_audio doesn't swallow it; the caller (selftest / pack subprocess)
        # decides. Just confirm the signal isn't lost.
        boom = subprocess.TimeoutExpired(cmd="ffmpeg", timeout=transcribe.FFMPEG_TIMEOUT_S)
        with mock.patch.object(transcribe.subprocess, "run", side_effect=boom):
            with self.assertRaises(subprocess.TimeoutExpired):
                transcribe.extract_audio(Path("in.webm"), Path("out.wav"))


class TestAvailableEngine(unittest.TestCase):
    def _with_specs(self, present):
        # find_spec returns truthy for names in `present`, None otherwise.
        return lambda name: object() if name in present else None

    def test_prefers_parakeet_when_mlx_present(self):
        with mock.patch("importlib.util.find_spec",
                        side_effect=self._with_specs({"mlx_audio", "faster_whisper"})):
            self.assertEqual(transcribe._available_engine(), "parakeet")

    def test_whisper_when_only_faster_whisper(self):
        with mock.patch("importlib.util.find_spec",
                        side_effect=self._with_specs({"faster_whisper"})):
            self.assertEqual(transcribe._available_engine(), "whisper")

    def test_none_when_no_engine(self):
        with mock.patch("importlib.util.find_spec", side_effect=self._with_specs(set())):
            self.assertIsNone(transcribe._available_engine())


class TestSelftest(unittest.TestCase):
    def test_ffmpeg_missing_returns_2(self):
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=False):
            self.assertEqual(transcribe.selftest("parakeet", "", 8.0), 2)

    def test_no_engine_installed_returns_3(self):
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=True), \
                mock.patch.object(transcribe, "_available_engine", return_value=None):
            # engine_explicit defaults False, so it must auto-detect → nothing → 3
            self.assertEqual(transcribe.selftest("parakeet", "", 8.0), 3)

    def test_success_uses_detected_engine(self):
        # ffmpeg present, faster-whisper detected: synth wav (mocked) + run_whisper
        # (mocked) succeed → 0. Verifies it runs whisper, not the parakeet default.
        run_whisper = mock.MagicMock(return_value=("WEBVTT\n", 0))
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=True), \
                mock.patch.object(transcribe, "_available_engine", return_value="whisper"), \
                mock.patch.object(transcribe.subprocess, "run"), \
                mock.patch.object(transcribe, "run_whisper", run_whisper), \
                mock.patch.object(transcribe, "run_parakeet") as run_parakeet:
            self.assertEqual(transcribe.selftest("parakeet", "", 8.0), 0)
        run_whisper.assert_called_once()
        run_parakeet.assert_not_called()

    def test_explicit_engine_is_not_overridden(self):
        # --engine whisper passed explicitly: don't auto-detect, run whisper as asked.
        run_whisper = mock.MagicMock(return_value=("WEBVTT\n", 0))
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=True), \
                mock.patch.object(transcribe, "_available_engine") as detect, \
                mock.patch.object(transcribe.subprocess, "run"), \
                mock.patch.object(transcribe, "run_whisper", run_whisper):
            self.assertEqual(
                transcribe.selftest("whisper", "", 8.0, engine_explicit=True), 0)
        detect.assert_not_called()
        run_whisper.assert_called_once()

    def test_engine_import_failure_returns_3(self):
        # run_whisper sys.exit()s when the engine isn't importable — caught → 3.
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=True), \
                mock.patch.object(transcribe, "_available_engine", return_value="whisper"), \
                mock.patch.object(transcribe.subprocess, "run"), \
                mock.patch.object(transcribe, "run_whisper",
                                  side_effect=SystemExit("faster-whisper not installed")):
            self.assertEqual(transcribe.selftest("parakeet", "", 8.0), 3)

    def test_ffmpeg_synth_failure_returns_3(self):
        # ffmpeg present but the synth subprocess raises → reported, returns 3.
        with mock.patch.object(transcribe, "_ffmpeg_ok", return_value=True), \
                mock.patch.object(transcribe, "_available_engine", return_value="whisper"), \
                mock.patch.object(transcribe.subprocess, "run",
                                  side_effect=RuntimeError("ffmpeg boom")):
            self.assertEqual(transcribe.selftest("parakeet", "", 8.0), 3)


if __name__ == "__main__":
    unittest.main()
