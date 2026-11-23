/**
 * One demo video for one flow, Raz's format (docs/RAZ_RULES.md, "Demo delivery"):
 * a full-screen text-only slide, then the real staging recording of that step,
 * at REAL speed (trimmed, never sped up). Repeat per step.
 *
 *   node marketing/demo/make-flow.mjs <flow.json> <recordingsDir> out.mp4 [--check]
 *
 * flow.json (marketing/demo/flows/):
 *   { "name": "parent-happy", "note": "Recorded on staging · real speed",
 *     "steps": [ { "say": "A parent taps Make a hero.",
 *                  "rec": "parent.webm",        // in recordingsDir
 *                  "at": "landing+0.5",          // seconds, or a robot mark (+/- seconds)
 *                  "dur": 4.5 } ] }              // seconds of real footage
 * A mark is read from <rec without extension>.marks.json, or marks.json next to it
 * (the staging robot's DEMO=1 artifact: demo.webm + marks.json).
 *
 * A slide stays up as long as it takes to read, not more: 0.8 s + 0.22 s a word,
 * between 1.5 and 2.8 s. --check prints the timeline and renders nothing.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [flowPath, recDir, out] = process.argv.slice(2)
const check = process.argv.includes('--check')
const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'))
const XF = 0.4 // film.html's crossfade: every segment overlaps the next by this much

const readFor = (text) => Math.min(2.8, Math.max(1.5, 0.8 + 0.22 * text.trim().split(/\s+/).length))
const marksCache = {}
function marksFor(rec) {
  if (marksCache[rec]) return marksCache[rec]
  const own = path.join(recDir, rec.replace(/\.[^.]+$/, '') + '.marks.json'), shared = path.join(recDir, 'marks.json')
  const f = fs.existsSync(own) ? own : fs.existsSync(shared) ? shared : null
  return (marksCache[rec] = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : {})
}
function seconds(at, rec) {
  if (typeof at === 'number') return at
  const m = /^([a-z_]+)\s*([+-]\s*[\d.]+)?$/.exec(at)
  if (!m) throw new Error(`bad "at": ${at}`)
  const base = marksFor(rec)[m[1]]
  if (base === undefined) throw new Error(`mark "${m[1]}" not in the marks of ${rec}`)
  return base + (m[2] ? +m[2].replace(/\s/g, '') : 0)
}
function probe(file) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  return { w, h }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-'))
const segments = []
let t = 0, footage = 0
const rows = []
flow.steps.forEach((s, i) => {
  const sd = s.slide ?? readFor(s.say)
  segments.push({ kind: 'slide', title: s.say, ...(i === 0 && flow.note ? { note: flow.note } : {}), dur: sd + XF })
  rows.push(`${t.toFixed(1).padStart(5)}  slide ${sd.toFixed(1)}s  "${s.say}"`)
  t += sd
  if (!s.rec) return // a slide on its own (the last word, a title)
  const file = path.join(recDir, s.rec)
  let start
  try { start = seconds(s.at ?? 0, s.rec) } catch (e) { if (!check) throw e; start = null }
  rows.push(`${t.toFixed(1).padStart(5)}  clip  ${s.dur.toFixed(1)}s  ${s.rec} @ ${start === null ? s.at + ' (no marks yet)' : start.toFixed(2)}`)
  t += s.dur; footage += s.dur
  if (check) return
  const dir = path.join(work, `c${i + 1}`)
  fs.mkdirSync(dir)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(s.dur + XF), '-i', file, '-vf', 'fps=24', path.join(dir, '%04d.png')])
  const n = fs.readdirSync(dir).length, { w, h } = probe(file)
  segments.push({ kind: 'screen', dir: `assets/c${i + 1}`, ext: 'png', n, fps: 24, from: 1, vw: w, vh: h,
    crop: s.crop || [0, 0, w, h], scale: s.scale || 0.86, dur: s.dur + XF })
})
console.log(`${flow.name}: ${t.toFixed(1)} s (${footage.toFixed(1)} s of real footage)\n${rows.join('\n')}`)
if (t > 30) console.warn(`!! over 30 s (Raz's limit, docs/ops/CADENCE.md): trim a clip`)
if (check) process.exit(0)

fs.writeFileSync(path.join(work, 'cut.json'), JSON.stringify({ name: flow.name, segments }))
const here = path.dirname(new URL(import.meta.url).pathname)
execFileSync('node', ['tools/film-record.mjs', work, path.resolve(out)], { cwd: path.join(here, '../../games/hero-moves'), stdio: 'inherit' })
