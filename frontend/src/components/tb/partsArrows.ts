/**
 * The curly arrows of the toy taken apart (the "Hero · toy taken apart"
 * board): one from each piece's ball to the socket it clicks into, drawn in
 * sketch style with a loop in the middle, wiggling.
 *
 * Plain geometry on screen points, so it is tested alone (partsArrows.test.ts).
 * PartsViewer projects the 3D joints to the screen every frame and writes the
 * two paths this returns into an SVG over the canvas.
 */

export type Point = [number, number];

/** The app's palette, one colour per arrow, in turn. */
export const ARROW_COLOURS = ['var(--tb-grape)', 'var(--tb-green)', 'var(--tb-rumble)', 'var(--tb-dance)', 'var(--tb-sun-deep)', 'var(--tb-grape-deep)'];

/** Shorter than this on screen (px), there is no room for an arrow. */
export const MIN_LENGTH = 26;

export interface Curl {
  /** The curl itself, from near the ball to near the socket. */
  line: string;
  /** The arrowhead at the socket. */
  head: string;
}

/**
 * An arrow from `from` (the ball, on the piece) to `to` (the socket, on what it
 * clicks into): a straight run with one loop in its middle, on side `side`
 * (1 or -1), the loop breathing with `wiggle` (0 still, about 0.15 lively).
 * Null when the two points are too near for an arrow to read.
 */
export function curl(from: Point, to: Point, side: 1 | -1 = 1, wiggle = 0): Curl | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const full = Math.hypot(dx, dy);
  if (!(full >= MIN_LENGTH)) return null;
  const ux = dx / full;
  const uy = dy / full;
  // Clear of the ball at the start and of the socket at the end.
  const lead = Math.min(0.16 * full, 12);
  const tail = Math.min(0.12 * full, 8);
  const sx = from[0] + ux * lead;
  const sy = from[1] + uy * lead;
  const length = full - lead - tail;
  // A trochoid with one turn, its loop in the middle: the radius fades in and
  // out (sin^2), so the arrow leaves the ball and reaches the socket heading
  // straight. A loop needs a radius over length / 2pi; capped so a long arrow
  // keeps a neat loop.
  const r = Math.min(0.2 * length, 40) * (1 + wiggle);
  const nx = -uy * side;
  const ny = ux * side;
  const at = (t: number): Point => {
    const a = 2 * Math.PI * t - Math.PI;
    const w = Math.sin(Math.PI * t) ** 2;
    const along = t * length - r * w * Math.sin(a);
    const across = r * w * (1 - Math.cos(a));
    return [sx + ux * along + nx * across, sy + uy * along + ny * across];
  };
  const steps = 32;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push(at(i / steps));
  const line = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
  // The head: two strokes back from the tip, along the curve's last stretch.
  const tip = pts[steps];
  const back = at(0.94);
  const bl = Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1;
  const bx = (back[0] - tip[0]) / bl;
  const by = (back[1] - tip[1]) / bl;
  const size = Math.min(10, 0.3 * length + 4);
  const wing = (turn: number): Point => {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return [tip[0] + size * (bx * c - by * s), tip[1] + size * (bx * s + by * c)];
  };
  const [l, rr] = [wing(0.5), wing(-0.5)];
  const head = `M${l[0].toFixed(1)} ${l[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}L${rr[0].toFixed(1)} ${rr[1].toFixed(1)}`;
  return { line, head };
}
