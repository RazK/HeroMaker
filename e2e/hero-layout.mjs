// The hero page's layout rules, measured (BRANDBOOK "Desktop and wide
// screens"). Raz, on a 2000px screen: "layout is horrible man elements
// override each other its awful", and of the name card off in a corner: "why
// is the label so far on the left? should be below the character man".
//
// On every slide (drawing, painting, hero, toy), what a person can see:
//   - no two of these overlap: the header's title and buttons, the dots, any
//     caption on the slide, every dock control (the name card, the moves, the
//     toy's controls), the bar's buttons, the drawing's small card;
//   - no stage arrows;
//   - Play is the bottom-most button;
//   - wider than tall, on the drawing and the painting: the name card's
//     centre is the picture's (within 2px) and its top is under the picture.
//
// Standalone, against any deployment:
//   node e2e/hero-layout.mjs <base-url> <hero-id> [WxH,WxH,...]
// It defaults to 1920x1080, 1280x800 and 390x844 and exits 1 on a problem.
// The staging robot calls checkHeroLayout on its own hero.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

/** Every problem on the slide in view, as sentences; empty when it is right. */
async function slideProblems(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.tb-live-stage');
    const sb = stage.getBoundingClientRect();
    const slide = stage.getAttribute('data-slide');
    const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    // Seen: laid out, not hidden, not faded out, and on the stage (a slide
    // off to the side is not on the page for a person).
    const seen = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cx = (r.left + r.right) / 2;
      if (cx < Math.max(0, sb.left) || cx > Math.min(innerWidth, sb.right) || r.bottom <= 0 || r.top >= innerHeight) return false;
      let o = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const c = getComputedStyle(e);
        if (c.display === 'none' || c.visibility === 'hidden') return false;
        o *= +c.opacity;
      }
      return o > 0.05;
    };
    const items = [];
    const add = (name, el, r = el.getBoundingClientRect()) => items.push({ name, ...box(r) });
    // The title: its words, not the absolutely placed strip that holds them.
    const title = document.querySelector('.tb-hero-screen > .tb-header .tb-header-title');
    if (title && title.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(title);
      add('the header title', title, range.getBoundingClientRect());
    }
    document.querySelectorAll('.tb-hero-screen > .tb-header button').forEach((el) => seen(el) && add(`header ${el.getAttribute('aria-label') || 'button'}`, el));
    // The dots: the row they make, not the full-width strip holding them.
    const dots = [...document.querySelectorAll('.tb-carousel-dot')].map((d) => d.getBoundingClientRect());
    if (dots.length) items.push({ name: 'the dots', l: Math.min(...dots.map((d) => d.left)), t: Math.min(...dots.map((d) => d.top)), r: Math.max(...dots.map((d) => d.right)), b: Math.max(...dots.map((d) => d.bottom)) });
    document.querySelectorAll('.tb-live-stage .tb-figure-tag, .tb-live-stage .tb-slide-status').forEach((el) => seen(el) && add(`the caption "${el.textContent.trim()}"`, el));
    document.querySelectorAll('.tb-dock-layer .tb-live-name, .tb-dock-layer .tb-move, .tb-dock-layer .tb-figure-move, .tb-dock-layer .tb-figure-slider, .tb-dock-layer .tb-figure-get, .tb-dock-layer .tb-figure-buy')
      .forEach((el) => seen(el) && add(`dock ${el.className.split(' ').find((c) => /^tb-(live-name|move|figure-)/.test(c))} "${el.textContent.trim().slice(0, 24)}"`, el));
    document.querySelectorAll('.tb-hero-screen > .tb-bar .tb-btn').forEach((el) => seen(el) && add(`bar "${el.textContent.trim()}"`, el));
    if (slide !== 'drawing') {
      const one = document.querySelector('.tb-one-drawing');
      if (one && seen(one)) add('the small drawing', one);
    }

    const problems = [];
    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (hit(items[i], items[j])) problems.push(`${items[i].name} overlaps ${items[j].name}`);
      }
    }
    if (document.querySelector('.tb-carousel-arrow')) problems.push('the stage has arrows');

    const play = document.querySelector('.tb-hero-screen .tb-play');
    if (play) {
      const pb = play.getBoundingClientRect().bottom;
      document.querySelectorAll('.tb-hero-screen button, .tb-hero-screen a').forEach((el) => {
        if (el !== play && seen(el) && el.getBoundingClientRect().bottom > pb + 1) problems.push(`"${el.className}" is lower than Play`);
      });
    }

    // Wider than tall, the name card is the picture's label: centred under it.
    if (innerWidth > innerHeight && (slide === 'drawing' || slide === 'painting')) {
      const card = [...document.querySelectorAll('.tb-dock-layer .tb-live-name')].find(seen);
      const pic = slide === 'drawing'
        ? document.querySelector('.tb-one-drawing')
        : document.querySelector('.tb-slide[data-slide="painting"] .tb-slide-figure') || document.querySelector('.tb-slide[data-slide="painting"] .tb-slide-pic');
      if (!card) problems.push('no name card');
      else if (pic) {
        const c = card.getBoundingClientRect();
        const p = pic.getBoundingClientRect();
        const dx = (c.left + c.right) / 2 - (p.left + p.right) / 2;
        if (Math.abs(dx) > 2) problems.push(`the name card is ${Math.round(dx)}px off the picture's centre`);
        if (c.top < p.bottom) problems.push(`the name card's top (${Math.round(c.top)}) is above the picture's bottom (${Math.round(p.bottom)})`);
      }
    }
    return { slide, problems };
  });
}

/**
 * Go round every slide by its dot and collect the problems on each:
 * [{ slide, problems: [...] }]. Leaves the stage on the slide it found.
 */
export async function checkHeroLayout(page, { settle = 900 } = {}) {
  const stage = page.locator('.tb-live-stage');
  // data-slides names a slide not ready yet as key-state ("figure-locked").
  const slides = (await stage.getAttribute('data-slides')).split(',').map((k) => k.replace(/-.*$/, ''));
  const start = slides.indexOf(await stage.getAttribute('data-slide'));
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    await page.locator('.tb-carousel-dot').nth(i).click();
    const landed = await page.waitForFunction((k) => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === k, slides[i], { timeout: 5000 })
      .then(() => true, () => false);
    await page.waitForTimeout(settle);
    const got = await slideProblems(page);
    // A dot goes straight to its own slide.
    if (!landed) got.problems.unshift(`the dot for "${slides[i]}" landed on "${got.slide}"`);
    out.push(got);
  }
  if (start >= 0) {
    await page.locator('.tb-carousel-dot').nth(start).click();
    await page.waitForTimeout(settle);
  }
  return out;
}

async function main() {
  const [base, hero, sizes = '1920x1080,1280x800,390x844'] = process.argv.slice(2);
  if (!base || !hero) {
    console.log('usage: node e2e/hero-layout.mjs <base-url> <hero-id> [WxH,...]');
    process.exit(2);
  }
  const browser = await chromium.launch();
  let bad = 0;
  for (const size of sizes.split(',')) {
    const [width, height] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base.replace(/\/$/, '')}/hero/${hero}`, { waitUntil: 'load' });
    // The live hero is in: its moves are showing.
    await page.waitForFunction(() => {
      const m = document.querySelector('.tb-dock-layer--moves');
      return m && getComputedStyle(m).opacity === '1';
    }, null, { timeout: 120000 });
    for (const { slide, problems } of await checkHeroLayout(page)) {
      bad += problems.length;
      console.log(`${size} ${slide}: ${problems.length ? problems.join('; ') : 'ok'}`);
    }
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
