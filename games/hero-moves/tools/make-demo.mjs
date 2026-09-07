import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The whole walkthrough, in one file.
 *
 * Records every screen the game has, at one, two and three players, on a
 * desktop viewport and a phone one, and joins them onto a single canvas. Each
 * segment is a real playthrough against a rendered camera feed — nothing here
 * is a mock-up or a still.
 *
 * Usage: make-demo.mjs OUT.mp4 [--feeds=/tmp/party] [--url=...] [--only=a,b]
 */
const out = process.argv[2] ?? '/tmp/hero-moves-party.mp4'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feeds = flag('feeds', '/tmp/party')
const base = flag('url', 'http://127.0.0.1:5183')
const work = flag('work', '/tmp/demo')
const only = flag('only', '').split(',').filter(Boolean)

const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')
const W = 1280, H = 720

/**
 * Order matters: the tour first, because it is the screen a player meets, and
 * because it is where every hero gets shown. Then a full three-player round
 * including a pause, then a phone, then a solo run.
 */
const SEGMENTS = [
  {
    id: 'tour', label: 'Menu — 1, 2 or 3 players, any hero',
    args: ['--tour', '--players=3', `--video=${feeds}/p3.y4m`, '--menu=3', '--w=1280', '--h=720'],
  },
  {
    id: 'three', label: 'Three players — desktop',
    args: ['--players=3', '--picks=0,1,2', `--video=${feeds}/p3.y4m`, '--pause',
      '--menu=5', '--w=1280', '--h=720'],
  },
  {
    id: 'phone', label: 'Two players — phone',
    args: ['--players=2', '--picks=3,4', `--video=${feeds}/p2.y4m`,
      '--menu=5', '--w=390', '--h=844'],
  },
  {
    id: 'solo', label: 'One player — desktop',
    args: ['--players=1', '--picks=5', `--video=${feeds}/p1.y4m`,
      '--menu=4', '--w=1280', '--h=720'],
  },
]

fs.mkdirSync(work, { recursive: true })
const made = []
for (const seg of SEGMENTS) {
  if (only.length && !only.includes(seg.id)) continue
  const raw = path.join(work, `${seg.id}.mp4`)
  console.log(`\n=== ${seg.id}: ${seg.label}`)
  execFileSync('node', ['tools/record-party.mjs', raw, `--url=${base}`,
    '--captions', `--label=${seg.label}`, ...seg.args], { stdio: 'inherit' })
  // Everything lands on the same canvas so the parts can simply be joined; a
  // phone capture is pillarboxed rather than stretched, because a demo that
  // distorts the thing it is demonstrating is worse than no demo.
  const fit = path.join(work, `${seg.id}-fit.mp4`)
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
           `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x150f26,fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-crf', '20', '-an', fit], { stdio: 'inherit' })
  made.push(fit)
}

if (!made.length) { console.error('nothing recorded'); process.exit(1) }
const list = path.join(work, 'list.txt')
fs.writeFileSync(list, made.map((f) => `file '${f}'`).join('\n'))
fs.mkdirSync(path.dirname(out), { recursive: true })
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', out])

const secs = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'),
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
console.log(`\n${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB  ${Number(secs).toFixed(1)}s`)
