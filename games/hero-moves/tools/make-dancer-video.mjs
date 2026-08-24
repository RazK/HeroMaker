import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Renders the stand-in dancer to a video Chromium can serve as a fake camera.
 *
 * Produces a .y4m for `--use-file-for-fake-video-capture` and an .mp4 for
 * looking at. Frames are stepped explicitly rather than captured in real time,
 * so the clip is identical on every run and does not depend on how fast this
 * machine renders.
 *
 * Usage: make-dancer-video.mjs [outDir] [--avatar=Gingerella] [--fps=25] [--loops=1]
 */
const outDir = process.argv[2] ?? '/tmp/dancer'
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : fallback
}
const avatar = flag('avatar', 'Gingerella')
const fps = Number(flag('fps', 25))
const loops = Number(flag('loops', 1))
const base = flag('url', 'http://127.0.0.1:5183')
const W = 640, H = 480

// Playwright ships a stripped ffmpeg with no image decoders; use a full one.
const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')

fs.mkdirSync(outDir, { recursive: true })
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dancer-frames-'))

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const url = `${base}/dancer.html?a=${encodeURIComponent(avatar)}&w=${W}&h=${H}&${flag('extra', '')}`
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })

const duration = await page.evaluate(() => window.__duration)
const total = Math.round(duration * loops * fps)
console.log(`rendering ${total} frames (${(duration * loops).toFixed(1)}s @ ${fps}fps) of ${avatar}`)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Page.enable')
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.__setTime(t), i / fps)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(frameDir, `f${String(i).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'))
  if (i % 25 === 0) process.stdout.write(`\r  frame ${i}/${total}`)
}
console.log(`\r  frame ${total}/${total}`)
await browser.close()

const y4m = path.join(outDir, 'dancer.y4m')
const mp4 = path.join(outDir, 'dancer.mp4')
const input = path.join(frameDir, 'f%05d.png')
// y4m for the fake camera; Chromium wants I420.
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
  '-pix_fmt', 'yuv420p', y4m])
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4])
fs.rmSync(frameDir, { recursive: true, force: true })

const mb = (p) => (fs.statSync(p).size / 1e6).toFixed(1)
console.log(`\n${y4m}  ${mb(y4m)} MB`)
console.log(`${mp4}  ${mb(mp4)} MB`)
