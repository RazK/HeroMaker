/**
 * Records Robot Rumble being played, the way a thumb plays it: real touch
 * events on the on-screen stick and buttons (CDP Input.dispatchTouchEvent,
 * two fingers at once), decided frame by frame by a small bot that reads the
 * game state. The page runs in ?manual=1 and is stepped exactly 1/30 s per
 * captured frame, so a software renderer with no GPU still yields smooth
 * 30 fps footage of what a phone would show.
 *
 *   npx vite preview --port 4188 --strictPort &
 *   node tools/arena-record.mjs plan.json out-dir/
 *
 * plan.json: { "viewport": [390, 844], "scale": 2, "segments": [
 *   { "hero": "/abs/Curly_Carl.vrm", "name": "Curly Carl", "seed": 3,
 *     "menu": 2.0, "skip": 0, "record": 20, "end": false } ] }
 *
 * Each segment: show the start card for `menu` seconds, tap Start, play
 * `skip` seconds unrecorded (the bot keeps playing), record `record` seconds,
 * and if `end` play on to the end card and record `endHold` seconds of it.
 * Frames land in out-dir/frames/NNNNN.jpg; encode with ffmpeg afterwards.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { routeHeroes } from './arena-routes.mjs'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const OUT = process.argv[3]
const BASE = plan.base ?? 'http://127.0.0.1:4188'
const [VW, VH] = plan.viewport ?? [390, 844]
const SCALE = plan.scale ?? 2
const FPS = 30
const DT = 1 / FPS
const FRAMES = path.join(OUT, 'frames')
fs.mkdirSync(FRAMES, { recursive: true })
let frameNo = Number(plan.startFrame ?? 0)
const log = []

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

for (const seg of plan.segments) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: VW < VH })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  const file = path.basename(seg.hero)
  const rivals = (plan.rivals ?? []).filter((f) => f !== seg.hero)
  await routeHeroes(page, seg.hero, rivals)
  await page.goto(`${BASE}/arena.html?vrm=${encodeURIComponent('/api/files/local/' + file)}&name=${encodeURIComponent(seg.name)}&manual=1&dpr=${SCALE}`)
  await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 180000 })
  const ready = await page.evaluate(() => window.__ready)
  if (ready !== true) throw new Error(`${seg.name}: ${ready}`)
  // Let the gallery heroes finish arriving, so every round has them.
  if (rivals.length) await page.waitForFunction(() => window.__rivals !== undefined, null, { timeout: 300000 })
  const cdp = await ctx.newCDPSession(page)

  const grab = async () => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    fs.writeFileSync(path.join(FRAMES, `${String(frameNo++).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'))
  }
  const step = (render) => page.evaluate(([dt, r]) => window.__arena.step(1, dt, r), [DT, render])

  // Settle the menu, then hold it.
  await page.evaluate(() => window.__arena.step(45, 1 / 30))
  for (let i = 0; i < Math.round((seg.menu ?? 0) * FPS); i++) { await step(true); await grab() }

  // Tap Start with a real touch.
  const startBox = await page.locator('.rr-start').boundingBox()
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 9 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await tap(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2)
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
  // The seed: Start picks a random one; restart with the plan's for a repeatable round.
  await page.evaluate((s) => window.__arena.start(s), seg.seed ?? 1)

  const stick = await page.locator('.rr-stick').boundingBox().catch(() => null)
  const zone = await page.locator('.rr-stick-zone').boundingBox()
  const punch = await page.locator('.rr-btn--punch').boundingBox()
  const jump = await page.locator('.rr-btn--jump').boundingBox()
  const sc = { x: (stick ?? zone).x + (stick ?? zone).width / 2, y: (stick ?? zone).y + (stick ?? zone).height / 2, r: (stick?.width ?? 124) * 0.42 }
  const touches = new Map() // id -> {x, y}
  const send = async (type) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 12, radiusY: 12, force: 1 })) })
  }
  const bot = makeBot()
  let buttonHeld = null // {id, until}

  const playFrame = async (render) => {
    const s = await page.evaluate(() => window.__arena.state())
    const act = bot(s)
    // ---- stick finger (id 1)
    if (act.move) {
      const p = { x: sc.x + act.move.x * sc.r, y: sc.y - act.move.y * sc.r }
      if (!touches.has(1)) { touches.set(1, { x: sc.x, y: sc.y }); await send('touchStart') }
      touches.set(1, p); await send('touchMove')
    } else if (touches.has(1)) {
      touches.delete(1); await send('touchEnd')
    }
    // ---- button finger (id 2): press for a few frames, then lift
    if (buttonHeld && s.clock >= buttonHeld.until) { touches.delete(2); await send('touchEnd'); buttonHeld = null }
    if (!buttonHeld && (act.punch || act.jump)) {
      const b = act.jump ? jump : punch
      touches.set(2, { x: b.x + b.width / 2 + (Math.random() - 0.5) * 10, y: b.y + b.height / 2 + (Math.random() - 0.5) * 10 })
      await send('touchStart')
      buttonHeld = { until: s.clock + 0.1 }
    }
    await step(render)
    if (render) await grab()
    return s
  }

  let s = await page.evaluate(() => window.__arena.state())
  // Countdown, recorded only when the segment starts recording at once.
  const recordFrom = seg.skip ?? 0
  while (s.phase !== 'play') { s = await playFrame(recordFrom === 0) }
  while (s.time < recordFrom && s.phase === 'play') s = await playFrame(false)
  if (seg.record) {
    const until = s.time + seg.record
    while (s.time < until && s.phase === 'play') s = await playFrame(true)
  }
  if (seg.end) {
    // Fast-forward to the last few seconds, then record the finish and the card.
    while (s.phase === 'play' && s.remaining > (seg.endLead ?? 3)) s = await playFrame(false)
    while (s.phase === 'play') s = await playFrame(true)
    // Lift every finger the moment the round ends, as a player would.
    for (const id of [...touches.keys()]) touches.delete(id)
    await send('touchEnd').catch(() => {})
    for (let i = 0; i < Math.round((seg.endHold ?? 5) * FPS); i++) { await step(true); await grab() }
  }
  for (const id of [...touches.keys()]) touches.delete(id)
  await send('touchEnd').catch(() => {})
  s = await page.evaluate(() => window.__arena.state())
  log.push({ name: seg.name, score: s.score, stats: s.stats, facingFront: +(s.facing.front / Math.max(1e-6, s.facing.total)).toFixed(3), secondsPlayed: +s.facing.total.toFixed(1), facingDetail: Object.fromEntries(Object.entries(s.facing.detail ?? {}).map(([k, v]) => [k, +(v / s.facing.total).toFixed(2)])), frames: frameNo })
  console.log(JSON.stringify(log[log.length - 1]))
  await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'record-log.json'), JSON.stringify(log, null, 1))

/**
 * The player: guard the chest. Meet each robot from the chest's side so the
 * hero faces it (and the camera), punch in rhythm, jump the balls, and
 * ground-pound a crowd.
 */
