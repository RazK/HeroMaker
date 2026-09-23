import { chromium } from 'playwright'

/**
 * Reports whether the menu and score cards fit without scrolling, at the
 * viewport sizes the game actually gets.
 *
 * The artifact viewer wraps the page in its own chrome — a title bar and the
 * phone's nav bar — so the usable height is far shorter than a raw device
 * resolution suggests. Testing at 430x900 hid a card that overflows badly on a
 * real phone.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5197/'

const SIZES = [
  { name: 'phone-small  ', w: 320, h: 480 },
  { name: 'phone-in-view', w: 385, h: 560 },
  { name: 'phone-tall   ', w: 412, h: 660 },
  { name: 'phone-full   ', w: 430, h: 900 },
  { name: 'tablet       ', w: 820, h: 900 },
  { name: 'desktop-short', w: 1440, h: 620 },
  { name: 'desktop      ', w: 1440, h: 900 },
]

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

let worst = 0
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } })
  await page.route('**://fonts.g*/**', (r) => r.abort())
  await page.goto(url, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 })
  await page.waitForTimeout(500)

  const measure = (label) => page.evaluate((label) => {
    const layer = document.querySelector('.layer.sheet:not([hidden])')
    const card = layer?.querySelector('.card')
    if (!card) return { label, missing: true }
    const r = card.getBoundingClientRect()
    return {
      label,
      overflow: card.scrollHeight - card.clientHeight,
      aboveTop: Math.max(0, Math.round(-r.top)),
      belowBottom: Math.max(0, Math.round(r.bottom - innerHeight)),
      cardH: Math.round(r.height),
      viewH: innerHeight,
    }
  }, label)

  const menu = await measure('menu')
  // Fake a finished run so the score card can be measured too.
  await page.evaluate(() => window.__api.play())
  await page.waitForFunction(() => window.__api.phase() === 'running', null, { timeout: 30000 })
  await page.evaluate(() => window.__api.endRun())
  await page.waitForTimeout(2200)
  const over = await measure('score')

  for (const m of [menu, over]) {
    if (m.missing) { console.log(`${size.name} ${m.label.padEnd(6)} (not shown)`); continue }
    const bad = m.overflow > 1 || m.belowBottom > 1 || m.aboveTop > 1
    worst = Math.max(worst, m.overflow, m.belowBottom, m.aboveTop)
    console.log(
      `${size.name} ${m.label.padEnd(6)} ${bad ? 'CLIPPED' : 'fits   '}` +
      ` card=${String(m.cardH).padStart(4)}/${String(m.viewH).padStart(4)}` +
      ` scroll=${String(m.overflow).padStart(4)} above=${m.aboveTop} below=${m.belowBottom}`)
  }
  await page.close()
}
console.log(`\nworst overflow: ${worst}px`)
await browser.close()
