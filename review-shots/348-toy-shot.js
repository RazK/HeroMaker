// node apart.js <label> <base>  -> shots/<label>-apart-<w>.png
const { chromium } = require('playwright');
const [label, base] = process.argv.slice(2);
const HERO = 'b4acf85a-a135-462d-b19b-5c4fc0d50793';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript(() => { localStorage.setItem('heromaker_adult_confirmed', '1'); });
    const p = await ctx.newPage();
    if (process.env.PATCH) {
      await p.route(/PartsViewer-.*\.js$/, async (route) => { const r = await route.fetch(); let t = await r.text(); const n0 = t.length;
        t = t.replace('Math.min(.4*W,40)', 'Math.min(.25*W,22)').replace('Math.min(10,.3*W+4)', 'Math.min(7,.2*W+3)'); console.log('patched js', t.length !== n0); await route.fulfill({ response: r, body: t }); });
      await p.route(/index-.*\.css$/, async (route) => { const r = await route.fetch(); const t = (await r.text()).replace('stroke-width:3.5px;stroke-linecap', 'stroke-width:2.5px;stroke-linecap'); await route.fulfill({ response: r, body: t }); });
    }
    await p.goto(`${base}/hero/${HERO}`, { waitUntil: 'load' });
    await p.waitForFunction(() => (document.querySelector('.tb-live-stage')?.getAttribute('data-slides') || '').includes('figure'), null, { timeout: 60000 });
    const slides = (await p.locator('.tb-live-stage').getAttribute('data-slides')).split(',').map((k) => k.replace(/-.*$/, ''));
    await p.locator('.tb-chapter').nth(slides.indexOf('figure')).click();
    await p.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === 'figure', null, { timeout: 30000 });
    await p.waitForFunction(() => !!document.querySelector('.tb-figure-room canvas') && !document.querySelector('.tb-parts-loading'), null, { timeout: 60000 });
    await p.waitForTimeout(2000);
    await p.locator('.tb-dock-layer .tb-figure-apart').click();
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${__dirname}/shots/${label}-apart-${w}.png` });
    console.log(label, w, 'arrows:', await p.locator('.tb-parts-arrows g').count());
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
