/**
 * Robot Rumble's frame rate in real time (no stepping): a round is started,
 * the hero runs and punches from the keyboard, and the page's own rAF count,
 * CPU cost per frame and draw calls are read after `--seconds`.
 *
 *   node tools/arena-perf.mjs --hero=/path/A.vrm --vp=390x844 --seconds=10 [--gpu=1]
 *
 * Without --gpu=1 Chromium renders in software (SwiftShader), which is what a
 * CI box or this sandbox has; the number is then a floor, not a phone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const [w, h] = (args.vp ?? '390x844').split('x').map(Number)
const seconds = Number(args.seconds ?? 10)
const launch = args.gpu === '1' ? [] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ args: launch })
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(args.dpr ?? 1) })
let q = `?dpr=${args.dpr ?? 1}`
if (args.hero) {
  await page.route('**/api/files/local/**', (r) => r.fulfill({ body: fs.readFileSync(args.hero) }))
  q += `&vrm=${encodeURIComponent('/api/files/local/' + path.basename(args.hero))}&name=Perf`
}
await page.goto(`${args.base ?? 'http://127.0.0.1:4188'}/arena.html${q}`)
await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 120000 })
await page.evaluate(() => window.__arena.start(2))
await page.waitForFunction(() => window.__phase === 'play', null, { timeout: 20000 })
await page.evaluate(() => window.__arena.resetPerf())
const t0 = await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f) }; requestAnimationFrame(f); return performance.now() })
const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']
for (let i = 0; i < seconds * 4; i++) {
  const k = keys[Math.floor(i / 4) % 4]
  await page.keyboard.down(k)
  await page.keyboard.press('j')
  await page.waitForTimeout(250)
  await page.keyboard.up(k)
}
const r = await page.evaluate((t) => ({ frames: window.__frames, ms: performance.now() - t, s: window.__arena.state() }), t0)
console.log(JSON.stringify({
  viewport: `${w}x${h}`, renderer: args.gpu === '1' ? 'gpu' : 'swiftshader',
  fps: +(r.frames / (r.ms / 1000)).toFixed(1),
  cpuMsPerFrame: +r.s.perf.avgMs.toFixed(2), drawCalls: r.s.perf.drawCalls, triangles: r.s.perf.triangles,
  pixelRatio: r.s.perf.pixelRatio,
}))
await browser.close()
