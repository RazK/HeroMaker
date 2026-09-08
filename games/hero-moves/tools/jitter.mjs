import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * How much does the tracked skeleton shake when the player does not move?
 *
 * "The characters flicker" is a real report and a vague one, so this turns it
 * into a number: hold the camera on a body that is standing still, sample the
 * wrists and shoulders over many inferences, and report how far they wander.
 * Then do it again with the landmark filter switched off, so the filter has to
 * justify itself rather than be believed.
 *
 * Usage: jitter.mjs [--video=/tmp/party/p1.y4m] [--players=1] [--for=70]
 */
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feed = flag('video', '/tmp/party/p1.y4m')
const players = Number(flag('players', 1))
const seconds = Number(flag('for', 70))
const base = flag('url', 'http://127.0.0.1:5183')
if (!fs.existsSync(feed)) { console.error(`no feed at ${feed}`); process.exit(1) }

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`],
})
const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
await page.context().grantPermissions(['camera'])
await page.goto(`${base}?lite=1`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.evaluate((n) => window.__api.setPlayers(n), players)
await page.evaluate(() => window.__api.wake())
await page.waitForFunction(() => window.__api.ready() === 'ready', null, { timeout: 180000 })

const JOINTS = ['leftWrist', 'rightWrist', 'leftShoulder', 'rightShoulder']

async function measure(smoothing) {
  await page.evaluate((on) => window.__api.setSmoothing(on), smoothing)
  const seen = new Set()
  const runs = new Map(JOINTS.map((j) => [j, []]))
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    await page.waitForTimeout(120)
    const d = await page.evaluate(() => {
      const x = window.__api.laneDebug(0)
      return { at: x.at, points: x.points }
    })
    if (!d.at || seen.has(d.at)) continue
    seen.add(d.at)
    for (const p of d.points) {
      if (!runs.has(p.name) || p.s < 0.3) continue
      runs.get(p.name).push([p.x, p.y])
    }
  }
  // Mean step between consecutive inferences: the frame-to-frame shake a
  // viewer actually sees, rather than spread around a mean, which a slow drift
  // would inflate just as much as jitter would.
  const out = {}
  for (const [j, pts] of runs) {
    let sum = 0, n = 0
    for (let i = 1; i < pts.length; i++) {
      sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      n++
    }
    out[j] = n ? sum / n : NaN
  }
  out.__samples = seen.size
  return out
}

const raw = await measure(false)
const filtered = await measure(true)
await browser.close()

console.log('mean step between inferences, in lane widths (lower is steadier)\n')
console.log(`  ${'joint'.padEnd(15)}${'raw'.padStart(9)}${'filtered'.padStart(11)}${'change'.padStart(10)}`)
for (const j of JOINTS) {
  const a = raw[j], b = filtered[j]
  const pct = Number.isFinite(a) && Number.isFinite(b) ? `${(((b - a) / a) * 100).toFixed(0)}%` : '-'
  console.log(`  ${j.padEnd(15)}${a.toFixed(4).padStart(9)}${b.toFixed(4).padStart(11)}${pct.padStart(10)}`)
}
console.log(`\n  ${raw.__samples} raw / ${filtered.__samples} filtered inferences sampled`)
