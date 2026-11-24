/**
 * The camera's arithmetic, kept free of React and the DOM so it is tested
 * (frame.test.ts): where the on-screen guide falls on the camera's pixels,
 * and how much table to trim off around the paper.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Trim { top: number; right: number; bottom: number; left: number }

/**
 * The part of the camera image that shows inside `guide`.
 *
 * The feed fills its box with `object-fit: cover`, so the image is scaled
 * until it covers the box and the overflow is cut equally from both sides.
 * `guide` is in box pixels; the answer is in camera pixels. A mirrored
 * preview (the front lens) shows the image flipped, so the guide's left edge
 * is the image's right.
 */
export function guideToSource(videoW: number, videoH: number, boxW: number, boxH: number, guide: Rect, mirrored = false): Rect {
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const offX = (videoW * scale - boxW) / 2;
  const offY = (videoH * scale - boxH) / 2;
  let x = (guide.x + offX) / scale;
  const y = (guide.y + offY) / scale;
  const w = guide.w / scale;
  const h = guide.h / scale;
  if (mirrored) x = videoW - x - w;
  const cx = Math.max(0, Math.min(videoW, x));
  const cy = Math.max(0, Math.min(videoH, y));
  return {
    x: Math.round(cx),
    y: Math.round(cy),
    w: Math.round(Math.min(videoW - cx, w - (cx - x))),
    h: Math.round(Math.min(videoH - cy, h - (cy - y))),
  };
}

/** No side loses more than this share of the crop: a guess never eats the drawing. */
export const MAX_TRIM = 0.25;
/** How far past the paper's edge the trim may step to lose a crooked sheet's corners. */
export const TILT_SLACK = 0.05;

/**
 * How many pixels of not-paper (the table) lie around the paper, on each
 * side of an RGBA image.
 *
 * Paper is the bright, colourless part: a pixel at least 78% as bright as
 * the paper itself and with little colour in it. The paper's own brightness
 * is read from the middle of the image, where the drawing is. From each edge
 * the rows (or columns) are read inwards; the first that is mostly paper is
 * where the paper starts. A side that never reaches paper within MAX_TRIM is
 * left as it is, and an image with no bright paper at all is not trimmed.
 * A crooked sheet is trimmed a little further, past its corner wedges.
 */
export function paperTrim(px: Uint8ClampedArray, w: number, h: number): Trim {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (w < 8 || h < 8) return none;
  const lum = new Float32Array(w * h);
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    grey[i] = Math.max(r, g, b) - Math.min(r, g, b) <= 45 ? 1 : 0;
  }
  const mid: number[] = [];
  for (let y = Math.floor(h / 4); y < Math.ceil((3 * h) / 4); y++) {
    for (let x = Math.floor(w / 4); x < Math.ceil((3 * w) / 4); x++) mid.push(lum[y * w + x]);
  }
  mid.sort((a, b) => a - b);
  const ref = mid[Math.floor(mid.length * 0.9)];
  if (ref < 110) return none;
  const floor = ref * 0.78;
  const isPaper = (x: number, y: number) => grey[y * w + x] === 1 && lum[y * w + x] >= floor;

  const rowPaper = (y: number) => { let n = 0; for (let x = 0; x < w; x++) n += isPaper(x, y) ? 1 : 0; return n / w; };
  const colPaper = (x: number) => { let n = 0; for (let y = 0; y < h; y++) n += isPaper(x, y) ? 1 : 0; return n / h; };
  const scan = (count: number, at: (i: number) => number, line: (i: number) => number) => {
    const limit = Math.floor(count * MAX_TRIM);
    for (let i = 0; i <= limit; i++) {
      if (line(at(i)) < 0.6) continue;
      // A sheet lies a little crooked, so its edge leaves wedges of table in
      // the corners. Step a few lines further to one that is all paper, but
      // never far: past that it is the drawing, not the table.
      const reach = Math.min(limit, i + Math.ceil(count * TILT_SLACK));
      for (let j = i; j <= reach; j++) if (line(at(j)) >= 0.97) return j;
      return i;
    }
    return 0;
  };
  return {
    top: scan(h, (i) => i, rowPaper),
    bottom: scan(h, (i) => h - 1 - i, rowPaper),
    left: scan(w, (i) => i, colPaper),
    right: scan(w, (i) => w - 1 - i, colPaper),
  };
}
