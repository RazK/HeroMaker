import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
await page.goto('http://127.0.0.1:5181/', { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
await page.evaluate(() => { window.__api.setTimeScale(1); window.__api.play() })
await page.waitForFunction(() => window.__api.phase() === 'running', null, { timeout: 30000 })
await page.waitForTimeout(600)

// Project the hero's world position into screen space to see which way is which.
const probe = async (label) => {
  await page.waitForTimeout(700)
  return page.evaluate((label) => {
    const g = window.__game
    const hero = g.hero.root.position.clone()
    hero.y += 1
    const ndc = hero.project(g.camera)
    return { label, lane: window.__api.debug().lane, worldX: +window.__api.debug().x.toFixed(2), screenX: +ndc.x.toFixed(3) }
  }, label)
}
const out = []
out.push(await probe('start(lane1)'))
await page.evaluate(() => window.__api.act('left'))
out.push(await probe("after 'left'"))
await page.evaluate(() => { window.__api.act('right'); })
await page.waitForTimeout(500)
await page.evaluate(() => { window.__api.act('right'); })
out.push(await probe("after 'right' x2"))
console.log(out.map(o => JSON.stringify(o)).join('\n'))
console.log('\nscreenX: -1 = left edge, +1 = right edge')
await browser.close()