function makeBot() {
  let nextPunch = 0
  let wantSlam = false
  let jumpedAt = -9
  return (s) => {
    const h = s.hero
    const act = { move: null, punch: false, jump: false }
    if (s.phase !== 'play') return act
    const t = s.clock
    const chest = { x: 0, z: -3.95 }
    const live = s.things.filter((x) => x.kind !== 'ball')
    // Balls: jump the one about to arrive.
    const ball = s.things.find((b) => b.kind === 'ball' && Math.abs(b.z - h.z) < h.radius + 0.55
      && Math.sign(h.x - b.x) === Math.sign(b.vx) && Math.abs(b.x - h.x) < 1.25 + Math.abs(b.vx) * 0.12)
    if (ball && !h.airborne && t - jumpedAt > 0.6) {
      act.jump = true; jumpedAt = t
      wantSlam = live.filter((x) => Math.hypot(x.x - h.x, x.z - h.z) < 2.2 && x.kind !== 'balloon' && x.kind !== 'gold').length >= 2
      return act
    }
    // In the air: slam when it will catch a crowd.
    if (h.airborne) {
      const crowd = live.filter((x) => Math.hypot(x.x - h.x, x.z - h.z) < 2.3 && (x.kind === 'robot' || x.kind === 'crate')).length
      if ((wantSlam || crowd >= 3) && h.y > 0.6) { act.punch = true; wantSlam = false }
      return act
    }
    // A crowd near me: jump to slam it.
    const crowd = live.filter((x) => Math.hypot(x.x - h.x, x.z - h.z) < 1.9 && (x.kind === 'robot' || x.kind === 'crate'))
    if (crowd.length >= 2 && t - jumpedAt > 2.5) { act.jump = true; jumpedAt = t; wantSlam = true; return act }

    // Pick a target: the most dangerous robot, a crate, or a low balloon.
    let best = null, bestScore = Infinity
    for (const x of live) {
      // A person needs a moment to notice a new robot.
      if (x.kind === 'robot' && x.age < 0.9) continue
      const d = Math.hypot(x.x - h.x, x.z - h.z)
      let score = d
      if (x.kind === 'robot') score -= Math.max(0, 3.2 - Math.hypot(x.x - chest.x, x.z - chest.z)) * 0.3
      if (x.kind === 'crate') score -= 0.8
      if (x.kind === 'gold') score -= 2.5
      if ((x.kind === 'balloon' || x.kind === 'gold') && x.y > 1.9) continue
      if (x.kind === 'crate' && x.y > 0.2) continue
      if (score < bestScore) { bestScore = score; best = x }
    }
    // Nothing to hit: wait where you are; the next robot comes from the front.
    if (!best) return act
    // Run straight at it, as a child would, and stop when it is in reach.
    const toHero = norm(h.x - best.x, h.z - best.z, 1)
    const reach = h.radius + 0.36 + 0.75
    const gx = best.x + toHero.x * reach * 0.8
    const gz = best.z + toHero.y * reach * 0.8
    const dTarget = Math.hypot(best.x - h.x, best.z - h.z)
    const dGoal = Math.hypot(gx - h.x, gz - h.z)
    if (dTarget > reach + 0.2 && dGoal > 0.25) act.move = norm(gx - h.x, -(gz - h.z), Math.min(1, dGoal * 1.2 + 0.3))
    if (dTarget < reach + 0.35 && t >= nextPunch) {
      act.punch = true
      nextPunch = t + 0.3 + Math.random() * 0.15
    }
    return act
  }
}
function norm(x, y, m) {
  const l = Math.hypot(x, y) || 1
  return { x: (x / l) * m, y: (y / l) * m }
}
