import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Drives the game headlessly: boots, starts a run, plays it with a simple
 * bot that reads upcoming obstacles, and screenshots at scripted moments.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5181/'
const outDir = process.argv[3] ?? '/tmp/shots'
const W = Number(process.env.SHOT_W ?? 1280), H = Number(process.env.SHOT_H ?? 800)
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-dev-shm-usage', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const logs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', r => logs.push(`[reqfail] ${r.url().slice(0, 90)} ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => window.__ready === true || String(window.__ready ?? '').startsWith('error'), null, { timeout: 120000 })
const ready = await page.evaluate(() => window.__ready)
if (ready !== true) { console.log('BOOT FAILED:', ready); console.log(logs.join('\n')); await browser.close(); process.exit(1) }

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }) }
const wait = (ms) => page.waitForTimeout(ms)

await wait(900); await shot('01-menu')

// Install a bot that inspects live track state and reacts to what's ahead.
await page.evaluate((scale) => {
  window.__api.setTimeScale(scale)
  window.__bot = { on: true, actions: {}, crashes: 0 }
  const act = (a) => { window.__input.push(a); window.__bot.actions[a] = (window.__bot.actions[a] ?? 0) + 1 }
  const LANE_W = 2.2
  const laneOf = (x) => Math.max(0, Math.min(2, Math.round(x / LANE_W + 1)))
  let cooldown = 0
  // Decide once per simulation step, so the bot is unaffected by render fps.
  window.__api.onStep((dt) => {
    if (!window.__bot.on || window.__api.phase() !== 'running') return
    cooldown -= dt
    if (cooldown > 0) return
    const d = window.__api.debug()
    const lane = d.lane
    const react = (a, wait) => { act(a); cooldown = wait }

    let best = null
    for (const e of d.entities) {
      if (e.kind === 'star') continue
      const dz = e.z - d.z
      if (dz < 0.4 || dz > 12) continue
      if (e.kind !== 'gate' && laneOf(e.x) !== lane) continue
      if (!best || dz < best.dz) best = { dz, kind: e.kind }
    }

    const blocked = new Set()
    for (const e of d.entities) {
      if (e.kind === 'star' || e.kind === 'gate') continue
      const dz = e.z - d.z
      if (dz > 0.3 && dz < 10) blocked.add(laneOf(e.x))
    }

    if (!best) {
      const counts = [0, 0, 0]
      for (const e of d.entities) {
        if (e.kind !== 'star') continue
        const dz = e.z - d.z
        if (dz > 4 && dz < 30) counts[laneOf(e.x)] += 1
      }
      let want = lane, bestCount = counts[lane]
      for (const l of [lane - 1, lane + 1]) {
        if (l < 0 || l > 2 || blocked.has(l)) continue
        if (counts[l] > bestCount + 1) { bestCount = counts[l]; want = l }
      }
      if (want !== lane) react(want < lane ? 'left' : 'right', 0.28)
      return
    }

    if (best.kind === 'gate') { if (best.dz < 3.0) react('pose', 0.35); return }
    if (best.kind === 'low') { if (best.dz < 4.0) react('jump', 0.45); return }
    if (best.kind === 'high') { if (best.dz < 3.2) react('slide', 0.45); return }
    const opts = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !blocked.has(l))
    if (opts.length) react(opts[0] < lane ? 'left' : 'right', 0.25)
    else if (best.dz < 4.0) react('jump', 0.4)
  })
}, Number(process.env.TIME_SCALE ?? 3))

await page.evaluate(() => window.__api.play())
await wait(1200); await shot('02-countdown')
await wait(3500); await shot('03-run')
await wait(4000); await shot('04-run2')
await wait(6000); await shot('05-run3')

const mid = await page.evaluate(() => ({ stats: window.__api.stats(), phase: window.__api.phase(), actions: window.__bot.actions }))
console.log('MID', JSON.stringify(mid))

await wait(9000); await shot('06-later')
const late = await page.evaluate(() => ({ stats: window.__api.stats(), phase: window.__api.phase(), actions: window.__bot.actions }))
console.log('LATE', JSON.stringify(late))

// Let it die, then capture the score screen.
await page.evaluate(() => { window.__bot.on = false })
await page.waitForFunction(() => window.__api.phase() === 'over', null, { timeout: 60000 }).catch(() => {})
await wait(2200); await shot('07-over')

const fps = await page.evaluate(() => window.__frames)
console.log('FRAMES', fps)
console.log('--- issues ---'); console.log(logs.slice(0, 20).join('\n') || 'none')
await browser.close()
