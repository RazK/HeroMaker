import { chromium } from 'playwright'

/**
 * Runs the vocabulary gate and prints a confusion matrix.
 *
 * Exit code is 1 if any call is misread often enough to matter, so this can
 * stand as a build gate rather than a thing somebody remembers to look at.
 */
const base = process.argv[2] ?? 'http://127.0.0.1:5183'
const only = process.argv.find((a) => a.startsWith('--avatar='))?.split('=')[1]

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 560, height: 620 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const url = `${base}/posegate.html${only ? `?a=${encodeURIComponent(only)}` : ''}`
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 1800000 })
const rows = await page.evaluate(() => window.__rows)
const sep = await page.evaluate(() => window.__separation)
await browser.close()

const ids = [...new Set(rows.map((r) => r.want))]
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

// --- vocabulary separation, before any tracking noise -----------------------
console.log('\nClosest pairs in the vocabulary itself (bigger is safer):')
for (const s of sep.slice(0, 4)) console.log(`  ${pad(s.a, 9)} vs ${pad(s.b, 9)} ${s.d.toFixed(3)}`)

// --- confusion matrix ------------------------------------------------------
const byAvatar = [...new Set(rows.map((r) => r.avatar))]
function matrix(subset, title) {
  console.log(`\n${title}  (rows = posed, cols = read as)`)
  console.log('  ' + pad('', 10) + ids.map((i) => lpad(i.slice(0, 7), 8)).join('') + lpad('acc', 8))
  let correct = 0, total = 0
  for (const want of ids) {
    const mine = subset.filter((r) => r.want === want)
    const counts = ids.map((got) => mine.filter((r) => r.got === got).length)
    const hit = mine.filter((r) => r.got === want).length
    correct += hit; total += mine.length
    const acc = mine.length ? (hit / mine.length) * 100 : 0
    console.log('  ' + pad(want, 10) +
      counts.map((c, k) => lpad(c === 0 ? '·' : c, 8) + (ids[k] === want ? '' : '')).join('') +
      lpad(`${acc.toFixed(0)}%`, 8))
  }
  const overall = total ? (correct / total) * 100 : 0
  console.log(`  ${pad('', 10)}${' '.repeat(8 * ids.length)}${lpad(`${overall.toFixed(1)}%`, 8)}  overall`)
  return overall
}

// An avatar the tracker cannot see at all is not a failing classifier, it is an
// invalid stand-in — MoveNet is trained on people, and four of this roster are a
// teddy bear, a star, a cartoon skeleton and a cloud. Conflating the two makes
// the instrument lie about which thing is broken.
const readable = []
const unreadable = []
for (const a of byAvatar) {
  const mine = rows.filter((r) => r.avatar === a)
  const seen = mine.filter((r) => r.got !== null).length
  ;(seen / mine.length >= 0.5 ? readable : unreadable).push({ a, seen, total: mine.length })
}
if (unreadable.length) {
  console.log('\nNot readable by MoveNet — excluded from the verdict:')
  for (const u of unreadable) {
    console.log(`  ${pad(u.a, 14)} ${u.seen}/${u.total} frames produced any skeleton at all`)
  }
  console.log('  (MoveNet is trained on people. These are stand-ins, not players.)')
}

const scored = rows.filter((r) => readable.some((x) => x.a === r.avatar))
if (!scored.length) {
  console.log('\nNo readable subject in this run — nothing to conclude.')
  process.exit(1)
}
const overall = matrix(scored, 'READABLE AVATARS')
for (const { a } of readable) matrix(rows.filter((r) => r.avatar === a), a)

// --- distance distribution, for calibrating the guards ---------------------
// The classifier can be right on every frame and still reject them all if the
// accept thresholds were guessed rather than measured. These are the numbers to
// set them from.
const pct = (arr, p) => {
  const a = arr.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y)
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN
}
const right = scored.filter((r) => r.got === r.want)
const wrong = scored.filter((r) => r.got !== null && r.got !== r.want)
console.log('\nDistance to the winning pose (correct frames):')
console.log(`  median ${pct(right.map((r) => r.distance), .5)?.toFixed(3)}` +
  `  p90 ${pct(right.map((r) => r.distance), .9)?.toFixed(3)}` +
  `  p99 ${pct(right.map((r) => r.distance), .99)?.toFixed(3)}`)
console.log('Margin over the runner-up (correct frames):')
console.log(`  median ${pct(right.map((r) => r.margin), .5)?.toFixed(3)}` +
  `  p10 ${pct(right.map((r) => r.margin), .1)?.toFixed(3)}` +
  `  min ${pct(right.map((r) => r.margin), 0)?.toFixed(3)}`)
if (wrong.length) {
  console.log('Margin on the frames it got WRONG (a good guard sits below these):')
  console.log(`  median ${pct(wrong.map((r) => r.margin), .5)?.toFixed(3)}` +
    `  max ${pct(wrong.map((r) => r.margin), 1)?.toFixed(3)}`)
}

// --- what the guards reject ------------------------------------------------
const accepted = scored.filter((r) => r.accepted !== null)
const acceptedRight = accepted.filter((r) => r.accepted === r.want).length
console.log(`\nWith the confidence guards on:`)
console.log(`  accepted ${accepted.length}/${scored.length} frames ` +
  `(${((accepted.length / scored.length) * 100).toFixed(0)}%)`)
console.log(`  of those accepted, ${acceptedRight}/${accepted.length} correct ` +
  `(${accepted.length ? ((acceptedRight / accepted.length) * 100).toFixed(1) : 0}%)`)
console.log(`  i.e. it says "I don't know" instead of guessing wrong ` +
  `${scored.length - accepted.length} times`)

// --- the verdict -----------------------------------------------------------
const perPose = ids.map((want) => {
  const mine = scored.filter((r) => r.want === want)
  return { want, acc: mine.filter((r) => r.got === want).length / mine.length }
})
const weak = perPose.filter((p) => p.acc < 0.7)
console.log('')
if (weak.length) {
  console.log(`GATE FAILED: ${weak.map((w) => `${w.want} ${(w.acc * 100).toFixed(0)}%`).join(', ')}`)
  process.exit(1)
}
console.log(`GATE PASSED: every call read correctly at least 70% of the time, ${overall.toFixed(1)}% overall`)
