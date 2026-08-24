import { chromium } from 'playwright'

/**
 * Drives Hero Cam against a synthesised player clip (tools/make_test_video.py)
 * and asserts that calibration completes and every gesture fires its action.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5181/'
const video = process.argv[3]
const shot = process.argv[4] ?? '/tmp/cam.png'

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
              '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
if (video) args.push(`--use-file-for-fake-video-capture=${video}`)

const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] })
const page = await ctx.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()) })
page.on('pageerror', e => logs.push('[pageerror] ' + e.message))

await page.goto(url, { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })

// Record every action the cam injects, then start the run.
await page.evaluate(() => {
  window.__camActions = []
  const orig = window.__input.push.bind(window.__input)
  window.__input.push = (a) => { window.__camActions.push(a); orig(a) }
})
await page.getByRole('button', { name: /HERO CAM/ }).click()
await page.waitForTimeout(3000)
await page.evaluate(() => window.__api.play())

const samples = []
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(1000)
  samples.push(await page.evaluate(() => {
    const c = window.__camDebug?.()
    return { status: document.getElementById('camStatus')?.textContent?.slice(0, 34), r: c }
  }))
}
await page.screenshot({ path: shot })
const result = await page.evaluate(() => ({
  actions: window.__camActions,
  status: document.getElementById('camStatus')?.textContent,
  lane: window.__api.debug().lane,
}))
const counts = {}
for (const a of result.actions) counts[a] = (counts[a] ?? 0) + 1
console.log('STATUS  ', result.status)
console.log('ACTIONS ', JSON.stringify(counts))
console.log('SEQUENCE', result.actions.join(','))
console.log('SAMPLES ', samples.map(s => JSON.stringify(s.r)).join('\n          '))
console.log('ERRORS  ', logs.slice(0, 6).join(' | ') || 'none')
await browser.close()
