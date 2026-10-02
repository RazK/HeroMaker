// Cut the robot's raw demo recording into a ~60-second reel, captioned twice.
//
//   node e2e/cut-demo.mjs e2e/out     # reads demo.webm + marks.json, writes
//                                     # demo-en.mp4, demo-he.mp4, demo-full.mp4
//
// Each segment runs between two marks the robot recorded (optionally offset,
// "play+6" = six seconds after `play`) and is squeezed or stretched to its
// target length: waiting fast-forwards, the hero's performance plays in real
// time. A segment whose marks are missing is skipped rather than failing.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'e2e/out';
const marks = JSON.parse(readFileSync(path.join(OUT, 'marks.json'), 'utf8'));
const IN = path.join(OUT, 'demo.webm');

// [from, to, seconds on screen, English caption, Hebrew caption]. People move
// at their own speed; only the waiting is squeezed.
const PLAN = [
  ['landing', 'gallery_end', 5, "Every child's drawing becomes a 3D hero", 'כל ציור של ילד הופך לגיבור תלת־ממדי'],
  ['signup_start', 'signup_end', 7, 'Sign up in seconds', 'נרשמים בכמה שניות'],
  ['buy_start', 'checkout', 4, 'Pick a credit pack', 'בוחרים חבילת קרדיטים'],
  ['checkout', 'paid', 10, 'Secure checkout by Lemon Squeezy', 'תשלום מאובטח ב-Lemon Squeezy'],
  ['paid', 'credits_end', 4, 'Credits arrive instantly', 'הקרדיטים נכנסים מיד'],
  ['upload', 'pipeline_start', 3, "Upload a child's drawing", 'מעלים ציור של ילד'],
  ['pipeline_start', 'pipeline_end', 6, 'AI paints it, builds it in 3D, and rigs it', 'ה-AI מצייר, בונה בתלת־ממד ומוסיף שלד'],
  ['pipeline_end', 'ready_end', 5, 'Your hero is ready!', 'הגיבור מוכן!'],
  ['game_ready', 'play', 3, 'Now play with it', 'ועכשיו משחקים איתו'],
  ['play', 'play+10', 10, 'Build a routine and watch it perform', 'בונים רצף תנועות וצופים בהופעה'],
  ['end-3', 'end', 3, 'HeroMaker', 'HeroMaker'],
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

// 1. One silent cut on the video's own clock, a segment at a time. Cutting
// all of them in one ffmpeg graph held frames for every segment in memory at
// once and the runner was killed mid-cut, so each is its own small encode and
// the pieces are joined without re-encoding.
const shown = [];  // [startSec, endSec, en, he] on the output timeline
const pieces = [];
let clock = 0;
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-an'];
for (const [from, to, want, en, he] of PLAN) {
  const a = at(from), b = at(to);
  if (a === undefined || b === undefined || b <= a) { console.log(`skip ${from} -> ${to}`); continue; }
  // Squeeze waits, never slow a moment down: a beat shorter than its slot
  // plays at its own length.
  const secs = Math.min(want, b - a);
  const speed = (b - a) / secs;
  const piece = path.join(OUT, `piece-${pieces.length}.mp4`);
  // The mark square lives in the bottom-right corner; crop it out.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', IN,
    '-vf', `setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=30,crop=iw:ih-24:0:0,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    ...ENC, piece]);
  pieces.push(piece);
  shown.push([clock, clock + secs, en, he]);
  clock += secs;
  console.log(`${from} -> ${to}: ${(b - a).toFixed(1)}s -> ${secs.toFixed(1)}s (${speed.toFixed(1)}x)`);
}
if (!pieces.length) throw new Error('no segments: marks.json has none of the planned marks');
const list = path.join(OUT, 'pieces.txt');
writeFileSync(list, pieces.map((p) => `file '${path.resolve(p)}'`).join('\n'));
const CUT = path.join(OUT, 'demo-cut.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', CUT]);
for (const p of pieces) unlinkSync(p);

// 2. Captions are rendered by a browser, so Hebrew is shaped and ordered
// right to left exactly as on the site, then laid over the cut per language.
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
  '-of', 'csv=p=0', CUT]).toString().trim().split(',').map(Number);
const [W, H] = probe;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: 400 } });
async function render(text, rtl, file) {
  await page.setContent(`<html><head><link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Heebo:wght@800&display=block"></head>
    <body style="margin:0;background:transparent">
    <div id="c" dir="${rtl ? 'rtl' : 'ltr'}" style="display:inline-block;max-width:${Math.round(W * 0.86)}px;
      padding:${Math.round(W * 0.028)}px ${Math.round(W * 0.05)}px;border-radius:${Math.round(W * 0.04)}px;
      background:rgba(12,12,32,.86);color:#fff;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.45);
      font:800 ${Math.round(W * 0.058)}px/1.25 'Heebo','Rubik','Noto Sans Hebrew','Segoe UI',Arial,sans-serif">${text}</div>
    </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#c').screenshot({ path: file, omitBackground: true });
}
for (const lang of ['en', 'he']) {
  const inputs = ['-i', CUT];
  const overlays = [];
  let prev = '0:v';
  for (let i = 0; i < shown.length; i++) {
    const [t0, t1, en, he] = shown[i];
    const png = path.join(OUT, `cap-${lang}-${i}.png`);
    await render(lang === 'he' ? he : en, lang === 'he', png);
    inputs.push('-i', png);
    const out = i === shown.length - 1 ? 'v' : `o${i}`;
    overlays.push(`[${prev}][${i + 1}:v]overlay=(W-w)/2:H-h-${Math.round(H * 0.07)}:enable='between(t,${(t0 + 0.15).toFixed(2)},${(t1 - 0.1).toFixed(2)})'[${out}]`);
    prev = out;
  }
  const file = path.join(OUT, `demo-${lang}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', overlays.join(';'), '-map', '[v]',
    ...ENC, '-movflags', '+faststart', file]);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  console.log(`${path.basename(file)}: ${Number(dur).toFixed(1)}s, ${W}x${H}`);
}
await browser.close();
