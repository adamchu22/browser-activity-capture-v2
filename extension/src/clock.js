// The one recording clock, paused-time-aware.
//
// Elapsed recording time = wall-clock since t0, MINUS every paused interval. The
// MediaRecorder also excludes paused time from video.webm, so stamping events and
// frames with this keeps all modalities aligned to the video. The old math was a
// bare `Date.now() - t0`, which counted paused seconds — so on resume the clock
// jumped forward by the pause length and frames/events drifted past the video.
//
// Pure + dependency-free: the worker imports it; content.js mirrors it (classic
// scripts can't import). Unit-tested in tests/test_clock.mjs.
export function recordingElapsed(nowMs, { t0 = 0, pausedAccum = 0, pauseStartedAt = 0, paused = false } = {}) {
  if (!t0) return 0; // before go-live (arming/countdown)
  const ongoing = paused && pauseStartedAt ? nowMs - pauseStartedAt : 0;
  return Math.max(0, nowMs - t0 - pausedAccum - ongoing);
}
