// Pure geometry for the freeform Draw annotation tool.
//
// A stroke is captured as viewport-pixel points (clientX/clientY). To render it
// later on a frame at ANY capture resolution, we store each point and the stroke's
// bounding box as a percentage of the viewport — the same resolution-independent
// model positionFor() uses for clicks (xpct/ypct). pack.py (P4) places the
// highlight from these percentages.
//
// This is the only annotation logic with non-trivial math, so it lives here as a
// tested ES module. content.js is a classic content script and can't import it, so
// it keeps a verbatim copy — keep the two in sync (same contract as redact.js).

// Round to 0.1% so payloads stay small but placement is sub-pixel on a 1080p frame.
function pct(v, total) {
  return total ? Math.round((v / total) * 1000) / 10 : 0;
}

export function drawGeom(points, viewport) {
  const w = (viewport && viewport.w) || 0;
  const h = (viewport && viewport.h) || 0;
  const pts = (points || []).map((p) => ({ xpct: pct(p.x, w), ypct: pct(p.y, h) }));
  if (!pts.length) return { points: [], bbox: null, viewport: { w, h } };
  const xs = pts.map((p) => p.xpct);
  const ys = pts.map((p) => p.ypct);
  const minx = Math.min(...xs);
  const maxx = Math.max(...xs);
  const miny = Math.min(...ys);
  const maxy = Math.max(...ys);
  return {
    points: pts,
    bbox: {
      xpct: minx,
      ypct: miny,
      wpct: Math.round((maxx - minx) * 10) / 10,
      hpct: Math.round((maxy - miny) * 10) / 10,
    },
    viewport: { w, h },
  };
}
