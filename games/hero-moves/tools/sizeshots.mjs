import { chromium } from 'playwright'
import fs from 'node:fs'
const url = process.argv[2], out = process.argv[3]
const sizes = [[385,560,'in-viewer'],[412,660,'tall'],[320,480,'small']]
const browser = await chromium.launch({ executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] })
fs.mkdirSync(out, { recursive: true })
for (const [w,h,name] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.route('**://fonts.g*/**', r => r.abort())
  const cdp = await page.context().newCDPSession(page); await cdp.send('Page.enable')
  await page.goto(url, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 })
  await page.waitForTimeout(900)
  let s = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${out}/menu-${name}.png`, Buffer.from(s.data, 'base64'))
  await page.evaluate(() => window.__api.play())
  await page.waitForFunction(() => window.__api.phase() === 'running', null, { timeout: 30000 })
  await page.evaluate(() => window.__api.endRun())
  await page.waitForTimeout(2400)
  s = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${out}/score-${name}.png`, Buffer.from(s.data, 'base64'))
  await page.close()
  console.log(name, 'ok')
}
await browser.close()
