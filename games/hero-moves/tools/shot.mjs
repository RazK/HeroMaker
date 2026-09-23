import { chromium } from 'playwright'
import fs from 'node:fs'

const url = process.argv[2] ?? 'http://127.0.0.1:5181/'
const out = process.argv[3] ?? 'shot.png'
const waitMs = Number(process.argv[4] ?? 6000)
const W = Number(process.env.SHOT_W ?? 1280), H = Number(process.env.SHOT_H ?? 800)

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--no-sandbox']
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const logs = []
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', r => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`))
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(waitMs)
const probe = await page.evaluate(() => ({ probe: window.__probe ?? null, ready: window.__ready ?? null, dbg: window.__dbg ?? null }))
await page.screenshot({ path: out })
console.log('--- console ---'); console.log(logs.slice(-40).join('\n'))
console.log('--- probe ---'); console.log(JSON.stringify(probe, null, 2))
await browser.close()
