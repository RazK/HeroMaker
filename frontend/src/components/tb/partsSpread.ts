/**
 * Which way each piece of a cut figure moves when the figure is pulled apart.
 *
 * The rule reads only the shapes, never a piece's name, so it holds for any
 * model: a person, an animal, a cloud with legs.
 *
 *  1. The body is the piece that touches the most other pieces. It stays still.
 *     (Ties: the one with the most contact, then the largest.)
 *  2. A piece's joint is where it meets the body: the middle of its points
 *     that lie against the body (on a ball joint, the ball end). A piece that
 *     does not reach the body hangs from the piece it does touch (a hand on an
 *     arm), and moves with it.
 *  3. A piece travels along its own axis, from its joint to its middle. So a
 *     head goes up, an arm goes the way the arm points, a tail goes back.
 *  4. Where two pieces would travel side by side (two legs), each also leans
 *     a little away from the body's middle, sideways only. A piece that already
 *     points away from the middle (an arm) gets no lean.
 *  5. How far: a share of the piece's own length plus a fixed step, so a long
 *     piece clears the body as surely as a short one.
 *
 * Y is up, as in glTF. No three.js here: plain numbers, so it is tested alone
 * (partsSpread.test.ts).
 */

export type Vec3 = [number, number, number];

export interface SpreadPlan {
  /** The piece that stays still. */
  body: number;
  /** The piece each piece hangs from (-1 for the body). */
  parent: number[];
  /** Where each piece meets its parent (for the body: its own middle). */
  joint: Vec3[];
  /** The way each piece travels, a unit vector (the body: zero). */
  dir: Vec3[];
  /** Where each piece stands when fully apart, from its place when together. */
  offset: Vec3[];
}

/** Two pieces touch when points of theirs are this near: a share of the figure's size. */
const CONTACT = 0.012;
/** Fewer shared grid cells than this is a brush (hair on a shoulder), not a meeting. */
const MIN_PATCH = 3;
/** At most this many points of a piece are read; a dense piece is thinned evenly. */
const MAX_POINTS = 20000;
/** The lean away from the body's middle, as a share of the travel along the axis. */
const LEAN = 0.3;
/** The lean starts and is whole at these shares of the body's half width. */
const LEAN_FROM = 0.1;
const LEAN_FULL = 0.3;
/** Fully apart, a piece has moved this share of its own length, plus this share of the figure's size. */
const TRAVEL_LENGTH = 0.25;
const TRAVEL_STEP = 0.06;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 | null => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null;
};
const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / Math.max(1e-12, to - from)));
  return t * t * (3 - 2 * t);
};

interface Piece {
  /** The points read (x, y, z, x, y, z, …). */
  points: Float64Array;
  min: Vec3;
  max: Vec3;
  middle: Vec3;
  /** Grid cells the piece has points in, and the sum and count of the points in each. */
  cells: Int32Array;
  sums: Float64Array;
}

/**
 * @param clouds each piece's points (x, y, z, x, y, z, …), all in one space.
 */
