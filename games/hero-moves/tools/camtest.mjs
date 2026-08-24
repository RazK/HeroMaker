import { chromium } from 'playwright'
const url = process.argv[2]
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
const r = await page.evaluate(async () => {
  const out = { secure: window.isSecureContext, origin: location.origin, has: !!navigator.mediaDevices?.getUserMedia }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true })
    out.stream = s.getVideoTracks().length
    s.getTracks().forEach(t => t.stop())
  } catch (e) { out.error = `${e.name}: ${e.message}` }
  return out
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
