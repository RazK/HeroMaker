// Cut the robot's raw demo recording into a ~30-second highlight reel.
//
//   node e2e/cut-demo.mjs e2e/out     # reads demo.webm + marks.json
//                                     # writes demo.mp4 (reel) and demo-full.mp4
//
// Each segment runs between two marks the robot recorded (optionally offset,
// "play+6" = six seconds after `play`) and is squeezed or stretched to its
// target length: waiting fast-forwards, the hero's performance plays in real
// time. A segment whose marks are missing is skipped rather than failing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'e2e/out';
const marks = JSON.parse(readFileSync(path.join(OUT, 'marks.json'), 'utf8'));
const IN = path.join(OUT, 'demo.webm');

const PLAN = [
  ['landing', 'gallery_end', 3.5],        // the gallery
  ['signup_start', 'signup_end', 2.5],    // sign up
  ['buy_start', 'checkout', 2],           // pick a pack
  ['checkout', 'paid', 3],                // pay on Lemon Squeezy
  ['paid', 'credits_end', 2.5],           // credits arrive
  ['upload', 'pipeline_start', 2],        // upload a drawing, press Go
  ['pipeline_start', 'pipeline_end', 3.5],// the AI pipeline, minutes -> seconds
  ['pipeline_end', 'ready_end', 2],       // the finished hero
  ['game_ready', 'play', 1.5],            // build a routine
  ['play', 'play+6', 6],                  // the hero performs, real time
  ['end-3', 'end', 1.5],                  // title
];

// Must match MARK_ORDER / MARK_COLORS in staging-robot.mjs.
const MARK_ORDER = ['landing', 'gallery_end', 'signup_start', 'signup_end', 'buy_start', 'checkout',
  'paid', 'credits', 'credits_end', 'upload', 'pipeline_start', 'pipeline_end', 'ready_end',
  'game_ready', 'play', 'end'];
const MARK_COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8000', '#80ff00',
  '#0080ff', '#ff0080', '#8000ff', '#00ff80', '#800000', '#008000', '#000080', '#808000'];
const RGB = MARK_COLORS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

// Read the corner square of every frame (10 per second) and note when each
// mark's colour first appears: that is the mark on the video's own clock.
const FPS = 10;
const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', IN, '-vf', `fps=${FPS},crop=4:4:iw-6:ih-6,scale=1:1`,
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
const seen = {};
let last = -1;
for (let f = 0; f * 3 + 2 < raw.length; f++) {
  const px = [raw[f * 3], raw[f * 3 + 1], raw[f * 3 + 2]];
  let best = -1, bestD = 1e9;
  RGB.forEach((c, i) => { const d = Math.hypot(c[0] - px[0], c[1] - px[1], c[2] - px[2]); if (d < bestD) { bestD = d; best = i; } });
  // Only a new colour close to the palette counts, and marks only move forward.
  if (bestD < 60 && best > last && seen[MARK_ORDER[best]] === undefined) { seen[MARK_ORDER[best]] = f / FPS; last = best; }
}
// Marks not found in the frames are placed by their neighbours' drift.
const wall = marks;
const video = {};
for (const name of MARK_ORDER) {
  if (wall[name] === undefined) continue;
  if (seen[name] !== undefined) { video[name] = seen[name]; continue; }
  const found = MARK_ORDER.filter((n) => seen[n] !== undefined && wall[n] !== undefined);
  const prev = [...found].reverse().find((n) => wall[n] <= wall[name]);
  const drift = prev ? seen[prev] - wall[prev] : 0;
  video[name] = wall[name] + drift;
}
console.log('marks on the video clock:', JSON.stringify(Object.fromEntries(Object.entries(video).map(([k, v]) => [k, +v.toFixed(1)]))));

const at = (ref) => {
  const [name, off] = ref.split(/(?=[+-]\d)/);
  return video[name] === undefined ? undefined : video[name] + Number(off || 0);
};

const parts = [];
for (const [from, to, secs] of PLAN) {
  const a = at(from), b = at(to);
  if (a === undefined || b === undefined || b <= a) { console.log(`skip ${from} -> ${to}`); continue; }
  const speed = (b - a) / secs;
  parts.push(`[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=30[s${parts.length}]`);
  console.log(`${from} -> ${to}: ${(b - a).toFixed(1)}s -> ${secs}s (${speed.toFixed(1)}x)`);
}
if (!parts.length) throw new Error('no segments: marks.json has none of the planned marks');

const labels = parts.map((_, i) => `[s${i}]`).join('');
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', IN, '-filter_complex',
  `${parts.join(';')};${labels}concat=n=${parts.length}:v=1[v]`, '-map', '[v]', ...ENC, path.join(OUT, 'demo.mp4')]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', IN, ...ENC, path.join(OUT, 'demo-full.mp4')]);
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(OUT, 'demo.mp4')]).toString().trim();
console.log(`demo.mp4: ${Number(dur).toFixed(1)}s`);
