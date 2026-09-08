import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Records a party round as video, with the pre-rendered players in step.
 *
 * Chromium serves the rendered lanes as the camera, so the game runs its real
 * pipeline — getUserMedia, MoveNet per lane, solver, scoring — with no
 * test-only path. The one thing a recording needs that a player does not is a
 * shared clock: the feed opens on a marker pose, and the round is started the
 * instant the classifier names it, which puts beat zero of the game on the
 * first beat of the dance.
 *
 * Usage: record-party.mjs OUT.mp4 [--video=/tmp/party/p3.y4m] [--players=3]
 *        [--len=short] [--seed=4242] [--w=] [--h=] [--timescale=0.5]
 *        [--picks=0,1,5] [--pause] [--menu=6]
 */
const out = process.argv[2] ?? '/tmp/party/round.mp4'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feed = flag('video', '/tmp/party/p3.y4m')
const players = Number(flag('players', 3))
const seed = Number(flag('seed', 4242))
const W = Number(flag('w', 1280)), H = Number(flag('h', 720))
const base = flag('url', 'http://127.0.0.1:5183')
const timescale = Number(flag('timescale', 0.5))
const menuHold = Number(flag('menu', 6))
/**
 * Seconds of menu to keep in front of the round.
 *
 * Lining up with the feed can mean waiting most of a loop of it, and nobody
 * needs to watch forty seconds of a menu to get to the dancing.
 */
const preroll = Number(flag('preroll', 6))
const picks = flag('picks', '').split(',').filter((s) => s !== '').map(Number)
const wantPause = process.argv.includes('--pause')
/**
 * Burn a short phase label into the frames.
 *
 * Injected only while recording, and only reading the same public hooks the
 * test harnesses use — the game itself is untouched. A demo of five screens is
 * unwatchable without one line saying which screen you are looking at.
 */
const captions = process.argv.includes('--captions')
/**
 * Menu tour instead of a round: walk the player counts and the whole roster,
 * so a demo shows every hero without playing six rounds to do it.
 */
const tour = process.argv.includes('--tour')
const label = flag('label', '')

const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')
if (!fs.existsSync(feed)) {
  console.error(`no camera feed at ${feed} — run tools/make-dancers-video.mjs first`)
  process.exit(1)
}

