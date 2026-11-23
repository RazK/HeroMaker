/**
 * Records marketing/film/film.html to a video, one stepped frame at a time.
 *
 *   node tools/film-record.mjs <assetsDir> out.mp4 [--w=1080] [--h=1920] [--fps=24] [--cut=cut.json]
 *
 * assetsDir holds cut.json and everything it names (keyframes, clip frames,
 * app-screen frames, the end card's pictures); it is linked next to the page as
 * assets/. docs/content/README.md, "Family film first cut", says what goes in it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [assets, out] = process.argv.slice(2)
const flag = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const W = +flag('w', 1080), H = +flag('h', 1920), fps = +flag('fps', 24), cut = flag('cut', 'cut.json')
const here = new URL('../../../marketing/film/', import.meta.url).pathname
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'))
fs.copyFileSync(path.join(here, 'film.html'), path.join(dir, 'film.html'))
fs.symlinkSync(path.resolve(assets), path.join(dir, 'assets'))
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'filmf-'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.error('[page]', e.message))
await page.goto(`file://${dir}/film.html?w=${W}&h=${H}`)
// file:// pages cannot fetch, so the cut list is handed in.
const cutJson = JSON.parse(fs.readFileSync(path.join(assets, cut), 'utf8'))
const { duration } = await page.evaluate((c) => window.__film.load(c), cutJson)
const n = Math.round(duration * fps)
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__film.set(t), i / fps)
  await page.screenshot({ path: path.join(frames, `${String(i).padStart(4, '0')}.png`) })
}
await browser.close()
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'),
  '-c:v', 'libx264', '-profile:v', 'high', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`${n} frames, ${duration.toFixed(1)} s -> ${out}`)
