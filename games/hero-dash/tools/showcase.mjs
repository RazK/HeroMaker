import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Plays a full run and grabs one screenshot the first time each gameplay
 * state appears, so the shot set always covers every animation the rig does.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5181/'
const outDir = process.argv[3] ?? '/tmp/showcase'
const W = Number(process.env.SHOT_W ?? 1440), H = Number(process.env.SHOT_H ?? 900)
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const logs = []
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })

const shot = (name) => page.screenshot({ path: path.join(outDir, name + '.png') })
const wait = (ms) => page.waitForTimeout(ms)

await wait(1500); await shot('01-menu-crayon-kid')
await page.evaluate(() => window.__api.pick(2))          // Superstar
await wait(2500); await shot('02-menu-superstar')
await page.evaluate(() => window.__api.pick(0))
await wait(2000)

const botSrc = fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8')
await page.evaluate(botSrc)
await page.evaluate((s) => window.__api.setTimeScale(s), Number(process.env.TIME_SCALE ?? 2))
await page.evaluate(() => window.__api.play())
await wait(1000); await shot('03-countdown')

const want = new Map([
  ['run', '04-running'],
  ['jump', '05-jump'],
  ['slide', '06-slide'],
  ['pose', '07-star-pose'],
  ['fly', '08-hero-time'],
  ['stumble', '09-crash'],
])
const seen = new Set()
const deadline = Date.now() + 150000
while (seen.size < want.size && Date.now() < deadline) {
  const st = await page.evaluate(() => (window.__api.phase() === 'running' ? window.__api.debug().state : null))
  if (st && want.has(st) && !seen.has(st)) {
    // Let the pose settle before capturing it.
    await wait(st === 'fly' ? 900 : 90)
    const still = await page.evaluate(() => window.__api.debug().state)
    if (still === st) { await shot(want.get(st)); seen.add(st) }
  }
  if (await page.evaluate(() => window.__api.phase() === 'over')) break
  await wait(50)
}
console.log('CAPTURED', [...seen].join(','))

await page.evaluate(() => { window.__bot.on = false })
await page.waitForFunction(() => window.__api.phase() === 'over', null, { timeout: 90000 }).catch(() => {})
await wait(2600); await shot('10-score')
console.log('FINAL', JSON.stringify(await page.evaluate(() => window.__api.stats())))
console.log('ERRORS', logs.slice(0, 5).join(' | ') || 'none')
await browser.close()
