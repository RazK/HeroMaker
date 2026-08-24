import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 640, height: 480 } })
p.on('pageerror', e => console.log('[pageerror]', e.message))
await p.goto(process.argv[2], { waitUntil: 'load', timeout: 120000 })
await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
console.log(await p.evaluate(() => ({ duration: window.__duration, search: location.search })))
await b.close()
