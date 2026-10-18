/**
 * Screenshots of the Hero Class landing page: full page and the reservation
 * sheet, at the brand book's viewports. Fails if anything scrolls sideways.
 *
 *   node tools/classlanding.mjs <out-dir> [WxH,WxH,...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, newPage, waitForFonts } from './classlib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const [out = 'landing', sizes = '390x844,360x640,1280x800'] = process.argv.slice(2)
const base = process.env.CLASS_URL ?? 'http://127.0.0.1:4194/class.html'
// The app serves its logo from its own root; the game build does not have it.
const logo = path.join(here, '../../../frontend/public/logo-head-transparent.png')
fs.mkdirSync(out, { recursive: true })
const browser = await launch()
let bad = 0
for (const size of sizes.split(',')) {
  const [width, height] = size.split('x').map(Number)
  for (const sheet of ['', '1']) {
    const page = await newPage(browser, { width, height })
    await page.route('**/logo-head-transparent.png', (r) => r.fulfill({ path: logo, contentType: 'image/png' }))
    await page.goto(`${base}${sheet ? '?sheet=' + sheet : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForFonts(page)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete))
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (over > 0) { bad++; console.log(`${size}${sheet ? ' sheet' : ''}: scrolls sideways by ${over}px`) }
    const file = `${out}/class-landing-${size}${sheet ? '-sheet' : ''}.png`
    // A full-page picture of a page with a sticky bar would paint the bar mid-page; put it at the end.
    if (!sheet) await page.addStyleTag({ content: '.cl-bar { position: static !important; }' })
    await page.screenshot({ path: file, fullPage: !sheet })
    console.log(file)
    await page.close()
  }
}
await browser.close()
process.exit(bad ? 1 : 0)
