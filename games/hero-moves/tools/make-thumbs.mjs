import { chromium } from 'playwright'
import fs from 'node:fs'

const url = process.argv[2] ?? 'http://127.0.0.1:5181/thumbs.html'
const outDir = process.argv[3] ?? 'assets/avatars'
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 600, height: 600 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
const thumbs = await page.evaluate(() => window.__thumbs)
for (const [id, dataUrl] of Object.entries(thumbs)) {
  const b64 = dataUrl.split(',')[1]
  const buf = Buffer.from(b64, 'base64')
  fs.writeFileSync(`${outDir}/${id}.thumb.webp`, buf)
  console.log(id, (buf.length / 1024).toFixed(1) + ' KB')
}
await browser.close()
