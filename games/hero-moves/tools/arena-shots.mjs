/**
 * Robot Rumble, looked at: the start card, the play camera and the end card
 * for any number of heroes and viewports, as PNGs, plus the numbers the page
 * reports (moves bound, draw calls, frame cost, facing-the-camera share).
 *
 *   npx vite preview --port 4188 --strictPort &
 *   node tools/arena-shots.mjs out/ --heroes=/path/A.vrm,/path/B.vrm --vp=390x844,844x390
 *
 * Heroes are served to the page as /api/files/local/<file>, the same-origin
 * path shape the app passes, so the page's own ?vrm= path is exercised.
 * Runs in ?manual=1 and steps the game itself, so a software renderer with
 * no GPU still produces the frames a phone would show.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')))
const OUT = process.argv[2] ?? 'arena-shots'
const BASE = args.base ?? 'http://127.0.0.1:4188'
const HEROES = (args.heroes ?? '').split(',').filter(Boolean)
const VPS = (args.vp ?? '390x844').split(',').map((s) => s.split('x').map(Number))
const PLAY_SECONDS = Number(args.play ?? 8)
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const report = []
for (const heroFile of HEROES.length ? HEROES : [null]) {
  const name = heroFile ? path.basename(heroFile).replace(/\.(opt\.)?vrm$/, '').replace(/_/g, ' ') : 'sample'
  for (const [w, h] of VPS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: w < h })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('pageerror', e.message))
    if (heroFile) {
      await page.route('**/api/files/local/**', (route) => route.fulfill({ body: fs.readFileSync(heroFile), contentType: 'application/octet-stream' }))
    }
    const q = heroFile ? `?vrm=${encodeURIComponent('/api/files/local/' + path.basename(heroFile))}&name=${encodeURIComponent(name)}&manual=1&dpr=1` : '?manual=1&dpr=1'
    await page.goto(`${BASE}/arena.html${q}`)
    await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 120000 })
    const ready = await page.evaluate(() => window.__ready)
    if (ready !== true) { console.log(name, 'not ready:', ready); await ctx.close(); continue }
    const tag = `${name.replace(/\W+/g, '_')}-${w}x${h}`
    await page.evaluate(() => window.__arena.step(40, 1 / 30))
    await page.screenshot({ path: path.join(OUT, `${tag}-1-start.png`), timeout: 120000 }); console.error(tag, '1-start')
    await page.evaluate(() => window.__arena.start(7))
    // A crude bot, in page: run at the nearest robot, punch when close, jump balls.
    const steps = Math.round((PLAY_SECONDS + 2.6) * 30)
    await page.evaluate(([n]) => {
      const keys = new Set()
      const press = (k, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k }))
      for (let i = 0; i < n; i++) {
        const s = window.__arena.state()
        const hero = s.hero
        const robots = s.things.filter((t) => t.kind !== 'ball' && t.kind !== 'balloon' || t.kind === 'balloon' && t.y < 2)
        robots.sort((a, b) => Math.hypot(a.x - hero.x, a.z - hero.z) - Math.hypot(b.x - hero.x, b.z - hero.z))
        const want = new Set()
        const t = robots[0]
        if (t) {
          const dx = t.x - hero.x, dz = t.z - hero.z
          if (Math.hypot(dx, dz) > 1.3) {
            if (dx > 0.3) want.add('arrowright'); if (dx < -0.3) want.add('arrowleft')
            if (dz > 0.3) want.add('arrowdown'); if (dz < -0.3) want.add('arrowup')
          } else if (i % 6 === 0) { press('j', true); press('j', false) }
        }
        const ball = s.things.find((b) => b.kind === 'ball' && Math.abs(b.z - hero.z) < 0.8 && Math.abs(b.x - hero.x) < 1.6 && Math.sign(hero.x - b.x) === Math.sign(b.vx))
        if (ball && !hero.airborne) { press(' ', true); press(' ', false) }
        for (const k of keys) if (!want.has(k)) { press(k, false); keys.delete(k) }
        for (const k of want) if (!keys.has(k)) { press(k, true); keys.add(k) }
        window.__arena.step(1, 1 / 30)
      }
      for (const k of keys) press(k, false)
    }, [steps])
    await page.screenshot({ path: path.join(OUT, `${tag}-2-play.png`), timeout: 120000 }); console.error(tag, '2-play')
    const state = await page.evaluate(() => window.__arena.state())
    const moves = await page.evaluate(() => window.__moves)
    report.push({ hero: name, vp: `${w}x${h}`, moves, score: state.score, stats: state.stats, facingFront: +(state.facing.front / Math.max(1e-6, state.facing.total)).toFixed(2), drawCalls: state.perf.drawCalls, avgFrameMs: +state.perf.avgMs.toFixed(1), heroH: +state.hero.height.toFixed(2), heroW: +state.hero.width.toFixed(2), radius: +state.hero.radius.toFixed(2) })
    if (args.end !== '0') {
      // Jump to the end of the round and let the cheer play.
      await page.evaluate(() => { const s = window.__arena.state(); window.__arena.step(Math.ceil((s.remaining + 0.2) * 30), 1 / 30) })
      await page.evaluate(() => window.__arena.step(60, 1 / 30))
      await page.screenshot({ path: path.join(OUT, `${tag}-3-end.png`), timeout: 120000 }); console.error(tag, '3-end')
    }
    await ctx.close()
  }
}
await browser.close()
console.log(JSON.stringify(report, null, 1))
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
