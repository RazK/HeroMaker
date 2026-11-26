// Time to visible on a phone network (CDP throttling: 9 Mbps down, 1.5 up, 150 ms RTT), cold cache.
const { chromium } = require('playwright');
const B = process.env.B || 'https://frontend-staging-7cb8.up.railway.app';
const HERO = '/hero/5622bb2a-2027-4693-a431-36703644ab95';
const runs = +(process.env.RUNS || 3);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const out = { gallery: [], hero: [], heroBytes: [], galleryBytes: [] };
  for (let i = 0; i < runs; i++) {
    for (const which of ['gallery', 'hero']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
      let bytes = 0; cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
      const t0 = Date.now();
      if (which === 'gallery') {
        await page.goto(B + '/gallery', { waitUntil: 'domcontentloaded', timeout: 120000 });
        // First screen of tiles painted: every tile image in the viewport complete.
        await page.waitForFunction(() => {
          const imgs = [...document.querySelectorAll('img')].filter((im) => { const r = im.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.width > 60; });
          return imgs.length >= 4 && imgs.every((im) => im.complete && im.naturalWidth > 0);
        }, null, { timeout: 120000, polling: 50 });
      } else {
        await page.goto(B + HERO, { waitUntil: 'domcontentloaded', timeout: 120000 });
        // The live 3D hero is on screen: the robot's own signal (moves shown).
        await page.waitForFunction(() => { const m = document.querySelector('.tb-dock-layer--moves'); return m && getComputedStyle(m).opacity === '1'; }, null, { timeout: 120000, polling: 50 });
      }
      out[which].push(Date.now() - t0); out[which + 'Bytes'].push(bytes);
      await ctx.close();
    }
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(JSON.stringify({ gallery_ms: out.gallery, hero_ms: out.hero, gallery_median: med(out.gallery), hero_median: med(out.hero), gallery_MB: (med(out.galleryBytes) / 1e6).toFixed(2), hero_MB_at_visible: (med(out.heroBytes) / 1e6).toFixed(2) }));
  await browser.close();
})();
