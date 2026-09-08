import { chromium } from 'playwright'

/**
 * Does the party menu fit, at the sizes it actually gets?
 *
 * The menu grew a camera preview and a row of heroes per player, and every one
 * of those is a thing that can push the start button off the bottom of a phone.
 * That has now happened twice, both times invisible at the size the screen was
 * built at, so it is measured rather than eyeballed: the card must fit inside
 * the viewport, the button must stay a thumb's size, and the stage must keep
 * enough of the screen to be worth looking at.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5183/'
const SIZES = [
  { name: 'phone-small  ', w: 320, h: 480 },
  { name: 'phone-in-view', w: 385, h: 560 },
  { name: 'phone-tall   ', w: 412, h: 660 },
  { name: 'phone-full   ', w: 430, h: 900 },
  { name: 'tablet       ', w: 820, h: 900 },
  { name: 'landscape    ', w: 900, h: 430 },
  { name: 'desktop      ', w: 1440, h: 900 },
]
/** A control smaller than this is one a child misses. */
const MIN_TAP = 40
/** Below this a hero portrait is a smudge; the picker is the whole screen. */
const MIN_TILE = 52
/** Below this the heroes are not worth looking at, which is the whole game. */
const MIN_STAGE_FRACTION = 0.3

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
  // Three players is the tallest the menu ever gets.
  await page.evaluate(() => window.__api.setPlayers(3))
  await page.waitForTimeout(600)

  const m = await page.evaluate(() => {
    const card = document.querySelector('#title .card')
    const r = card.getBoundingClientRect()
    const btn = card.querySelector('.btn').getBoundingClientRect()
    const cardW = Math.round(r.width)
    // The gallery is the reason this screen exists, so its tile size is the
    // thing worth asserting: a hero you cannot make out is a hero you cannot
    // choose.
    const tiles = [...card.querySelectorAll('.gtile img')].map((n) => Math.round(n.getBoundingClientRect().width))
    return {
      cardH: Math.round(r.height), cardW, cardTop: Math.round(r.top), cardBottom: Math.round(r.bottom),
      scrolls: card.scrollHeight > card.clientHeight + 1,
      btnH: Math.round(btn.height), btnBottom: Math.round(btn.bottom),
      tile: Math.min(...tiles, 999), tiles: tiles.length, vh: innerHeight, vw: innerWidth,
      landscape: innerWidth > innerHeight,
    }
  })
  // In landscape the card is a column beside the stage, so what is left is
  // width; in portrait it sits under the stage, so what is left is height.
  const stageFrac = m.landscape ? (m.vw - m.cardW) / m.vw : (m.vh - m.cardH) / m.vh
  const problems = []
  if (m.btnH < MIN_TAP) problems.push(`start button ${m.btnH}px`)
  if (m.tiles !== 6) problems.push(`${m.tiles} hero tiles, expected 6`)
  if (m.tile < MIN_TILE) problems.push(`hero portrait ${m.tile}px`)
  if (m.btnBottom > m.vh + 1) problems.push(`start button ${m.btnBottom - m.vh}px below the fold`)
  if (m.cardBottom > m.vh + 1) problems.push(`card overflows by ${m.cardBottom - m.vh}px`)
  if (stageFrac < MIN_STAGE_FRACTION) {
    problems.push(`stage only ${(stageFrac * 100).toFixed(0)}% of the ${m.landscape ? 'width' : 'height'}`)
  }
  const note = m.scrolls ? ' (card scrolls)' : ''
  console.log(`${size.name} ${String(size.w).padStart(4)}x${String(size.h).padStart(3)}  ` +
    `card ${String(m.cardH).padStart(3)}px  btn ${String(m.btnH).padStart(2)}px  ` +
    `hero ${String(m.tile).padStart(3)}px${note}  ${problems.length ? '✗ ' + problems.join('; ') : '✓'}`)
  if (problems.length) bad++
  await page.close()
}
await browser.close()
console.log(bad ? `\n${bad} viewport(s) with problems` : '\nall viewports fit')
process.exit(bad ? 1 : 0)
