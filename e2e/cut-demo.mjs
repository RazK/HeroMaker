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

const at = (ref) => {
  const [name, off] = ref.split(/(?=[+-]\d)/);
  return marks[name] === undefined ? undefined : marks[name] + Number(off || 0);
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
