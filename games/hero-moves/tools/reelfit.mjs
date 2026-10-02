import { chromium } from 'playwright'

/**
 * Does the Stunt Reel fit, at the sizes it actually gets? And is it laid out
 * the way it is meant to be: the moves a centred bar along the bottom, one row
 * in landscape and two in portrait?
 *
 * Twice now a card has shipped that overflowed on a real phone and looked
 * fine at the size it was developed at. The reel puts a fixed control panel at
 * the foot of the screen and gives the rest to the stage, so the two failure
 * modes are a panel taller than the viewport and a stage squeezed to nothing.
 * Both are measured here rather than eyeballed.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5183/reel.html'

const SIZES = [
  { name: 'phone-small  ', w: 320, h: 480 },
  { name: 'phone-in-view', w: 385, h: 560 },
  { name: 'phone-tall   ', w: 412, h: 660 },
  { name: 'phone-full   ', w: 430, h: 900 },
  { name: 'tablet       ', w: 820, h: 900 },
  { name: 'landscape    ', w: 900, h: 430 },
  { name: 'desktop      ', w: 1440, h: 900 },
]
/** Below this the performance is not worth watching, which is the whole game. */
const MIN_STAGE_FRACTION = 0.34

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

let bad = 0
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } })
  await page.route('**://fonts.g*/**', (r) => r.abort())
  await page.goto(url, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
  await page.waitForTimeout(400)


  const m = await page.evaluate(() => {
    const panel = document.querySelector('.reel-panel')
    const r = panel.getBoundingClientRect()
    const deck = document.querySelector('.reel-card').getBoundingClientRect()
    const cards = [...document.querySelectorAll('.reel-card')].map((c) => c.getBoundingClientRect())
    const left = Math.min(...cards.map((c) => c.left)), right = Math.max(...cards.map((c) => c.right))
    return {
      rows: new Set(cards.map((c) => Math.round(c.top))).size,
      // Symmetry: how far the block of cards sits off the middle of the screen.
      offCentre: Math.round(Math.abs((left + right) / 2 - innerWidth / 2)),
      panelH: Math.round(r.height),
      panelW: Math.round(r.width),
      viewH: innerHeight,
      viewW: innerWidth,
      belowBottom: Math.max(0, Math.round(r.bottom - innerHeight)),
      aboveTop: Math.max(0, Math.round(-r.top)),
      docScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      tapTarget: Math.round(Math.min(deck.width, deck.height)),
    }
  })
  await page.close()

  // The moves are a bar along the bottom on every orientation: one row of
  // eight when the screen is wider than tall, a 4x2 grid when it is not.
  const landscape = size.w > size.h
  const stageFraction = 1 - m.panelH / m.viewH
  const problems = []
  const wantRows = landscape ? 1 : 2
  if (m.rows !== wantRows) problems.push(`${m.rows} rows of moves, want ${wantRows}`)
  if (m.offCentre > 1) problems.push(`moves ${m.offCentre}px off centre`)
  if (m.belowBottom > 0) problems.push(`panel ${m.belowBottom}px below the fold`)
  if (m.aboveTop > 0) problems.push(`panel ${m.aboveTop}px above the top`)
  if (m.docScroll > 0) problems.push(`page scrolls ${m.docScroll}px`)
  if (stageFraction < MIN_STAGE_FRACTION) {
    problems.push(`stage only ${(stageFraction * 100).toFixed(0)}%`)
  }
  // 40px is about the smallest reliably tappable target on a touch screen.
  if (m.tapTarget < 40) problems.push(`deck buttons ${m.tapTarget}px`)

  if (problems.length) bad++
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${size.name} ${String(size.w).padStart(4)}x${String(size.h).padEnd(4)}` +
    `  panel ${String(m.panelH).padStart(3)}px  stage ${(stageFraction * 100).toFixed(0).padStart(3)}%` +
    `  tap ${String(m.tapTarget).padStart(2)}px` +
    (problems.length ? `   ${problems.join('; ')}` : ''))
}
await browser.close()
console.log(bad ? `\n${bad} size(s) need work` : '\nfits everywhere')
process.exit(bad ? 1 : 0)
