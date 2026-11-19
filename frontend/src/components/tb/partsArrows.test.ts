import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curl, MIN_LENGTH, type Point } from './partsArrows.js';

const points = (d: string): Point[] => d.slice(1).split('L').map((p) => p.split(' ').map(Number) as Point);

test('an arrow runs from near the ball to near the socket and points at the socket', () => {
  const c = curl([0, 0], [100, 0])!;
  const line = points(c.line);
  const [start, end] = [line[0], line[line.length - 1]];
  assert.ok(start[0] > 0 && start[0] <= 16 && Math.abs(start[1]) < 0.01, `starts clear of the ball: ${start}`);
  assert.ok(end[0] < 100 && end[0] >= 88 && Math.abs(end[1]) < 0.01, `ends clear of the socket: ${end}`);
  const [l, tip, r] = points(c.head);
  assert.deepEqual(tip, end);
  assert.ok(l[0] < tip[0] && r[0] < tip[0], 'the head opens back towards the ball');
  assert.ok(Math.sign(l[1] - tip[1]) !== Math.sign(r[1] - tip[1]), 'one stroke each side');
});

test('it has a loop: the curl doubles back along its way once', () => {
  const line = points(curl([0, 0], [120, 0])!.line);
  let backs = 0;
  for (let i = 1; i < line.length; i++) if (line[i][0] < line[i - 1][0] - 0.01) backs++;
  assert.ok(backs >= 2, `goes backwards for a while (${backs} steps)`);
  // ... on one side of the line only, the side asked for.
  assert.ok(line.every(([, y]) => y >= -0.01));
  assert.ok(points(curl([0, 0], [120, 0], -1)!.line).every(([, y]) => y <= 0.01));
});

test('any direction: it turns with the points', () => {
  const down = points(curl([50, 0], [50, 100])!.line);
  const end = down[down.length - 1];
  assert.ok(Math.abs(end[0] - 50) < 0.01 && end[1] > 88 && end[1] < 100);
});

test('too short to read: no arrow', () => {
  assert.equal(curl([0, 0], [MIN_LENGTH - 1, 0]), null);
  assert.equal(curl([0, 0], [0, 0]), null);
  assert.equal(curl([0, 0], [NaN, 0]), null);
});

test('the wiggle breathes the loop, not the ends', () => {
  const still = points(curl([0, 0], [100, 0], 1, 0)!.line);
  const lively = points(curl([0, 0], [100, 0], 1, 0.15)!.line);
  assert.deepEqual(lively[0], still[0]);
  assert.deepEqual(lively[lively.length - 1], still[still.length - 1]);
  const height = (pts: Point[]) => Math.max(...pts.map(([, y]) => y));
  assert.ok(height(lively) > height(still));
});
