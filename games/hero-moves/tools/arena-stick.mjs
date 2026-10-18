/**
 * Robot Rumble's thumb stick, checked and photographed: at rest with the
 * first-play hint, mid-hint, floated under a thumb that landed on the stage,
 * and at rest once the hint is gone. Asserts what the hint promises:
 *
 *  - it shows on a first round, and only while the round is live;
 *  - the first real drag dismisses it, and a reload does not bring it back;
 *  - a touch in the stage's lower-left brings the stick to the thumb, and a
 *    touch there drives the hero;
 *  - letting go puts the stick back where it rests.
 *
 *   npx vite preview --port 4188 --strictPort &
 *   node tools/arena-stick.mjs out/ [--vp=390x844,844x390] [--base=http://127.0.0.1:4188]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')))
const OUT = process.argv[2] ?? 'arena-stick'
const BASE = args.base ?? 'http://127.0.0.1:4188'
const VPS = (args.vp ?? '390x844,844x390').split(',').map((s) => s.split('x').map(Number))
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const fails = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what) }

for (const [w, h] of VPS) {
  const tag = `${w}x${h}`
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: w < h })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  const cdp = await ctx.newCDPSession(page)
  const shot = async (name, clip) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
    fs.writeFileSync(path.join(OUT, `stick-${tag}-${name}.png`), Buffer.from(data, 'base64'))
  }
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ id: i + 1, x, y, radiusX: 12, radiusY: 12, force: 1 })) })
  const stickBox = () => page.locator('.rr-stick').boundingBox()
  const hinting = () => page.evaluate(() => document.querySelector('.rr-stick').classList.contains('is-hint'))

  const boot = async () => {
    await page.goto(`${BASE}/arena.html?sample=Superstar&crowd=0&manual=1&dpr=2`)
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
    await page.evaluate(() => window.__arena.step(30, 1 / 30))
  }
  await boot()
  await page.evaluate(() => { try { localStorage.removeItem('heromaker.robotRumble.movedOnce') } catch {} })
  await boot()
  check(!(await hinting()), `${tag}: no hint on the start card`)
  await page.evaluate(() => window.__arena.start(3))
  await page.evaluate(() => window.__arena.step(90, 1 / 30))
  check(await page.evaluate(() => window.__phase === 'play'), `${tag}: round is live`)
  check(await hinting(), `${tag}: hint shows on a first round`)
  const rest = await stickBox()
  const area = { x: 0, y: Math.max(0, rest.y - 120), width: Math.min(w, rest.x + rest.width + 200), height: Math.min(h - Math.max(0, rest.y - 120), rest.height + 150) }
  await page.waitForTimeout(150)
  await shot('1-rest-hint', area)
  await page.waitForTimeout(600) // the knob drifts on the hint's 2.2 s cycle
  await shot('2-mid-hint', area)
  await shot('2-mid-hint-full')

  // A thumb lands on the stage, above and right of the resting stick.
  const sx = Math.min(w * 0.5 - 70, rest.x + rest.width / 2 + 90), sy = rest.y - 60
  const onReach = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [sx, sy])
  check(onReach === 'rr-stick-reach is-on', `${tag}: the stage's lower-left takes the thumb (${onReach})`)
  await touch('touchStart', [[sx, sy]])
  const floated = await stickBox()
  const fc = { x: floated.x + floated.width / 2, y: floated.y + floated.height / 2 }
  check(Math.hypot(fc.x - sx, fc.y - sy) < 4, `${tag}: the stick floats to the thumb (${fc.x.toFixed(0)},${fc.y.toFixed(0)} vs ${sx.toFixed(0)},${sy.toFixed(0)})`)
  const x0 = await page.evaluate(() => window.__arena.state().hero.x)
  await touch('touchMove', [[sx + 40, sy]])
  await page.evaluate(() => window.__arena.step(20, 1 / 30))
  await shot('3-dragged', { x: 0, y: Math.max(0, floated.y - 140), width: Math.min(w, floated.x + floated.width + 160), height: Math.min(h - Math.max(0, floated.y - 140), floated.height + 300) })
  await shot('3-dragged-full')
  const x1 = await page.evaluate(() => window.__arena.state().hero.x)
  check(x1 > x0 + 0.3, `${tag}: dragging right runs the hero right (${x0.toFixed(2)} -> ${x1.toFixed(2)})`)
  check(!(await hinting()), `${tag}: the first move dismisses the hint`)
  await touch('touchEnd', [])
  const back = await stickBox()
  check(Math.abs(back.x - rest.x) < 1 && Math.abs(back.y - rest.y) < 1, `${tag}: let go, the stick returns to rest`)
  await shot('4-rest-after', area)

  // A new visit: the hint stays gone.
  await boot()
  await page.evaluate(() => window.__arena.start(4))
  await page.evaluate(() => window.__arena.step(90, 1 / 30))
  check(!(await hinting()), `${tag}: the hint does not come back after a reload`)
  await ctx.close()
}
await browser.close()
if (fails.length) { console.log(`${fails.length} failed`); process.exit(1) }
console.log('all passed')
