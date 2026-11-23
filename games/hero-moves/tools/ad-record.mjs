/**
 * Records ad.html to a video, one stepped frame at a time (deterministic).
 *
 *   node tools/ad-record.mjs   (from games/hero-moves) <assetsDir> out.mp4 [--w=1080] [--h=1920] [--fps=24]
 *
 * assetsDir holds what ad.html reads: drawon/ (scripts/content/draw_on.py),
 * girl/ (the child's clip as JPEGs), violet/ (tools/mimic/render.mjs --alpha),
 * violet-painted.webp and logo.png. It is linked next to the page as assets/.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [assets, out] = process.argv.slice(2)
const flag = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const W = +flag('w', 1080), H = +flag('h', 1920), fps = +flag('fps', 24)
const here = new URL('../../../marketing/ad/', import.meta.url).pathname

// Serve page + assets from one temp dir so file:// can read both.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-'))
fs.copyFileSync(path.join(here, 'ad.html'), path.join(dir, 'ad.html'))
fs.symlinkSync(path.resolve(assets), path.join(dir, 'assets'))
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'adf-'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.error('[page]', e.message))
const drawN = fs.readdirSync(path.join(assets, 'drawon')).length
await page.goto(`file://${dir}/ad.html?w=${W}&h=${H}&drawN=${drawN}`)
await page.evaluate(() => document.fonts.ready)
const dur = await page.evaluate(() => window.__ad.duration)
const n = Math.round(dur * fps)
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__ad.set(t), i / fps)
  await page.screenshot({ path: path.join(frames, `${String(i).padStart(4, '0')}.png`) })
}
await browser.close()
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'),
  '-c:v', 'libx264', '-profile:v', 'high', '-crf', '22', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`${n} frames -> ${out}`)
