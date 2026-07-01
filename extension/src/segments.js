// Pure video-segment logic for the re-share feature.
//
// When the user clicks Chrome's "Stop sharing" mid-recording and then re-shares,
// the offscreen recorder's dead chunks are sealed as a segment Blob and a new
// recorder starts on the fresh screen track. At finalize all segments are
// concatenated into one video.webm (same-codec MediaRecorder segments
// concatenate cleanly at the byte level) and the segment offsets are reported
// so the manifest can declare the gaps.
//
// This module holds the pure, testable pieces (no DOM, no chrome.*) so the
// segment math can be unit-tested without spinning up an offscreen doc. The
// offscreen doc imports these and supplies the real Blobs/offsets.

// Concatenate same-codec webm segment Blobs into a single Blob. Each
// MediaRecorder segment is a complete, playable webm (its own EBML header +
// clusters); byte concatenation of same-codec same-config segments produces a
// valid webm that players and ffmpeg read end-to-end. The first segment's header
// wins and subsequent headers are tolerated (ffmpeg skips them).
//
// Returns null when there are no segments (no video was captured at all).
export function concatSegments(segments) {
  if (!segments || !segments.length) return null;
  const blobs = segments.map((s) => s.blob).filter((b) => b && b.size > 0);
  if (!blobs.length) return null;
  return new Blob(blobs, { type: "video/webm" });
}

// Given a list of finalized segments (each { blob, offsetMs }) produce the
// manifest-shaped list of segment offsets (ms since t0 at which each segment's
// recorder started). Empty for a normal single-take recording; one entry per
// re-share. The worker records these in manifest.video_segments.
export function segmentOffsetsFor(segments) {
  if (!segments || !segments.length) return [];
  return segments.map((s) => ({ offset_ms: s.offsetMs || 0 }));
}

// Seal the dead recorder's chunks into a segment: returns a new segment object
// { blob, offsetMs } suitable for pushing onto videoSegments[]. The offset is the
// recording-clock time (ms since t0) at which this segment's recorder STARTED —
// passed by the worker so segments map onto the shared event clock. Returns null
// if the chunks are empty (the recorder produced no bytes — e.g. it died before
// the first dataavailable tick — so we don't emit a zero-byte segment).
export function sealSegment(chunks, offsetMs) {
  if (!chunks || !chunks.length) return null;
  return { blob: new Blob(chunks, { type: "video/webm" }), offsetMs: offsetMs || 0 };
}