const videoDir = fs.mkdtempSync('/tmp/hm-party-')
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`, '--autoplay-policy=no-user-gesture-required'],
})
const context = await browser.newContext({
  viewport: { width: W, height: H }, permissions: ['camera'],
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
})
const page = await context.newPage()
const t0 = Date.now()
const problems = []
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })

await page.goto(base, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true || String(window.__ready ?? '').startsWith('error'),
  null, { timeout: 300000 })
const ready = await page.evaluate(() => window.__ready)
if (ready !== true) { console.error('boot failed:', ready, problems.slice(0, 4)); await browser.close(); process.exit(1) }
const readySeconds = (Date.now() - t0) / 1000

await page.evaluate((n) => window.__api.setPlayers(n), players)
await page.evaluate((l) => window.__api.setLength(l), flag('len', 'short'))
for (let i = 0; i < picks.length && i < players; i++) {
  await page.evaluate(([lane, hero]) => window.__api.pick(lane, hero), [i, picks[i]])
  await page.waitForTimeout(1800)
}
await page.evaluate((t) => window.__api.setTimeScale(t), timescale)

if (captions) await page.evaluate((fixed) => {
  const chip = (css) => {
    const n = document.createElement('div')
    n.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;' +
      'font:800 clamp(13px,2.1vh,20px)/1.25 "Baloo 2",system-ui,sans-serif;' +
      'color:#fff8ec;background:rgba(24,12,40,.86);padding:.45em 1em;' +
      'border-radius:999px;box-shadow:0 8px 26px rgba(0,0,0,.45);' + css
    document.body.appendChild(n)
    return n
  }
  if (fixed) chip('left:50%;top:2.2vh;transform:translateX(-50%)').textContent = fixed
  const bar = chip('left:50%;bottom:2.4vh;transform:translateX(-50%);max-width:64vw;' +
    'text-align:center;opacity:0;transition:opacity .3s ease')
  const LINE = {
    menu: 'Menu — up to three players, one hero each',
    countdown: 'Get ready…',
    dancing: 'Everyone dances the same routine. Each hero mirrors its own player.',
    paused: 'Pause — resume, end the round, or quit to the menu',
    results: 'Final scores',
  }
  let shown = ''
  const tick = () => {
    const line = LINE[window.__api.phase()] ?? ''
    if (line !== shown) {
      shown = line
      bar.style.opacity = '0'
      setTimeout(() => { bar.textContent = line; bar.style.opacity = line ? '1' : '0' }, 220)
    }
    requestAnimationFrame(tick)
  }
  tick()
}, label)

// The menu wants the camera live so the lane checks are real; opening it here
// also gets the permission prompt out of the way before the round.
await page.evaluate(() => window.__api.wake())
await page.waitForFunction(() => window.__api.ready() === 'ready', null, { timeout: 120000 })
await page.waitForTimeout(menuHold * 1000)

if (tour) {
  for (const n of [1, 2, 3]) {
    await page.evaluate((k) => window.__api.setPlayers(k), n)
    await page.waitForTimeout(2600)
  }
  for (const combo of (flag('combos', '0,1,2|3,4,5|5,2,4')).split('|')) {
    const trio = combo.split(',').map(Number)
    for (let lane = 0; lane < trio.length; lane++) {
      await page.evaluate(([l, h]) => window.__api.pick(l, h), [lane, trio[lane]])
      await page.waitForTimeout(1500)
    }
    await page.waitForTimeout(2200)
  }
  for (const id of ['short', 'normal', 'long']) {
    await page.evaluate((l) => window.__api.setLength(l), id)
    await page.waitForTimeout(1100)
  }
  await page.waitForTimeout(1500)
}

/**
 * Line the round up with the feed.
 *
 * A fake camera is a file on a loop, and the page knows when playback began, so
 * the feed's position is arithmetic rather than a guess. The clip opens on a
 * marker pose held for `meta.mark` seconds and then plays exactly the routine's
 * lead-in of neutral, so starting the round the moment the marker ends puts the
 * game's beat zero on the dance's first beat — to within a frame, instead of
 * within however long a lane takes to be re-inferred.
 *
 * The feed must be rendered at `scale` = 1 / timescale for that to hold: the
 * game clock is slowed to give MoveNet enough samples, and the camera is not.
 */
const meta = tour ? null : JSON.parse(fs.readFileSync(feed.replace(/\.y4m$/, '.json'), 'utf8'))
if (!tour && Math.abs(meta.scale * timescale - 1) > 1e-6) {
  console.error(`feed scale ${meta.scale} does not match timescale ${timescale}`)
  process.exit(1)
}
if (!tour) {
  // Compute the wait and schedule it *inside* the page rather than polling for
  // the moment from out here. The page is running MoveNet and rendering three
  // avatars, so a poll can miss a 300 ms window entirely and then wait a whole
  // loop of the feed for the next one — which is how a two-minute recording
  // becomes a five-minute one that still starts on the wrong beat.
  const waited = await page.evaluate(({ mark, dur, s }) => new Promise((done) => {
    const now = (window.__api.camClock() / 1000) % dur
    const wait = (((mark - now) % dur) + dur) % dur
    setTimeout(() => { window.__api.start(s); done(wait) }, wait * 1000)
  }), { mark: meta.mark, dur: meta.duration, s: seed })
  startedAt = (Date.now() - t0) / 1000
  console.log(`round started ${startedAt.toFixed(1)}s in ` +
    `(waited ${waited.toFixed(2)}s for the feed's first beat)`)
}

let startedAt = 0
let paused = false
const samples = []
for (; !tour;) {
  await page.waitForTimeout(1000)
  const snap = await page.evaluate(() => ({
    phase: window.__api.phase(), tracker: window.__api.tracker(),
    players: window.__api.players(), beat: Math.round(window.__api.state().beat),
  }))
  samples.push(snap)
  if (wantPause && !paused && snap.phase === 'dancing' && snap.beat > 10) {
    paused = true
    await page.evaluate(() => window.__api.pause())
    await page.waitForTimeout(6500)
    await page.evaluate(() => window.__api.resume())
  }
  if (snap.phase === 'results') { await page.waitForTimeout(8000 / timescale); break }
  if (samples.length > 400) break
}

const summary = tour ? 'menu tour' : await page.evaluate(() => window.__api.summary())
await context.close(); await browser.close()

const webm = fs.readdirSync(videoDir).map((f) => path.join(videoDir, f)).find((f) => f.endsWith('.webm'))
if (!webm) { console.error('playwright produced no video'); process.exit(1) }
fs.mkdirSync(path.dirname(out), { recursive: true })
const trim = tour ? Math.max(0, readySeconds - 0.4)
  : Math.max(readySeconds, startedAt - preroll)
const speed = timescale !== 1 ? ['-vf', `setpts=PTS*${timescale},fps=30`] : ['-vf', 'fps=30']
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(trim), '-i', webm, ...speed,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', out])
fs.rmSync(videoDir, { recursive: true, force: true })

const last = samples.at(-1)
console.log(`tracker: ${last?.tracker.state}, ${last?.tracker.fps.toFixed(1)} fps, ${last?.tracker.ms.toFixed(0)} ms`)
console.log('final:', JSON.stringify(summary, null, 2))
console.log('problems:', problems.slice(0, 5).join(' | ') || 'none')
console.log(`\n${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
