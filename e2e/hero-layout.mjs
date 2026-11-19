// The hero page's layout rules, measured (BRANDBOOK "Desktop and wide
// screens"). Raz, on a 2000px screen: "layout is horrible man elements
// override each other its awful", and of the name card off in a corner: "why
// is the label so far on the left? should be below the character man".
//
// On every slide (drawing, painting, hero, toy), what a person can see:
//   - no two of these overlap: the header's title and buttons, the dots, any
//     caption on the slide, every dock control (the name card, the moves, the
//     toy's controls), the bar's buttons, the drawing's small card;
//   - every button in the stage's dock (the moves, the toy's Move, 3MF and
//     make button) is a pill with its icon and its words on one line, no word
//     cut (Raz: never a rounded rectangle, never the icon above the word);
//   - nothing touches the screen's edges or the card's: each thing is inside
//     the card or outside it, at least 4px clear either way;
//   - the toy's two buttons (Take apart, Print file) are one size, and taken
//     apart the toy still passes all of the above and draws its arrows;
//   - a laptop or bigger: the dock inside the card, and under it only the
//     bar's two buttons;
//   - the drawing's card never covers the toy: each of its parts, projected
//     to the screen (PartsViewer's data-toy-parts), clear of the card;
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
    // The header's other controls. For its owner the title is itself a button
    // ("Rename <name>"): that is the title, already in the list by its words,
    // so it is not also one of the things the title must keep clear of.
    document.querySelectorAll('.tb-hero-screen > .tb-header button:not(.tb-header-title)').forEach((el) => seen(el) && add(`header ${el.getAttribute('aria-label') || 'button'}`, el));
    // The dots: the row they make, not the full-width strip holding them.
    const dots = [...document.querySelectorAll('.tb-carousel-dot')].map((d) => d.getBoundingClientRect());
    if (dots.length) items.push({ name: 'the dots', l: Math.min(...dots.map((d) => d.left)), t: Math.min(...dots.map((d) => d.top)), r: Math.max(...dots.map((d) => d.right)), b: Math.max(...dots.map((d) => d.bottom)) });
    document.querySelectorAll('.tb-live-stage .tb-figure-tag, .tb-live-stage .tb-slide-status').forEach((el) => seen(el) && add(`the caption "${el.textContent.trim()}"`, el));
    document.querySelectorAll('.tb-dock-layer .tb-live-name, .tb-dock-layer .tb-move, .tb-dock-layer .tb-figure-btn, .tb-dock-layer .tb-figure-buy')
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
    // Every button in the dock: a pill, its icon and its words on one line, no word cut.
    document.querySelectorAll('.tb-dock-layer .tb-move, .tb-dock-layer .tb-figure-btn, .tb-dock-layer .tb-figure-buy').forEach((el) => {
      if (!seen(el)) return;
      const name = `the dock's "${el.textContent.trim().slice(0, 24)}" button`;
      const r = el.getBoundingClientRect();
      if (parseFloat(getComputedStyle(el).borderTopLeftRadius) < r.height / 2 - 0.5) problems.push(`${name} is a rounded rectangle, not a pill`);
      const mids = [...el.querySelectorAll('svg')].map((s) => s.getBoundingClientRect()).map((b) => (b.top + b.bottom) / 2);
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const t of range.getClientRects()) if (t.width > 0.5) mids.push((t.top + t.bottom) / 2);
        const holder = node.parentElement;
        if (holder !== el && holder.scrollWidth > holder.clientWidth) problems.push(`${name} has a word cut short`);
      }
      if (mids.some((m) => Math.abs(m - (r.top + r.bottom) / 2) > 4)) problems.push(`${name} does not have its icon and its words on one line`);
    });
    // Nothing touches an edge: the screen's, or the card's (inside it or
    // outside it, 4px clear). Wider than tall the card is the stage less the
    // foot under it (its ::before paints it).
    const CLEAR = 4;
    const before = getComputedStyle(stage, '::before');
    const card = { l: sb.left, t: sb.top, r: sb.right, b: sb.bottom - (before.content !== 'none' ? parseFloat(before.bottom) || 0 : 0) };
    for (const it of items) {
      if (it.l < CLEAR || it.t < CLEAR || it.r > innerWidth - CLEAR || it.b > innerHeight - CLEAR) problems.push(`${it.name} touches the screen's edge`);
      const inside = it.l >= card.l + CLEAR && it.r <= card.r - CLEAR && it.t >= card.t + CLEAR && it.b <= card.b - CLEAR;
      const outside = it.r <= card.l - CLEAR || it.l >= card.r + CLEAR || it.b <= card.t - CLEAR || it.t >= card.b + CLEAR;
      if (!inside && !outside) problems.push(`${it.name} touches the card's edge`);
      // A laptop or bigger (the approved boards): the dock is inside the card.
      if (innerWidth > innerHeight && innerHeight >= 560 && it.name.startsWith('dock ') && !inside) problems.push(`${it.name} is not inside the card`);
    }
    // ... and the foot under the card has the bar's two buttons and nothing else.
    if (innerWidth > innerHeight && innerHeight >= 560) {
      const foot = items.filter((it) => it.t >= card.b);
      if (foot.length !== 2 || foot.some((it) => !it.name.startsWith('bar '))) problems.push(`the foot holds ${foot.map((it) => it.name).join(', ') || 'nothing'}, not the bar's two buttons`);
    }
    // The toy's buttons: one size.
    const pair = [...document.querySelectorAll('.tb-dock-layer .tb-figure-btn')].filter(seen).map((el) => el.getBoundingClientRect());
    if (pair.length > 1 && pair.some((b) => Math.abs(b.width - pair[0].width) > 1 || Math.abs(b.height - pair[0].height) > 1)) {
      problems.push(`the toy's buttons are not one size (${pair.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(', ')})`);
    }
    // The drawing's card never covers the toy (together, apart, turning).
    // Each of the toy's parts (its box, projected: PartsViewer's data-toy-parts).
    const toy = document.querySelector('.tb-slide[data-slide="figure"] .tb-parts-stage[data-toy-parts]');
    const pol = document.querySelector('.tb-one-drawing');
    if (slide === 'figure' && toy && pol && seen(pol) && seen(toy)) {
      const host = toy.getBoundingClientRect();
      const d = pol.getBoundingClientRect();
      for (const part of toy.dataset.toyParts.split(';')) {
        const [l, t, r, b] = part.split(',').map(Number);
        const z = { l: host.left + l, t: host.top + t, r: host.left + r, b: host.top + b };
        if (hit(z, { l: d.left, t: d.top, r: d.right, b: d.bottom })) {
          problems.push(`the drawing's card covers a piece of the toy (piece ${Math.round(z.l)},${Math.round(z.t)}-${Math.round(z.r)},${Math.round(z.b)}; card ${Math.round(d.left)},${Math.round(d.top)}-${Math.round(d.right)},${Math.round(d.bottom)})`);
          break;
        }
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
    // On a laptop the painting stands beside the drawing's card as a centred
    // pair (the approved boards), and the name card is under the pair.
    if (innerWidth > innerHeight && (slide === 'drawing' || slide === 'painting')) {
      const card = [...document.querySelectorAll('.tb-dock-layer .tb-live-name')].find(seen);
      const pic = slide === 'drawing'
        ? document.querySelector('.tb-one-drawing')
        : document.querySelector('.tb-slide[data-slide="painting"] .tb-slide-figure') || document.querySelector('.tb-slide[data-slide="painting"] .tb-slide-pic');
      // (The dock row is centred on the card there, so that is the pair's centre.)
      const paired = slide === 'painting' && innerHeight >= 560;
      if (!card) problems.push('no name card');
      else if (pic) {
        const c = card.getBoundingClientRect();
        const one = pic.getBoundingClientRect();
        const p = paired ? { left: sb.left, right: sb.right, bottom: one.bottom } : one;
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
    if (slides[i] === 'figure') {
      const apart = await toyApart(page);
      if (apart) out.push(apart);
    }
  }
  if (start >= 0) {
    await page.locator('.tb-carousel-dot').nth(start).click();
    await page.waitForTimeout(settle);
  }
  return out;
}

/**
 * The toy taken apart: Take apart, then the same rules, its arrows drawn, and
 * Put together again. Null when the toy is not made (no Take apart button).
 */
async function toyApart(page) {
  const button = page.locator('.tb-dock-layer .tb-figure-apart');
  if (!(await button.count()) || !(await button.isVisible())) return null;
  // The parts are in: their canvas, and no loading ring.
  await page.waitForFunction(() => !!document.querySelector('.tb-figure-room canvas') && !document.querySelector('.tb-parts-loading'), null, { timeout: 120000 })
    .catch(() => {});
  await button.click();
  await page.waitForTimeout(2200);
  const got = await slideProblems(page);
  got.slide = 'figure taken apart';
  if ((await button.getAttribute('aria-pressed')) !== 'true' || !/Put together/.test(await button.textContent())) {
    got.problems.push('Take apart did not turn into a chosen "Put together"');
  }
  const arrows = await page.evaluate(() => [...document.querySelectorAll('.tb-parts-arrows g')]
    .filter((g) => +getComputedStyle(g).opacity > 0.9 && (g.querySelector('path')?.getAttribute('d') || '').length > 10).length);
  if (!arrows) got.problems.push('taken apart, the toy draws no arrows');
  await button.click();
  await page.waitForTimeout(1500);
  return got;
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
