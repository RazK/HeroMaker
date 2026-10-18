/**
 * Renders the game chooser's key art (poster.html) from a real hero VRM and
 * writes PNGs; tools/posters-webp.py turns them into the WebPs the app ships
 * in frontend/public/games/.
 *
 *   npx vite preview --port 4188 --strictPort &
 *   node tools/make-posters.mjs /path/Violet_Volt.vrm out/ [rumble] [dance]
 *
 * A job can override the frame, e.g. `dance:t=0.7,yaw=-0.1` (written as
 * dance-t_0.7_yaw_0.1.png), to compare candidates before changing a default.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()
const [vrm, OUT, ...jobs] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const job of jobs.length ? jobs : ['rumble', 'dance']) {
  const [kind, extra = ''] = job.split(':')
  const page = await browser.newPage({ viewport: { width: 500, height: 600 } })
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.route('**/hero.vrm', (r) => r.fulfill({ body: fs.readFileSync(vrm), contentType: 'application/octet-stream' }))
  await page.goto(`http://127.0.0.1:4188/poster.html?vrm=/hero.vrm&kind=${kind}&w=800&h=1000&${extra.replace(/,/g, '&')}`)
  await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 180000 })
  const ready = await page.evaluate(() => window.__ready)
  if (ready !== true) throw new Error(`${kind}: ${ready}`)
  await page.evaluate(() => document.fonts.ready)
  const data = await page.evaluate(() => window.__poster())
  const file = path.join(OUT, `${kind}${extra ? '-' + extra.replace(/[^a-z0-9.]+/gi, '_') : ''}.png`)
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
  console.log(file)
  await page.close()
}
await browser.close()
