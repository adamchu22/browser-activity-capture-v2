// Pure video-segment logic for the re-share feature.
//
// Each MediaRecorder produces an independent WebM file. A re-share seals the
// previous recorder only after its final dataavailable/stop events. Segments
// are never byte-concatenated; each file carries its own recording-clock offset.
//
// This module holds the pure, testable pieces (no DOM, no chrome.*) so the
// segment math can be unit-tested without spinning up an offscreen doc. The
// offscreen doc imports these and supplies the real Blobs/offsets.

// Given a list of finalized segments (each { blob, offsetMs }) produce the
// manifest-shaped list of segment descriptors (file + offset_ms). Empty for a
// normal single-take recording; one entry per re-share. The first segment is
// always `video.webm` (the manifest's `video` field points at it); subsequent
// segments are `video-2.webm`, `video-3.webm`, … so the analyze side can find
// each segment's file and know its recording-clock offset. Each MediaRecorder
// segment is internally self-clocking (its PTS starts at 0), so segments
// cannot be byte-concatenated into one playable file — the second segment's
// timestamps restart at 0 and the EBML header duplicates break ffmpeg seeks.
// Multi-file keeps each segment a clean, independently-playable webm.
export function segmentOffsetsFor(segments) {
  if (!segments || !segments.length) return [];
  return segments.map((s, i) => ({
    offset_ms: s.offsetMs || 0,
    file: i === 0 ? "video.webm" : `video-${i + 1}.webm`,
  }));
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