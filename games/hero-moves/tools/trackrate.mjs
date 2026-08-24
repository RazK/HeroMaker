import { chromium } from 'playwright'
/** Measures how fast MoveNet actually runs here, with the fake camera attached. */
const feed = process.argv[3] ?? '/tmp/dancer-follow/dancer.y4m'
const b = await chromium.launch({ executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`] })
const ctx = await b.newContext({ viewport:{width:900,height:600}, permissions:['camera'] })
const p = await ctx.newPage()
await p.goto(process.argv[2], { waitUntil:'load', timeout:180000 })
await p.waitForFunction(() => window.__ready === true, null, { timeout:300000 })
await p.evaluate(() => window.__api.start())
await p.waitForTimeout(25000)
console.log('tracker:', JSON.stringify(await p.evaluate(() => window.__api.tracker())))
await b.close()
