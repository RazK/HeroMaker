// node stepsshot.js <label>  -> shots/<label>-steps-<w>.png (local admin, scrolled to the bottom)
const { chromium } = require('playwright');
const S = __dirname;
const tok = require('fs').readFileSync(S + '/localbe/tok', 'utf8').trim();
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript((t) => { localStorage.setItem('heromaker_jwt_token', t); localStorage.setItem('heromaker_adult_confirmed', '1'); }, tok);
    const p = await ctx.newPage();
    await p.goto('http://localhost:4181/hero/8002e95d-c908-4090-9675-497c16afe0ca/steps', { waitUntil: 'networkidle' });
    await p.waitForSelector('.adm-step', { timeout: 30000 });
    await p.waitForTimeout(1500);
    for (const [name, frac] of [['mid', 0.55], ['end', 1]]) {
      await p.evaluate((frac) => { for (const e of [document.scrollingElement, ...document.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 50 && (e === document.scrollingElement || /auto|scroll/.test(getComputedStyle(e).overflowY))) e.scrollTop = (e.scrollHeight - e.clientHeight) * frac; }, frac);
      await p.waitForTimeout(500);
      const bar = await p.locator('.tb-bar').boundingBox();
      await p.screenshot({ path: `shots/${process.argv[2]}-steps-${name}-${w}.png`, clip: { x: 0, y: Math.max(0, bar.y - 220), width: w, height: Math.min(h - Math.max(0, bar.y - 220), 220 + bar.height) } });
    }
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
