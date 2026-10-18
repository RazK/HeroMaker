/**
 * Renders a Hero Story Film or Hero Greeting to an MP4, frame by frame.
 *
 * The page is stepped, not recorded: `__film.frame(t)` draws the frame at time
 * t, the canvas is read back, and the soundtrack is rendered separately by the
 * page's own OfflineAudioContext — the same score the live player schedules.
 * So the result is perfectly smooth however slow the machine (SwiftShader in a
 * sandbox renders a few frames a second), and identical run to run.
 *
 * This is also the shape of a server-side renderer: headless Chromium, one
 * page, one hero, ~$0 of GPU-less CPU per film.
 *
 *   node tools/render-film.mjs out.mp4 --page=film --story=birthday \
 *     --vrm=/api/files/<user>/<creation>/opt_avatar.vrm --name="Blue Bolt" --artist=Maya --age=6 \
 *     --files=<dir mirroring /api/files> --fonts=<dir of Google Fonts files>
 *
 * Flags: --url (dev server, default http://127.0.0.1:4192) --fps=30 --w=720 --h=1280
 *        --stills=1.5,9,20 (also save PNGs at those seconds) --t0/--t1 (render a slice)
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()

const out = process.argv[2]
if (!out || out.startsWith('--')) { console.error('usage: render-film.mjs out.mp4 [--flags]'); process.exit(2) }
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const base = flag('url', 'http://127.0.0.1:4192')
const page_ = flag('page', 'film')
const fps = Number(flag('fps', 30))
const W = Number(flag('w', 720)), H = Number(flag('h', 1280))
const files = flag('files', '')
const fontsDir = flag('fonts', '')
const FFMPEG = process.env.FFMPEG ?? flag('ffmpeg', 'ffmpeg')

const q = new URLSearchParams({ render: '1', w: String(W), h: String(H) })
for (const k of ['vrm', 'name', 'artist', 'age', 'story', 'occasion', 'to', 'from', 'link']) {
  const v = flag(k, null)
  if (v !== null) q.set(k, v)
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()) })

// The hero's files, served from a local mirror of /api/files exactly as the
// backend would — the page asks for the same same-origin URLs it would in prod.
if (files) {
  await page.route('**/api/files/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/api\/files\//, ''))
    const p = path.join(files, rel)
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'not found' })
    const type = p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.png') ? 'image/png' : 'application/octet-stream'
    return route.fulfill({ status: 200, body: fs.readFileSync(p), contentType: type })
  })
}
// Google Fonts from a local copy, for sandboxes whose browser cannot reach them.
if (fontsDir) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(fontsDir, 'fonts.css'), 'utf8') }))
  await page.route('https://fonts.gstatic.com/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1).replace(/\//g, '_')
    const p = path.join(fontsDir, name)
    return fs.existsSync(p) ? route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(p) }) : route.abort()
  })
}

const url = `${base}/${page_}.html?${q}`
console.log(url)
await page.goto(url, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 300000 })
const err = await page.evaluate(() => window.__error)
if (err) { console.error(err); process.exit(1) }

const duration = await page.evaluate(() => window.__film.duration)
const t0 = Number(flag('t0', 0)), t1 = Math.min(duration, Number(flag('t1', duration)))
const total = Math.round((t1 - t0) * fps)
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'))
console.log(`"${await page.evaluate(() => window.__film.title)}": ${duration.toFixed(1)}s, rendering ${total} frames at ${fps}fps`)

const stills = flag('stills', '').split(',').filter(Boolean).map(Number)
const stillDir = flag('stilldir', path.dirname(out))
const stem = path.basename(out).replace(/\.[^.]+$/, '')
// Warm up: the first frames compile shaders and settle the spring bones.
for (let i = 0; i < 6; i++) await page.evaluate((t) => window.__film.frame(t), Math.max(0, t0 - (6 - i) / fps))

const started = Date.now()
let nextStill = 0
stills.sort((a, b) => a - b)
for (let i = 0; i < total; i++) {
  const t = t0 + i / fps
  const data = await page.evaluate((tt) => { window.__film.frame(tt); return window.__film.jpeg(0.94) }, t)
  fs.writeFileSync(path.join(frameDir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'))
  while (nextStill < stills.length && t + 1e-6 >= stills[nextStill]) {
    const png = await page.evaluate(() => window.__film.png())
    const name = path.join(stillDir, `${stem}-${String(stills[nextStill]).replace('.', '_')}s.png`)
    fs.writeFileSync(name, Buffer.from(png.split(',')[1], 'base64'))
    console.log(`\n  still ${name}`)
    nextStill++
  }
  if (i % 30 === 0) {
    const rate = (i + 1) / ((Date.now() - started) / 1000)
    process.stdout.write(`\r  frame ${i}/${total}  ${rate.toFixed(1)} fps  eta ${((total - i) / rate / 60).toFixed(1)} min   `)
  }
}
console.log(`\r  frame ${total}/${total} in ${((Date.now() - started) / 1000).toFixed(0)}s                     `)

const wav = path.join(frameDir, 'audio.wav')
fs.writeFileSync(wav, Buffer.from(await page.evaluate(() => window.__film.wav()), 'base64'))
await browser.close()

fs.mkdirSync(path.dirname(out), { recursive: true })
execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
  '-framerate', String(fps), '-i', path.join(frameDir, 'f%05d.jpg'),
  '-ss', String(t0), '-t', String(t1 - t0), '-i', wav,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  // Phone speakers and social feeds expect about -16 LUFS; the synth mixes well below that.
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-shortest', '-movflags', '+faststart', out])
fs.rmSync(frameDir, { recursive: true, force: true })
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
