// Renders marketing/film/spec/{paint,paint-drawing,end}.html at 1080x1920 (x3) with the film assets beside them;
// the end card once per Violet frame (arg: a folder of 0000.png...). Run it in a copy of spec/ holding painted.png,
// violet-drawing.webp, violet-alive.webp. The film then plays the results as seq segments.
import { chromium } from 'playwright'
import fs from 'node:fs'
const dir = process.cwd()
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 })
for (const f of ['paint', 'paint-drawing']) {
  await p.goto(`file://${dir}/${f}.html`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300)
  await p.screenshot({ path: `${f}.png` })
}
// End card: one frame per Violet frame, in the spec page itself.
fs.mkdirSync('end', { recursive: true })
await p.goto(`file://${dir}/end.html`); await p.evaluate(() => document.fonts.ready)
const src = process.argv[2], n = fs.readdirSync(src).length
for (let i = 0; i < n; i++) {
  const u = `file://${src}/${String(i).padStart(4, '0')}.png`
  await p.evaluate(async (u) => { const im = document.querySelector('.alive img'); im.src = u; await im.decode() }, u)
  await p.screenshot({ path: `end/${String(i).padStart(4, '0')}.png` })
}
await b.close()
