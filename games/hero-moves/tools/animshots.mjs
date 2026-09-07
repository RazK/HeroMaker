/**
 * Contact sheet for the animation lab: one PNG per requested timestamp, plus a
 * single montage, so a retarget can be judged without rendering a whole video.
 *
 * Usage: node tools/animshots.mjs outDir t0,t1,t2,... [--avatar=Crayon_Kid]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] ?? '/tmp/animshots'
const times = (process.argv[3] ?? '0,1,2,3').split(',').map(Number)
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const avatar = flag('avatar', 'Crayon_Kid')
const base = flag('url', 'http://127.0.0.1:5182')
const W = Number(flag('w', 480)), H = Number(flag('h', 300))
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg'

fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()) })

await page.goto(`${base}/animlab.html?a=${avatar}&w=${W}&h=${H}&still=1`, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 })
console.log(JSON.stringify(await page.evaluate(() => window.__clips), null, 1))
console.log('duration', await page.evaluate(() => window.__duration))

const cdp = await page.context().newCDPSession(page)
const files = []
for (const t of times) {
  await page.evaluate((x) => window.__setTime(x), t)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const f = path.join(outDir, `s${String(files.length).padStart(3, '0')}.png`)
  fs.writeFileSync(f, Buffer.from(shot.data, 'base64'))
  files.push(f)
}
await browser.close()

const cols = Math.min(4, files.length)
const rows = Math.ceil(files.length / cols)
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '1',
  '-i', path.join(outDir, 's%03d.png'), '-vf', `tile=${cols}x${rows}`,
  '-frames:v', '1', path.join(outDir, 'sheet.png')])
console.log('sheet:', path.join(outDir, 'sheet.png'))
