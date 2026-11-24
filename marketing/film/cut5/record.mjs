// node record.mjs <assetsDir> out.mp4 [--fps=24]  — renders cut5.html at 1080x1920 (360x640 x3), frame by frame.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const [assets, out] = process.argv.slice(2)
const fps = +(process.argv.find((a) => a.startsWith('--fps='))?.split('=')[1] || 24)
const here = path.dirname(new URL(import.meta.url).pathname)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut5-')); fs.copyFileSync(path.join(here, 'cut5.html'), path.join(dir, 'cut5.html')); fs.symlinkSync(path.resolve(assets), path.join(dir, 'assets'))
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'cut5f-'))
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 })
p.on('pageerror', (e) => console.error('[page]', e.message))
await p.goto(`file://${dir}/cut5.html`); const { duration } = await p.evaluate(() => window.__cut.load())
const n = Math.round(duration * fps)
for (let i = 0; i < n; i++) { await p.evaluate((t) => window.__cut.set(t), i / fps); await p.screenshot({ path: path.join(frames, `${String(i).padStart(4, '0')}.png`) }) }
await b.close()
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`${n} frames, ${duration.toFixed(1)} s -> ${out}`)