export function spreadPlan(clouds: ArrayLike<number>[]): SpreadPlan {
  const n = clouds.length;
  const zero = (): Vec3 => [0, 0, 0];
  if (!n) return { body: -1, parent: [], joint: [], dir: [], offset: [] };

  // The points to read, each piece's box and middle, and the figure's size.
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const pieces: Piece[] = clouds.map((cloud) => {
    const count = Math.floor(cloud.length / 3);
    const step = Math.max(1, Math.ceil(count / MAX_POINTS));
    const points = new Float64Array(Math.ceil(count / step) * 3);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const sum = zero();
    let k = 0;
    for (let i = 0; i < count; i += step) {
      for (let a = 0; a < 3; a++) {
        const v = cloud[i * 3 + a];
        points[k * 3 + a] = v;
        sum[a] += v;
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
      k++;
    }
    for (let a = 0; a < 3; a++) {
      if (min[a] < lo[a]) lo[a] = min[a];
      if (max[a] > hi[a]) hi[a] = max[a];
    }
    const middle: Vec3 = k ? [sum[0] / k, sum[1] / k, sum[2] / k] : zero();
    return { points, min, max, middle, cells: new Int32Array(0), sums: new Float64Array(0) };
  });
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);

  // A grid over the figure: each cell knows which pieces have points in it.
  const cell = CONTACT * size;
  const dims = [0, 1, 2].map((a) => Math.floor((hi[a] - lo[a]) / cell) + 3);
  const words = Math.ceil(n / 32);
  const grid = new Uint32Array(dims[0] * dims[1] * dims[2] * words);
  const at = (x: number, y: number, z: number) => x + dims[0] * (y + dims[1] * z);
  pieces.forEach((p, i) => {
    const slot = new Map<number, number>();
    const cells: number[] = [];
    const sums: number[] = [];
    for (let k = 0; k < p.points.length; k += 3) {
      const c = at(
        Math.floor((p.points[k] - lo[0]) / cell) + 1,
        Math.floor((p.points[k + 1] - lo[1]) / cell) + 1,
        Math.floor((p.points[k + 2] - lo[2]) / cell) + 1,
      );
      let s = slot.get(c);
      if (s === undefined) {
        s = cells.length;
        slot.set(c, s);
        cells.push(c);
        sums.push(0, 0, 0, 0);
        grid[c * words + (i >> 5)] |= 1 << (i & 31);
      }
      sums[s * 4] += p.points[k];
      sums[s * 4 + 1] += p.points[k + 1];
      sums[s * 4 + 2] += p.points[k + 2];
      sums[s * 4 + 3] += 1;
    }
    p.cells = Int32Array.from(cells);
    p.sums = Float64Array.from(sums);
  });

  // Where pieces meet: for each pair, how many of the first one's cells lie
  // against the second, and the sum of the first one's points in those cells.
  const patch = pieces.map(() => new Float64Array(n));
  const meet = pieces.map(() => new Float64Array(n * 4));
  const near = new Uint32Array(words);
  pieces.forEach((p, i) => {
    for (let s = 0; s < p.cells.length; s++) {
      const c = p.cells[s];
      near.fill(0);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = (c + at(dx, dy, dz)) * words;
        for (let w = 0; w < words; w++) near[w] |= grid[o + w];
      }
      for (let j = 0; j < n; j++) {
        if (j === i || !(near[j >> 5] & (1 << (j & 31)))) continue;
        patch[i][j] += 1;
        for (let a = 0; a < 4; a++) meet[i][j * 4 + a] += p.sums[s * 4 + a];
      }
    }
  });
  const touch = (i: number, j: number) => i !== j && Math.max(patch[i][j], patch[j][i]) >= MIN_PATCH;

  // The body: touches the most pieces; then the most contact; then the largest.
  const volume = (p: Piece) => (p.max[0] - p.min[0]) * (p.max[1] - p.min[1]) * (p.max[2] - p.min[2]);
  const score = pieces.map((p, i) => {
    let touching = 0;
    let contact = 0;
    for (let j = 0; j < n; j++) if (touch(i, j)) { touching++; contact += patch[i][j]; }
    return [touching, contact, volume(p)];
  });
  let body = 0;
  for (let i = 1; i < n; i++) {
    const a = score[i];
    const b = score[body];
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) body = i;
  }

  // Every other piece hangs from the body, or from the piece that leads to it.
  const parent = new Array<number>(n).fill(-2);
  parent[body] = -1;
  const order: number[] = [];
  let level = [body];
  while (level.length) {
    const next: number[] = [];
    for (let i = 0; i < n; i++) {
      if (parent[i] !== -2) continue;
      let best = -1;
      for (const j of level) if (touch(i, j) && (best < 0 || patch[i][j] > patch[i][best])) best = j;
      if (best >= 0) { parent[i] = best; next.push(i); }
    }
    order.push(...next);
    level = next;
  }
  // A piece that touches nothing hangs from the body, by its point nearest to it.
  const loose: number[] = [];
  for (let i = 0; i < n; i++) if (parent[i] === -2) { parent[i] = body; loose.push(i); order.push(i); }

  const bodyMiddle = pieces[body].middle;
  const bodyHalf = Math.max(pieces[body].max[0] - pieces[body].min[0], pieces[body].max[2] - pieces[body].min[2], 1e-9) / 2;
  const joint: Vec3[] = pieces.map((p) => [...p.middle] as Vec3);
  const dir: Vec3[] = pieces.map(zero);
  const offset: Vec3[] = pieces.map(zero);

  for (const i of order) {
    const p = pieces[i];
    const from = parent[i];
    const m = meet[i];
    if (!loose.includes(i) && m[from * 4 + 3] > 0) {
      joint[i] = [m[from * 4] / m[from * 4 + 3], m[from * 4 + 1] / m[from * 4 + 3], m[from * 4 + 2] / m[from * 4 + 3]];
    } else {
      let best = Infinity;
      for (let k = 0; k < p.points.length; k += 3) {
        const d = Math.hypot(p.points[k] - bodyMiddle[0], p.points[k + 1] - bodyMiddle[1], p.points[k + 2] - bodyMiddle[2]);
        if (d < best) { best = d; joint[i] = [p.points[k], p.points[k + 1], p.points[k + 2]]; }
      }
    }
    // The axis: from the joint to the piece's middle (a ball of a piece: away from what it hangs from).
    const axis = unit(sub(p.middle, joint[i])) ?? unit(sub(p.middle, pieces[from].middle)) ?? [0, 1, 0];
    // The lean: the level part of (joint - body's middle) that the axis does not already cover.
    const away: Vec3 = [joint[i][0] - bodyMiddle[0], 0, joint[i][2] - bodyMiddle[2]];
    const along = dot(away, axis);
    const side: Vec3 = [away[0] - along * axis[0], 0, away[2] - along * axis[2]];
    const lean = LEAN * smooth(LEAN_FROM * bodyHalf, LEAN_FULL * bodyHalf, len(side));
    const s = unit(side) ?? zero();
    const d = unit([axis[0] + lean * s[0], axis[1] + lean * s[1], axis[2] + lean * s[2]]) ?? axis;
    dir[i] = d;

    // How far: by the piece's own length along the way it goes.
    let near0 = Infinity;
    let far = -Infinity;
    for (let k = 0; k < p.points.length; k += 3) {
      const t = p.points[k] * d[0] + p.points[k + 1] * d[1] + p.points[k + 2] * d[2];
      if (t < near0) near0 = t;
      if (t > far) far = t;
    }
    const travel = TRAVEL_LENGTH * Math.max(0, far - near0) + TRAVEL_STEP * size;
    const base = offset[from];
    offset[i] = [base[0] + d[0] * travel, base[1] + d[1] * travel, base[2] + d[2] * travel];
  }

  return { body, parent, joint, dir, offset };
}
