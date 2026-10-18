/**
 * The printable hero cards: one A6 card as a 300 dpi PNG, and every card as a PDF.
 *
 *   CLASS_FILES=<dir> node tools/classcards.mjs <out-dir> [origin for the QR codes]
 */
import fs from 'node:fs'
import { launch, routeApi, waitForFonts } from './classlib.mjs'

const [out = 'cards', origin = ''] = process.argv.slice(2)
const base = process.env.CLASS_URL ?? 'http://127.0.0.1:4194/class-card.html'
fs.mkdirSync(out, { recursive: true })
const browser = await launch()
// A6 is 105 mm wide: 396.85 CSS px. 3.125x makes the card 1240 px wide, 300 dpi.
const page = await browser.newPage({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 3.125, ignoreHTTPSErrors: true })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await routeApi(page)
const q = origin ? `?origin=${encodeURIComponent(origin)}` : ''
await page.goto(base + q, { waitUntil: 'domcontentloaded', timeout: 120000 })
await waitForFonts(page)
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
const cards = await page.$$('.cc-card')
for (let i = 0; i < Math.min(cards.length, Number(process.env.PNGS ?? 1)); i++) {
  await cards[i].screenshot({ path: `${out}/qr-card${i ? '-' + i : ''}.png` })
}
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: `${out}/class-cards.pdf`, width: '105mm', height: '148mm', printBackground: true, preferCSSPageSize: true })
console.log(`${cards.length} cards -> ${out}`)
await browser.close()
