import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spreadPlan, type Vec3 } from './partsSpread.js';

/** A block of points: from `min` to `max`, then turned about Z by `turn` degrees around `about`. */
function block(min: Vec3, max: Vec3, turn = 0, about: Vec3 = [0, 0, 0], gap = 0.02): number[] {
  const out: number[] = [];
  const c = Math.cos((turn * Math.PI) / 180);
  const s = Math.sin((turn * Math.PI) / 180);
  const steps = (a: number) => Math.max(1, Math.round((max[a] - min[a]) / gap));
  for (let i = 0; i <= steps(0); i++) for (let j = 0; j <= steps(1); j++) for (let k = 0; k <= steps(2); k++) {
    const x = min[0] + ((max[0] - min[0]) * i) / steps(0) - about[0];
    const y = min[1] + ((max[1] - min[1]) * j) / steps(1) - about[1];
    const z = min[2] + ((max[2] - min[2]) * k) / steps(2);
    out.push(about[0] + x * c - y * s, about[1] + x * s + y * c, z);
  }
  return out;
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

// A person: the pieces are given out of order on purpose, and have no names.
const torso = () => block([-0.2, 0.6, -0.1], [0.2, 1.2, 0.1]);
const head = () => block([-0.15, 1.2, -0.15], [0.15, 1.5, 0.15]);
const leg = (side: 1 | -1) => block([side > 0 ? 0.04 : -0.18, 0, -0.07], [side > 0 ? 0.18 : -0.04, 0.6, 0.07]);

test('T-pose: the head goes up, the arms go sideways, the legs go down and a little out, the body stays', () => {
  const arm = (side: 1 | -1) => block([side > 0 ? 0.2 : -0.8, 1.05, -0.05], [side > 0 ? 0.8 : -0.2, 1.15, 0.05]);
  const plan = spreadPlan([leg(1), arm(-1), head(), torso(), arm(1), leg(-1)]);
  const [legL, armR, top, body, armL, legR] = [0, 1, 2, 3, 4, 5];

  assert.equal(plan.body, body);
  assert.deepEqual(plan.offset[body], [0, 0, 0]);
  assert.ok(dot(plan.dir[top], [0, 1, 0]) > 0.995, `head ${plan.dir[top]}`);
  assert.ok(dot(plan.dir[armL], [1, 0, 0]) > 0.995, `arm ${plan.dir[armL]}`);
  assert.ok(dot(plan.dir[armR], [-1, 0, 0]) > 0.995, `arm ${plan.dir[armR]}`);
  for (const [i, out] of [[legL, 1], [legR, -1]] as const) {
    const d = plan.dir[i];
    assert.ok(d[1] < -0.9, `leg goes down ${d}`);
    assert.ok(d[0] * out > 0.15 && d[0] * out < 0.45, `leg leans out a little ${d}`);
  }
  // Every piece but the body clears it, and each joint is at the end towards the body.
  [legL, armR, top, armL, legR].forEach((i) => {
    assert.equal(plan.parent[i], body);
    assert.ok(length(plan.offset[i]) > 0.15, `piece ${i} travels ${length(plan.offset[i])}`);
  });
  assert.ok(Math.abs(plan.joint[armL][0] - 0.2) < 0.05 && Math.abs(plan.joint[armL][1] - 1.1) < 0.05);
  assert.ok(Math.abs(plan.joint[top][1] - 1.2) < 0.05);
  assert.ok(Math.abs(plan.joint[legL][1] - 0.6) < 0.05);
});

test('A-pose: an arm goes the way the arm points, down and out', () => {
  const arm = (side: 1 | -1) => block(
    [side > 0 ? 0.2 : -0.8, 1.05, -0.05], [side > 0 ? 0.8 : -0.2, 1.15, 0.05],
    side > 0 ? -45 : 45, [side > 0 ? 0.2 : -0.2, 1.1, 0],
  );
  const plan = spreadPlan([torso(), head(), arm(1), arm(-1), leg(1), leg(-1)]);
  assert.equal(plan.body, 0);
  assert.ok(dot(plan.dir[1], [0, 1, 0]) > 0.995, `head ${plan.dir[1]}`);
  for (const [i, out] of [[2, 1], [3, -1]] as const) {
    const d = plan.dir[i];
    const along: Vec3 = [out * Math.SQRT1_2, -Math.SQRT1_2, 0];
    assert.ok(dot(d, along) > 0.95, `arm goes along itself ${d}`);
    assert.ok(d[0] * out > 0.5 && d[1] < -0.4, `arm goes down and out ${d}`);
  }
  assert.ok(plan.dir[4][1] < -0.9 && plan.dir[4][0] > 0.15);
  assert.ok(plan.dir[5][1] < -0.9 && plan.dir[5][0] < -0.15);
});

test('Four legs and a tail: the legs go down and apart, the tail goes back, the head goes forward', () => {
  const trunk = block([-0.15, 0.5, -0.5], [0.15, 0.8, 0.5]);
  const top = block([-0.12, 0.6, 0.5], [0.12, 1.0, 0.8]);
  const tail = block([-0.03, 0.7, -0.9], [0.03, 0.76, -0.5]);
  const foot = (x: 1 | -1, z: 1 | -1) => block(
    [x > 0 ? 0.05 : -0.15, 0, z > 0 ? 0.3 : -0.45], [x > 0 ? 0.15 : -0.05, 0.5, z > 0 ? 0.45 : -0.3],
  );
  const plan = spreadPlan([foot(1, 1), foot(-1, 1), tail, trunk, top, foot(1, -1), foot(-1, -1)]);
  assert.equal(plan.body, 3);
  assert.deepEqual(plan.offset[3], [0, 0, 0]);
  for (const [i, x, z] of [[0, 1, 1], [1, -1, 1], [5, 1, -1], [6, -1, -1]] as const) {
    const d = plan.dir[i];
    assert.ok(d[1] < -0.9, `leg goes down ${d}`);
    assert.ok(d[0] * x > 0.03, `leg leans out ${d}`);
    assert.ok(d[2] * z > 0.15, `front and hind legs lean apart ${d}`);
  }
  assert.ok(dot(plan.dir[2], [0, 0, -1]) > 0.97, `tail ${plan.dir[2]}`);
  assert.ok(plan.dir[4][2] > 0.5 && plan.dir[4][1] >= 0, `head ${plan.dir[4]}`);
});

test('A piece that does not reach the body hangs from the piece it touches, and goes with it', () => {
  const arm = block([0.2, 1.05, -0.05], [0.6, 1.15, 0.05]);
  const hand = block([0.6, 1.04, -0.06], [0.75, 1.16, 0.06]);
  const armR = block([-0.8, 1.05, -0.05], [-0.2, 1.15, 0.05]);
  const plan = spreadPlan([torso(), head(), arm, hand, armR, leg(1), leg(-1)]);
  assert.equal(plan.body, 0);
  assert.equal(plan.parent[2], 0);
  assert.equal(plan.parent[3], 2);
  assert.ok(dot(plan.dir[3], [1, 0, 0]) > 0.99, `hand ${plan.dir[3]}`);
  assert.ok(plan.offset[3][0] > plan.offset[2][0] + 0.05, 'the hand goes further than its arm');
});

test('The size and place of the figure do not change the plan', () => {
  const arm = (side: 1 | -1) => block([side > 0 ? 0.2 : -0.8, 1.05, -0.05], [side > 0 ? 0.8 : -0.2, 1.15, 0.05]);
  const clouds = [torso(), head(), arm(1), arm(-1), leg(1), leg(-1)];
  const small = spreadPlan(clouds);
  const big = spreadPlan(clouds.map((c) => c.map((v, i) => v * 150 + (i % 3 === 0 ? 40 : -7))));
  assert.equal(big.body, small.body);
  small.dir.forEach((d, i) => {
    assert.ok(length([d[0] - big.dir[i][0], d[1] - big.dir[i][1], d[2] - big.dir[i][2]]) < 0.02, `piece ${i}`);
    assert.ok(Math.abs(length(big.offset[i]) - 150 * length(small.offset[i])) < 150 * 0.01, `piece ${i} travel`);
  });
});
