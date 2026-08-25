import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * Screenshots the in-game HUD at a given phase and viewport, with the fake
 * camera running so the camera panel and tracking overlay are real.
 *
 * Usage: hudshot.mjs OUT.png [--w=1280] [--h=720] [--phase=copy] [--avatar=0]
 */
const out = process.argv[2] ?? '/tmp/shots/hud.png'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const W = Number(flag('w', 1280)), H = Number(flag('h', 720))
const phase = flag('phase', 'dancing')
const avatar = Number(flag('avatar', 0))
const feed = flag('video', '/tmp/dancer/dancer.y4m')
const base = flag('url', 'http://127.0.0.1:5183')

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
if (fs.existsSync(feed)) args.push(`--use-file-for-fake-video-capture=${feed}`)

const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.context().grantPermissions(['camera'])
await page.goto(base, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
if (avatar > 0) { await page.evaluate((i) => window.__api.pick(i), avatar); await page.waitForTimeout(2500) }
const partner = Number(flag('partner', -1))
if (partner >= 0) { await page.evaluate((i) => window.__api.pickLeader(i), partner); await page.waitForTimeout(2500) }
if (phase !== 'title') {
  await page.evaluate(() => window.__api.setTimeScale(0.5))
  await page.evaluate(() => window.__api.start())
  await page.waitForFunction((p) => window.__api.phase() === p, phase, { timeout: 180000 })
  await page.waitForTimeout(1200)
}
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
await page.screenshot({ path: out })
await browser.close()
console.log(out)
