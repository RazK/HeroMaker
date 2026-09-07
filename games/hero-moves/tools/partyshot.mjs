import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * Screenshots one screen of the party game at a given viewport.
 *
 * Usage: partyshot.mjs OUT.png [--w=] [--h=] [--phase=menu|countdown|dancing|paused|results]
 *                              [--players=3] [--len=short] [--video=feed.y4m]
 */
const out = process.argv[2] ?? '/tmp/shots/party.png'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const W = Number(flag('w', 1280)), H = Number(flag('h', 720))
const phase = flag('phase', 'menu')
const players = Number(flag('players', 3))
const feed = flag('video', '/tmp/party/p3.y4m')
const base = flag('url', 'http://127.0.0.1:5183')

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
if (fs.existsSync(feed)) args.push(`--use-file-for-fake-video-capture=${feed}`)

const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.context().grantPermissions(['camera'])
await page.goto(base, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.evaluate((n) => window.__api.setPlayers(n), players)
await page.evaluate((l) => window.__api.setLength(l), flag('len', 'short'))
await page.waitForTimeout(Number(flag('settle', 4000)))

if (phase !== 'menu' && !fs.existsSync(feed)) {
  await page.evaluate((p) => window.__api.stage(p), phase)
  await page.waitForTimeout(1200)
} else if (phase !== 'menu') {
  await page.evaluate(() => window.__api.setTimeScale(0.5))
  await page.evaluate(() => window.__api.start(4242))
  await page.waitForFunction((p) => window.__api.phase() === p,
    phase === 'paused' || phase === 'results' ? 'dancing' : phase, { timeout: 180000 })
  await page.waitForTimeout(Number(flag('into', 2500)))
  if (phase === 'paused') { await page.evaluate(() => window.__api.pause()); await page.waitForTimeout(600) }
  if (phase === 'results') { await page.evaluate(() => window.__api.finish()); await page.waitForTimeout(800) }
}
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
await page.screenshot({ path: out })
await browser.close()
console.log(out)
