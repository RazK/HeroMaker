// node paywall.js <label> [credits]  -> shots/<label>-paywall-<w>.png : the real app (vite, this branch) on a mocked paused-for-credits hero
const { chromium } = require('playwright');
const fs = require('fs');
const S = __dirname;
const [label, credits = '0'] = process.argv.slice(2);
const ID = 'b4acf85a-a135-462d-b19b-5c4fc0d50793';
const hero = JSON.parse(fs.readFileSync(S + '/hero.json'));
const me = { ...JSON.parse(fs.readFileSync(S + '/me.json')), id: hero.owner_id, is_admin: false, credits: Number(credits), free_painting: false, adult_confirmed_at: '2026-11-23T00:00:00' };
hero.status = 'failed'; hero.mine = true; hero.name = 'Ruby Red'; hero.completed_at = null; hero.progress = 40;
hero.stage = 'model';
for (const k of ['model', 'rigged', 'avatar', 'model_optimized', 'avatar_optimized']) delete hero.files[k];
for (const k of ['model.glb', 'rigged.glb', 'avatar.vrm']) delete hero.file_versions[k];
hero.stages = hero.stages.map((s) => {
  if (s.step === 'meshy_3d') return { ...s, status: 'failed', completed_at: null, file: null, progress: 0, error: { code: 'not_enough_credits', message: 'You need more credits to finish this hero.', credits_refunded: false } };
  if (['meshy_rig', 'convert_vrm'].includes(s.step)) return { ...s, status: 'pending', started_at: null, completed_at: null, file: null, progress: 0, error: null };
  return s;
});
hero.error = { code: 'not_enough_credits', message: 'You need more credits to finish this hero.' };
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { localStorage.setItem('heromaker_jwt_token', 'x'); localStorage.setItem('heromaker_adult_confirmed', '1'); });
    await ctx.route(/\/api\/v1\/heroes\/b4acf85a[^/]*$/, (r) => r.fulfill({ json: hero }));
    await ctx.route(/\/api\/v1\/me$/, (r) => r.fulfill({ json: me }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('pageerror', e.message));
    await p.goto(`http://localhost:4183/hero/${ID}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('.tb-hero-screen', { timeout: 30000 });
    await p.waitForTimeout(3000);
    const info = await p.evaluate(() => ({
      slide: document.querySelector('.tb-live-stage')?.getAttribute('data-slide'),
      slides: document.querySelector('.tb-live-stage')?.getAttribute('data-slides'),
      title: document.querySelector('.tb-paywall-title')?.textContent,
      line: document.querySelector('.tb-paywall-line')?.textContent,
      buttons: [...document.querySelectorAll('.tb-hero-screen button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      fail: /fail/i.test(document.querySelector('.tb-hero-screen').innerText),
    }));
    console.log(w, JSON.stringify(info));
    await p.screenshot({ path: `${S}/shots/${label}-paywall-${w}.png` });
    if (process.env.CLICK && w === 390) {
      const posts = [];
      p.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) posts.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
      await ctx.route(/\/api\/v1\/heroes\/b4acf85a.*\/(retry|run|resume|continue).*/, (r) => r.fulfill({ json: hero }));
      await p.locator('.tb-bring-to-life').click();
      await p.waitForTimeout(2000);
      console.log('after click:', JSON.stringify({ buySheet: await p.locator('.buy-credits-why, [role=dialog]').count(), dialogs: await p.locator('[role=dialog]').allInnerTexts().then((t) => t.map((x) => x.slice(0, 60))), posts }));
      await p.screenshot({ path: `${S}/shots/${label}-paywall-click-${w}.png` });
    }
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
