import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Records a full playthrough as video.
 *
 * Chromium is told to serve a rendered dance clip as the camera, so the game
 * runs its real pipeline — getUserMedia, MoveNet, solver, scoring — with no
 * test-only code path. What the recording shows is what a player gets.
 *
 * Usage: record-demo.mjs OUT.mp4 [--video=/tmp/dancer/dancer.y4m] [--avatar=2]
 *                                [--seconds=60] [--w=1280] [--h=720]
 */
const out = process.argv[2] ?? '/tmp/hero-moves-demo.mp4'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feed = flag('video', '/tmp/dancer/dancer.y4m')
const avatarIndex = Number(flag('avatar', 0))
const seconds = Number(flag('seconds', 60))
const W = Number(flag('w', 1280))
const H = Number(flag('h', 720))
const base = flag('url', 'http://127.0.0.1:5183')
/**
 * Runs the game clock slower than wall-clock so the pose tracker, which is
 * CPU-bound in this sandbox, gets a realistic number of samples per move. The
 * footage is sped back up by the same factor afterwards, so the finished video
 * plays at true speed. Pair with the dancer clip rendered at the same `scale`.
 */
const timescale = Number(flag('timescale', 1))
/**
 * How many moves to play. Chromium paces the fake camera file on its own
 * timer, and under the load of running MoveNet without a GPU it delivers
 * frames slightly slow, so a long run drifts out of step with the game clock.
 * A short run stays inside a beat of it.
 */
const moves = Number(flag('moves', 0))
/** Burn short captions into the frames so the recording explains itself. */
const captions = process.argv.includes('--captions')

const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg')

if (!fs.existsSync(feed)) {
  console.error(`no camera clip at ${feed} — run tools/make-dancer-video.mjs first`)
  process.exit(1)
}

const videoDir = fs.mkdtempSync('/tmp/hm-record-')
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const context = await browser.newContext({
  viewport: { width: W, height: H },
  permissions: ['camera'],
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
})
const page = await context.newPage()
/** Playwright starts recording at context creation, so boot is in the file. */
const recordingStarted = Date.now()
const problems = []
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })

await page.goto(base, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true || String(window.__ready ?? '').startsWith('error'),
  null, { timeout: 300000 })
// Playwright starts recording at context creation, so the file opens on a
// blank page while the payload parses. Trim from the moment the title is up.
const readySeconds = (Date.now() - recordingStarted) / 1000
const ready = await page.evaluate(() => window.__ready)
if (ready !== true) {
  console.error('boot failed:', ready)
  console.error(problems.slice(0, 6).join('\n'))
  await browser.close(); process.exit(1)
}

if (avatarIndex > 0) {
  await page.evaluate((i) => window.__api.pick(i), avatarIndex)
  await page.waitForTimeout(2500)
}

if (captions) await page.evaluate(() => {
  // Injected only while recording. It reads the same public hooks the test
  // harness uses and writes text over the frame; the game is untouched.
  const bar = document.createElement('div')
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:3.2vh', 'transform:translateX(-50%)',
    'z-index:9999', 'pointer-events:none', 'max-width:44vw', 'text-align:center',
    'font:800 clamp(14px,2vh,22px)/1.25 "Baloo 2",system-ui,sans-serif',
    'color:#fff8ec', 'background:rgba(24,12,40,.82)', 'padding:.5em 1.1em',
    'border-radius:999px', 'letter-spacing:.01em',
    'box-shadow:0 8px 26px rgba(0,0,0,.45)', 'opacity:0',
    'transition:opacity .28s ease',
  ].join(';')
  document.body.appendChild(bar)

  const LINE = {
    title: 'Pick both heroes — yours, and your partner',
    countdown: 'Get ready…',
    dancing: 'Left one leads. Right one is you, live from the webcam.',
    results: 'Final score',
  }
  let shown = ''
  const tick = () => {
    const phase = window.__api.phase()
    const line = LINE[phase] ?? ''
    if (line !== shown) {
      shown = line
      bar.style.opacity = '0'
      setTimeout(() => { bar.textContent = line; bar.style.opacity = line ? '1' : '0' }, 200)
    }
    requestAnimationFrame(tick)
  }
  tick()
})

// Linger on the title so the recording opens on something legible.
await page.waitForTimeout(2500)
if (timescale !== 1) await page.evaluate((t) => window.__api.setTimeScale(t), timescale)
await page.evaluate((n) => window.__api.start(n), moves)
const bootSeconds = (Date.now() - recordingStarted) / 1000

const deadline = Date.now() + seconds * 1000
let samples = []
while (Date.now() < deadline) {
  await page.waitForTimeout(1000)
  const snap = await page.evaluate(() => ({
    phase: window.__api.phase(),
    tracker: window.__api.tracker(),
    state: (({ slotIndex, liveScore, bestThisMove, score, seesPlayer }) =>
      ({ slotIndex, liveScore, bestThisMove, score, seesPlayer }))(window.__api.state()),
  }))
  samples.push(snap)
  if (snap.phase === 'results') { await page.waitForTimeout(6000 / timescale); break }
}

const summary = await page.evaluate(() => {
  const s = window.__api.state()
  return {
    phase: s.phase, score: Math.round(s.score), bestCombo: s.bestCombo,
    results: s.results.map((r) => ({ move: r.move.name, score: +r.score.toFixed(2), grade: r.grade })),
  }
})

await context.close()
await browser.close()

const webm = fs.readdirSync(videoDir).map((f) => path.join(videoDir, f)).find((f) => f.endsWith('.webm'))
if (!webm) { console.error('playwright produced no video'); process.exit(1) }
fs.mkdirSync(path.dirname(out), { recursive: true })
// Boot is a progress bar and nobody needs to watch it. Start at the frame the
// title screen appeared, which also drops the blank page before first paint.
const leadOut = 3 / timescale
const trim = Math.max(readySeconds, bootSeconds - leadOut)
const speed = timescale !== 1 ? ['-vf', `setpts=PTS*${timescale},fps=30`] : []
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...(trim > 0 ? ['-ss', String(trim)] : []), '-i', webm, ...speed,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', out])
fs.rmSync(videoDir, { recursive: true, force: true })

const tracked = samples.filter((s) => s.state.seesPlayer).length
console.log(`\ntracker: ${samples.at(-1)?.tracker.state}, ` +
  `${samples.at(-1)?.tracker.fps.toFixed(1)} fps, ${samples.at(-1)?.tracker.ms.toFixed(0)}ms/frame`)
console.log(`saw a body in ${tracked}/${samples.length} samples`)
console.log('final:', JSON.stringify(summary, null, 2))
console.log('problems:', problems.slice(0, 5).join(' | ') || 'none')
console.log(`\n${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
