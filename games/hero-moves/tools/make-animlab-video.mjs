/**
 * Records the animation lab to an MP4.
 *
 * Frames are stepped rather than captured in real time — the sandbox renders
 * through SwiftShader at a few frames a second, so anything wall-clock driven
 * would come out as a slideshow. Stepping also makes the file reproducible.
 *
 * Usage: node tools/make-animlab-video.mjs out.mp4 [--avatar=Crayon_Kid] [--fps=24]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const out = process.argv[2] ?? '/tmp/vrm-animations.mp4'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const avatar = flag('avatar', 'Crayon_Kid')
const fps = Number(flag('fps', 24))
const base = flag('url', 'http://127.0.0.1:5182')
const W = Number(flag('w', 960)), H = Number(flag('h', 600))

// Playwright's bundled ffmpeg has no PNG decoder; use the real one.
const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animlab-'))
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(`${base}/animlab.html?a=${avatar}&w=${W}&h=${H}&still=1`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
console.log(JSON.stringify(await page.evaluate(() => window.__clips), null, 1))

const duration = await page.evaluate(() => window.__duration)
const total = Math.round(duration * fps)
console.log(`rendering ${total} frames (${duration}s @ ${fps}fps) of ${avatar}`)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Page.enable')
const started = Date.now()
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.__setTime(t), i / fps)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(frameDir, `f${String(i).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'))
  if (i % 24 === 0) {
    const rate = (i + 1) / ((Date.now() - started) / 1000)
    process.stdout.write(`\r  frame ${i}/${total}  ${rate.toFixed(1)} fps  eta ${((total - i) / rate / 60).toFixed(1)} min   `)
  }
}
console.log(`\r  frame ${total}/${total}                              `)
await browser.close()

fs.mkdirSync(path.dirname(out), { recursive: true })
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps),
  '-i', path.join(frameDir, 'f%05d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-movflags', '+faststart', out])
fs.rmSync(frameDir, { recursive: true, force: true })
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
