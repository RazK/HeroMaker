import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guideToSource, paperTrim, MAX_TRIM } from './frame.js';

test('a guide on a box the same shape as the feed maps by scale alone', () => {
  // 1280x960 feed in a 640x480 box: everything halves.
  assert.deepEqual(guideToSource(1280, 960, 640, 480, { x: 100, y: 40, w: 300, h: 400 }), { x: 200, y: 80, w: 600, h: 800 });
});

test('a tall phone box cuts the feed\'s sides, and the guide lands in the middle', () => {
  // 1920x1440 landscape feed shown cover in a 390x844 portrait box.
  const s = guideToSource(1920, 1440, 390, 844, { x: 43, y: 192, w: 304, h: 405 });
  const scale = 844 / 1440;
  assert.equal(s.w, Math.round(304 / scale));
  assert.equal(s.h, Math.round(405 / scale));
  // Centred guide, centred crop.
  assert.ok(Math.abs(s.x + s.w / 2 - 960) <= 1);
});

test('mirroring flips which side of the image the guide reads', () => {
  const plain = guideToSource(1000, 1000, 1000, 1000, { x: 0, y: 0, w: 200, h: 200 });
  const flip = guideToSource(1000, 1000, 1000, 1000, { x: 0, y: 0, w: 200, h: 200 }, true);
  assert.equal(plain.x, 0);
  assert.equal(flip.x, 800);
});

test('a guide past the image edge is clamped to the image', () => {
  const s = guideToSource(100, 100, 100, 100, { x: -10, y: 90, w: 50, h: 50 });
  assert.deepEqual(s, { x: 0, y: 90, w: 40, h: 10 });
});

/** A w x h image: dark brown table, a white sheet inside `paper`, a red scribble in the middle. */
function photo(w: number, h: number, paper: { top: number; right: number; bottom: number; left: number }) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = y >= paper.top && y < h - paper.bottom && x >= paper.left && x < w - paper.right;
      const scribble = on && Math.abs(x - w / 2) < w / 10 && Math.abs(y - h / 2) < h / 6;
      const [r, g, b] = scribble ? [220, 40, 60] : on ? [245, 242, 236] : [90, 60, 40];
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}

test('the table around the paper is trimmed, side by side', () => {
  const t = paperTrim(photo(120, 160, { top: 12, right: 5, bottom: 20, left: 0 }), 120, 160);
  assert.deepEqual(t, { top: 12, right: 5, bottom: 20, left: 0 });
});

test('paper that fills the frame is not trimmed', () => {
  assert.deepEqual(paperTrim(photo(90, 120, { top: 0, right: 0, bottom: 0, left: 0 }), 90, 120), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('no side loses more than MAX_TRIM, even when it never finds paper', () => {
  const w = 100, h = 100;
  const t = paperTrim(photo(w, h, { top: 40, right: 0, bottom: 0, left: 0 }), w, h);
  assert.ok(t.top <= Math.floor(h * MAX_TRIM));
});

test('a dark photo with no paper in it is left whole', () => {
  const px = new Uint8ClampedArray(50 * 50 * 4).fill(60);
  assert.deepEqual(paperTrim(px, 50, 50), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('a crooked sheet loses its corner wedges of table, and no more', () => {
  // The sheet's top edge runs from row 10 at the left to row 16 at the right.
  const w = 100, h = 140;
  const px = photo(w, h, { top: 0, right: 0, bottom: 0, left: 0 });
  for (let x = 0; x < w; x++) {
    const edge = 10 + Math.floor((6 * x) / w);
    for (let y = 0; y < edge; y++) { const i = (y * w + x) * 4; px[i] = 90; px[i + 1] = 60; px[i + 2] = 40; }
  }
  const t = paperTrim(px, w, h);
  assert.ok(t.top >= 15 && t.top <= 17, `top ${t.top}`);
  assert.equal(t.bottom, 0);
});
