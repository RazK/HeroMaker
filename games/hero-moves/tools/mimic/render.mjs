/**
 * Renders a hero copying a person, one PNG per video frame (src/mimic.ts).
 *
 *   npx vite --port 5182 &                      # in games/hero-moves
 *   node tools/mimic/render.mjs hero.vrm pose.json outDir [--w=720] [--h=1280] [--from=0] [--to=N] [--alpha]
 *
 * pose.json comes from tools/mimic/extract_pose.py. The VRM and the pose file are
 * handed to the page by request interception, so they can live anywhere on disk.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const [vrm, pose, outDir] = process.argv.slice(2)
const flag = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const W = +flag('w', 720), H = +flag('h', 1280)
const base = flag('url', 'http://127.0.0.1:5182')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })
page.on('pageerror', (e) => console.error('[page]', e.message))
await page.route('**/__in/hero.vrm', (r) => r.fulfill({ body: fs.readFileSync(vrm), contentType: 'model/gltf-binary' }))
await page.route('**/__in/pose.json', (r) => r.fulfill({ body: fs.readFileSync(pose), contentType: 'application/json' }))
await page.goto(`${base}/mimic.html?w=${W}&h=${H}${process.argv.includes('--alpha') ? '&alpha' : ''}`)
await page.waitForFunction(() => window.__mimic)
const opts = JSON.parse(flag('opts', '{}'))
const info = await page.evaluate((o) => window.__mimic.load('/__in/hero.vrm', '/__in/pose.json', o), opts)
console.log('loaded', info)
const from = +flag('from', 0), to = Math.min(+flag('to', info.frames), info.frames)
for (let i = from; i < to; i++) {
  const url = await page.evaluate((i) => window.__mimic.frame(i), i)
  fs.writeFileSync(path.join(outDir, `${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'))
}
console.log(`wrote ${to - from} frames to ${outDir}`)
await browser.close()
