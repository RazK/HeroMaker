/**
 * Stills of the class stage at chosen show times, for looking at.
 *
 *   CLASS_FILES=<dir> node tools/classshot.mjs <out-dir> [w]x[h] t1,t2,...  [query]
 *
 * Prints the load timings and the per-hero measurements the layout used.
 */
import fs from 'node:fs'
import { launch, openStage } from './classlib.mjs'

const [out = 'shots', size = '1280x720', times = '1,5,9', query = ''] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
const base = process.env.CLASS_URL ?? 'http://127.0.0.1:4194/class-stage.html'
fs.mkdirSync(out, { recursive: true })

const browser = await launch()
const { page, wall } = await openStage(browser, { url: `${base}?record=1${query ? '&' + query : ''}`, width, height })
console.log('ready in', wall, 'ms', JSON.stringify(await page.evaluate(() => window.__perf)))
console.log(JSON.stringify(await page.evaluate(() => window.__kids()), null, 0))
const list = times.split(',').map(Number)
let prev = 0
for (const t of list) {
  // Step up to t at 30 fps so spring bones and anything stateful settle as they would live.
  for (let x = prev; x < t; x += 1 / 30) await page.evaluate((x) => window.__setTime(x, false), x)
  await page.evaluate((x) => window.__setTime(x), t)
  prev = t
  const file = `${out}/t${String(t).padStart(5, '0')}-${width}x${height}.png`
  const s0 = Date.now()
  await page.screenshot({ path: file })
  console.log('shot ms', Date.now() - s0)
  console.log(file)
}
console.log(JSON.stringify(await page.evaluate(() => window.__renderInfo())))
await browser.close()
