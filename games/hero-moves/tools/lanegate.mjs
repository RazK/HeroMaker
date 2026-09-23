import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * Does the lane tracker read the right pose out of the right lane?
 *
 * This is the ceiling measurement the playbook demands, for the piece the whole
 * party game rests on. It answers the question a recording cannot: when a lane
 * *is* inferred, does the classifier name the pose that lane's dancer is
 * actually making? A slow machine and a broken crop produce the same symptom —
 * a scoreboard of MISS — and only this tells them apart.
 *
 * It works by asking the page which camera frame each lane's answer came from,
 * then computing what the feed was showing at that instant from the same seeded
 * routine the feed was rendered with. So sampling rate cannot affect the score:
 * a lane inferred once a minute is judged on that one answer.
 *
 * Usage: lanegate.mjs [url] [--video=/tmp/party/p3.y4m] [--players=3] [--for=90]
 */
const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:5183'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feed = flag('video', '/tmp/party/p3.y4m')
const players = Number(flag('players', 3))
const seconds = Number(flag('for', 90))
const meta = JSON.parse(fs.readFileSync(feed.replace(/\.y4m$/, '.json'), 'utf8'))

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`],
})
const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.context().grantPermissions(['camera'])
// Lite: this measures the tracker, not the lighting, and shadows here cost
// more than the inference does.
await page.goto(`${base}?lite=1`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.evaluate((n) => window.__api.setPlayers(n), players)
await page.evaluate(() => window.__api.wake())
await page.waitForFunction(() => window.__api.ready() === 'ready', null, { timeout: 180000 })

/** The routine the feed was rendered from, rebuilt in the page's own code. */
const song = await page.evaluate(({ len, seed }) => {
  const s = window.__api.routine(len, seed)
  return s
}, { len: meta.len, seed: meta.seed })

const skills = meta.skill.split(',').map(Number)
/** Which call lane `i` is making at feed time `t`, or null between shapes. */
const expected = (i, t) => {
  if (t < meta.mark) return 'star'
  const skill = skills[i] ?? 1
  const late = (1 - skill) * 1.6
  const bs = 60 / song.bpm
  const beat = (t - meta.mark - song.leadInBeats * bs * meta.scale) / (bs * meta.scale) - late
  const idx = song.slots.findIndex((s) => beat >= s.startBeat && beat < s.startBeat + s.beats)
  if (idx < 0) return null
  const slot = song.slots[idx]
  const flub = skill < 0.7 && idx % 3 === 2
  const wanted = flub ? song.slots[(idx + 2) % song.slots.length].id : slot.id
  // Only judge the middle of a hold: the ramps in and out are deliberately
  // between two shapes, and neither answer would be wrong there.
  const within = beat - slot.startBeat
  if (within < 0.8 || within > slot.beats - 0.7) return null
  return wanted
}

const seen = new Set()
const rows = []
let inferences = 0
let outsideHold = 0
const deadline = Date.now() + seconds * 1000
while (Date.now() < deadline) {
  await page.waitForTimeout(250)
  const labels = await page.evaluate(() => window.__api.laneLabels())
  labels.forEach((l, i) => {
    const key = `${i}:${l.at}`
    if (seen.has(key) || !l.at) return
    seen.add(key)
    inferences++
    const want = expected(i, l.at / 1000)
    if (!want) { outsideHold++; return }
    rows.push({ lane: i, want, got: l.pose, d: l.distance, m: l.margin, up: l.runnerUp, conf: l.conf, w: l.wrists })
  })
}
await browser.close()

console.log(`${inferences} lane inferences, ${outsideHold} of them between shapes`)
if (!rows.length) {
  console.error('no lane samples landed inside a hold — run longer')
  process.exit(1)
}
const byLane = [...new Set(rows.map((r) => r.lane))].sort()
for (const lane of byLane) {
  const mine = rows.filter((r) => r.lane === lane)
  const hit = mine.filter((r) => r.want === r.got).length
  console.log(`lane ${lane}: ${hit}/${mine.length} correct  ` +
    mine.map((r) => `${r.want}${r.want === r.got ? '=' : `!=${r.got ?? 'none'}`}@${r.d}`).join(' '))
}
const hit = rows.filter((r) => r.want === r.got).length
console.log(`\noverall ${hit}/${rows.length} = ${((hit / rows.length) * 100).toFixed(0)}%`)
if (hit < rows.length) {
  console.log('\nfirst few in full:')
  for (const r of rows.slice(0, 6)) console.log('  ' + JSON.stringify(r))
}
process.exit(hit === rows.length ? 0 : 1)
