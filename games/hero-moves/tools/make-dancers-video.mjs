import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Renders one to three stand-in players, side by side in lanes, to a video
 * Chromium can serve as a fake camera.
 *
 * Frames are stepped explicitly rather than captured in real time, so the feed
 * is byte-identical on every run and does not depend on how fast this machine
 * renders. The clip opens on a marker pose the recorder watches for, which is
 * how a pre-rendered feed and a live game end up on the same beat.
 *
 * Usage: make-dancers-video.mjs OUTDIR [--n=3] [--seed=4242] [--len=short]
 *                                      [--as=A,B,C] [--skill=1,.82,.62] [--fps=25]
 */
const outDir = process.argv[2] ?? '/tmp/party'
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : fallback
}
const fps = Number(flag('fps', 25))
const base = flag('url', 'http://127.0.0.1:5183')
const W = Number(flag('w', 640)), H = Number(flag('h', 480))
const q = new URLSearchParams({
  n: flag('n', '3'), seed: flag('seed', '4242'), len: flag('len', 'short'),
  as: flag('as', 'Gingerella,Skelly,Cloudy'), skill: flag('skill', '1,0.82,0.62'),
  scale: flag('scale', '1'), w: String(W), h: String(H),
})

const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')

fs.mkdirSync(outDir, { recursive: true })
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-frames-'))

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`${base}/dancers.html?${q}`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })

const duration = await page.evaluate(() => window.__duration)
const total = Math.round(duration * fps)
console.log(`rendering ${total} frames (${duration.toFixed(1)}s @ ${fps}fps), ${q.get('n')} lanes`)

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

const tag = flag('tag', `p${q.get('n')}`)
const y4m = path.join(outDir, `${tag}.y4m`)
const input = path.join(frameDir, 'f%05d.png')
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
  '-pix_fmt', 'yuv420p', y4m])
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(outDir, `${tag}.mp4`)])
fs.rmSync(frameDir, { recursive: true, force: true })
// The recorder needs the feed's exact timeline to line the game up with it.
const meta = {
  frames: total, fps, duration: total / fps,
  mark: await Promise.resolve(Number(flag('mark', 1)) * Number(flag('scale', 1))),
  scale: Number(flag('scale', 1)),
  n: Number(q.get('n')), seed: Number(q.get('seed')), len: q.get('len'),
  as: q.get('as'), skill: q.get('skill'), w: W, h: H,
}
fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(meta, null, 2))
console.log(`${y4m}  ${(fs.statSync(y4m).size / 1e6).toFixed(1)} MB`)
console.log(JSON.stringify(meta))
