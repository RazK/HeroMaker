/**
 * Render the class stage to frames, offline and frame-stepped.
 *
 *   CLASS_FILES=<dir> node tools/record-class.mjs <tv|phone> <out-dir> [workers=4] [fps=30]
 *
 * Twelve skinned heroes take seconds a frame under SwiftShader, so nothing is
 * captured in real time: the page runs with ?record=1 and is told the time of
 * every frame (__setTime), which makes the video exactly as smooth as the fps
 * asked for however slow the machine. Frames are split across several browsers
 * (SwiftShader renders one context on roughly one core); each worker first
 * steps through the second before its first frame without drawing, so spring
 * bones arrive settled and the seams do not show.
 *
 * Writes <out-dir>/f%05d.jpg. Encode with ffmpeg afterwards (see make-class-video.sh).
 */
import fs from 'node:fs'
import { launch, openStage } from './classlib.mjs'

const [kind = 'tv', out = 'class-frames', workersArg = '4', fpsArg = '30'] = process.argv.slice(2)
const workers = Number(workersArg), fps = Number(fpsArg)
const base = process.env.CLASS_URL ?? 'http://127.0.0.1:4194/class-stage.html'
const size = kind === 'phone' ? { width: 720, height: 1280 } : { width: 1280, height: 720 }
const from = Number(process.env.FROM ?? 0)
fs.mkdirSync(out, { recursive: true })

/**
 * The phone cut's story after the show: a parent taps their child's hero,
 * watches it dance, asks for another move, and shares the link.
 */
const TAP = { hero: 0, at: 10.6, dur: 0.5 }
const PHONE_EVENTS = [
  { t: TAP.at + 0.3, js: (t) => `__openSolo(${TAP.hero}, ${t})` },
  { t: 13.0, js: () => `__press('more', true)` },
  { t: 13.2, js: (t) => `__press('more', false); __soloMove(${t}, 'backflip')` },
  { t: 16.4, js: () => `__press('share', true)` },
  { t: 16.6, js: (t) => `__press('share', false); __share(${t})` },
]

async function worker(k, frames) {
  if (!frames.length) return
  const browser = await launch()
  const { page } = await openStage(browser, { url: `${base}?record=1&layout=${kind}`, ...size })
  const duration = await page.evaluate(() => window.__duration)
  const events = kind === 'phone' ? PHONE_EVENTS.map((e) => ({ ...e })) : []
  let tapPoint = null
  const first = frames[0] / fps
  const warm = Math.max(0, first - 1.0)
  const step = async (t, draw) => {
    for (const e of events) {
      if (!e.done && e.t <= t) { e.done = true; await page.evaluate(e.js(e.t)) }
    }
    if (kind === 'phone') {
      const into = t - TAP.at
      if (into >= -0.05 && !tapPoint) tapPoint = await page.evaluate((i) => window.__heroPoint(i), TAP.hero)
      const tk = into >= 0 && into <= TAP.dur ? into / TAP.dur : -1
      if (tapPoint) await page.evaluate(([x, y, q]) => window.__tap(x, y, q), [tapPoint.x, tapPoint.y, tk])
    }
    await page.evaluate(([x, d]) => window.__setTime(x, d), [t, draw])
  }
  for (let t = warm; t < first - 1e-6; t += 1 / fps) await step(t, false)
  const t0 = Date.now()
  for (const f of frames) {
    await step(f / fps, true)
    await page.screenshot({ path: `${out}/f${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94 })
    if (f % 30 === 0) console.log(`worker ${k}: frame ${f} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
  await browser.close()
  return duration
}

// Work out the length from the page itself, once.
const probe = await launch()
const { page: p0, wall } = await openStage(probe, { url: `${base}?record=1&layout=${kind}`, ...size })
const perf = await p0.evaluate(() => window.__perf)
const showLen = await p0.evaluate(() => window.__duration)
// The show's timeline, for whatever scores the video (pops, solos, confetti all land on it).
const program = await p0.evaluate(() => { const p = window.__program; return { duration: p.duration, popAt: p.popAt, spots: p.spots, captions: p.captions, confetti: p.confetti } })
fs.writeFileSync(`${out}/program.json`, JSON.stringify({ ...program, tap: kind === 'phone' ? TAP : null, events: kind === 'phone' ? PHONE_EVENTS.map((e) => e.t) : [] }, null, 1))
await probe.close()
const seconds = Number(process.env.SECONDS ?? (kind === 'phone' ? 20.5 : showLen))
const total = Math.round(seconds * fps)
console.log(`${kind}: ${seconds.toFixed(1)} s, ${total} frames, ${workers} workers; page ready in ${wall} ms`, JSON.stringify(perf))
const all = Array.from({ length: total }, (_, i) => i).filter((f) => f / fps >= from)
const chunk = Math.ceil(all.length / workers)
const t0 = Date.now()
await Promise.all(Array.from({ length: workers }, (_, k) => worker(k, all.slice(k * chunk, (k + 1) * chunk))))
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
