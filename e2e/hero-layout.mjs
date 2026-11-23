// The hero page's layout rules, measured: the approved "proposal A" (Raz,
// 2026-11-22; docs/design/PRINCIPLES.md, "The hero's page"). Raz, earlier, on
// a 2000px screen: "layout is horrible man elements override each other its
// awful". So on every slide (drawing, painting, hero, toy), of what a person
// can see:
//   - the site's header: the logo, and the credits or Sign in;
//   - no two of these overlap: the header's controls, the overlays on the card
//     (the name card, the moves, the toy's controls, the ⋯), the chapters and
//     the foot's buttons;
//   - the overlays are inside the card; the chapters and the foot outside it;
//     nothing touches the screen's edges or the card's (4px clear);
//   - the slide's picture is centred in the card, across and down (2px): the
//     drawing's polaroid and the painting's figure, measured by their boxes
//     (the live 3D hero is measured by its pixels in the robot's own check);
//   - the name card sits at the card's bottom start, as far in from the side
//     as from the bottom (2px);
//   - the moves (and the toy's controls) are one column at the card's bottom
//     end: one width, one left edge, stacked downward with even gaps, as far
//     in from the side as the name card;
//   - every button over the card is a pill, its icon and its words on one
//     line, no word cut; the toy's two buttons are one size;
//   - the chapters: one tile per slide, in the slides' order, the one in view
//     chosen; no dots, no stage arrows;
//   - the foot: Share then Play, side by side, one width; Play the bottom-most
//     button;
//   - wider than tall: the chapters and the foot in a column beside the card,
//     the card down to the bottom margin (as far from the screen's bottom as
//     from its side, 2px).
//
// Standalone, against any deployment:
//   node e2e/hero-layout.mjs <base-url> <hero-id> [WxH,WxH,...]
// It defaults to 1920x1080, 1280x800, 390x844 and 844x390 and exits 1 on a
// problem. The staging robot calls checkHeroLayout on its own hero.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

/** Every problem on the slide in view, as sentences; empty when it is right. */
async function slideProblems(page) {
  return page.evaluate(() => {
    const screen = document.querySelector('.tb-hero-screen');
    const stage = document.querySelector('.tb-live-stage');
    const sb = stage.getBoundingClientRect();
    const slide = stage.getAttribute('data-slide');
    const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    // Seen: laid out, not hidden, not faded out, and not on a slide off to the side.
    const seen = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) return false;
      let o = 1;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const c = getComputedStyle(e);
        if (c.display === 'none' || c.visibility === 'hidden') return false;
        o *= +c.opacity;
      }
      return o > 0.05;
    };
    const problems = [];
    const items = [];
    const add = (name, el, kind) => items.push({ name, kind, el, ...box(el.getBoundingClientRect()) });

    // The site's header.
    const header = screen.querySelector(':scope > .tb-header');
    if (!header?.querySelector('.tb-logo')) problems.push('the header has no logo');
    if (!header?.querySelector('.header-auth-credits, .header-auth-button')) problems.push('the header has no credits and no Sign in');
    header?.querySelectorAll('button').forEach((el) => seen(el) && add(`header ${el.getAttribute('aria-label') || el.textContent.trim()}`, el, 'header'));

    // Over the card.
    const name = [...stage.querySelectorAll('.tb-dock-layer .tb-live-name:not(.tb-figure-dock)')].find(seen);
    if (!name) problems.push('no name card on the card');
    else add(`the name card "${name.textContent.trim().slice(0, 24)}"`, name, 'over');
    const controls = [...stage.querySelectorAll('.tb-dock-layer .tb-move, .tb-dock-layer .tb-figure-btn, .tb-dock-layer .tb-figure-buy, .tb-dock-layer .tb-live-name.tb-figure-dock')].filter(seen);
    controls.forEach((el) => add(`the control "${el.textContent.trim().slice(0, 24)}"`, el, 'over'));
    stage.querySelectorAll('.tb-hero-more').forEach((el) => seen(el) && add('the ⋯', el, 'over'));
    stage.querySelectorAll('.tb-figure-tag, .tb-slide-status').forEach((el) => seen(el) && add(`the caption "${el.textContent.trim()}"`, el, 'over'));
    // Beside or under it.
    const chapters = [...screen.querySelectorAll('.tb-chapter')];
    chapters.forEach((el) => seen(el) && add(`the chapter "${el.textContent.trim()}"`, el, 'side'));
    const foot = [...screen.querySelectorAll('.tb-hero-foot .tb-btn')].filter(seen);
    foot.forEach((el) => add(`the foot's "${el.textContent.trim()}"`, el, 'side'));

    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (hit(items[i], items[j])) problems.push(`${items[i].name} overlaps ${items[j].name}`);
      }
    }
    // Inside the card or outside it, 4px clear either way; never on the screen's edge.
    const CLEAR = 4;
    const card = box(sb);
    for (const it of items) {
      if (it.l < CLEAR || it.t < CLEAR || it.r > innerWidth - CLEAR || it.b > innerHeight - CLEAR) problems.push(`${it.name} touches the screen's edge`);
      const inside = it.l >= card.l + CLEAR && it.r <= card.r - CLEAR && it.t >= card.t + CLEAR && it.b <= card.b - CLEAR;
      const outside = it.r <= card.l - CLEAR || it.l >= card.r + CLEAR || it.b <= card.t - CLEAR || it.t >= card.b + CLEAR;
      if (it.kind === 'over' && !inside) problems.push(`${it.name} is not inside the card`);
      if (it.kind !== 'over' && !outside) problems.push(`${it.name} is not outside the card`);
    }

    // The picture, centred in the card (its box: a tilted polaroid's turns about its centre).
    const pic = slide === 'drawing'
      ? stage.querySelector('.tb-slide[data-slide="drawing"] .tb-slide-pic')
      : slide === 'painting'
        ? stage.querySelector('.tb-slide[data-slide="painting"] .tb-slide-figure') || stage.querySelector('.tb-slide[data-slide="painting"] .tb-slide-pic')
        : null;
    if (pic && seen(pic)) {
      const p = pic.getBoundingClientRect();
      const dx = (p.left + p.right) / 2 - (sb.left + sb.right) / 2;
      const dy = (p.top + p.bottom) / 2 - (sb.top + sb.bottom) / 2;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) problems.push(`the ${slide} is ${Math.round(dx)}px across and ${Math.round(dy)}px down off the card's centre`);
    }

    // The name card at the bottom start: as far in from the side as from the bottom.
    let pad = null;
    if (name) {
      const n = name.getBoundingClientRect();
      const side = n.left - sb.left;
      const bottom = sb.bottom - n.bottom;
      pad = side;
      if (Math.abs(side - bottom) > 2) problems.push(`the name card is ${Math.round(side)}px from the card's side but ${Math.round(bottom)}px from its bottom`);
    }
    // The controls: one column at the bottom end, one width, even gaps,
    // their right edge as far in as the name card's left.
    const column = controls.filter((el) => el.matches('.tb-move, .tb-figure-btn'));
    if (column.length) {
      const rs = column.map((el) => el.getBoundingClientRect());
      if (rs.some((r) => Math.abs(r.width - rs[0].width) > 1 || Math.abs(r.left - rs[0].left) > 1)) {
        problems.push(`the controls are not one column of one width (${rs.map((r) => `${Math.round(r.left)}+${Math.round(r.width)}`).join(', ')})`);
      }
      const gaps = rs.slice(1).map((r, i) => r.top - rs[i].bottom);
      if (gaps.some((g) => g < 0 || Math.abs(g - gaps[0]) > 1)) problems.push(`the controls are not stacked with even gaps (${gaps.map(Math.round).join(', ')})`);
      const right = sb.right - rs[0].right;
      if (pad !== null && Math.abs(right - pad) > 2) problems.push(`the controls are ${Math.round(right)}px in from the card's end, the name card ${Math.round(pad)}px`);
      if (column.length > 1 && column.every((el) => el.matches('.tb-figure-btn'))) {
        if (rs.some((r) => Math.abs(r.height - rs[0].height) > 1)) problems.push("the toy's buttons are not one size");
      }
    }
    // Every button over the card: a pill, its icon and its words on one line, no word cut.
    controls.filter((el) => el.matches('.tb-move, .tb-figure-btn, .tb-figure-buy')).forEach((el) => {
      const label = `the "${el.textContent.trim().slice(0, 24)}" button`;
      const r = el.getBoundingClientRect();
      if (parseFloat(getComputedStyle(el).borderTopLeftRadius) < r.height / 2 - 0.5) problems.push(`${label} is a rounded rectangle, not a pill`);
      const mids = [...el.querySelectorAll('svg')].map((s) => s.getBoundingClientRect()).map((b) => (b.top + b.bottom) / 2);
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const t of range.getClientRects()) if (t.width > 0.5) mids.push((t.top + t.bottom) / 2);
        const holder = node.parentElement;
        if (holder !== el && holder.scrollWidth > holder.clientWidth) problems.push(`${label} has a word cut short`);
      }
      if (mids.some((m) => Math.abs(m - (r.top + r.bottom) / 2) > 4)) problems.push(`${label} does not have its icon and its words on one line`);
    });

    // The chapters: one per slide, in order, the one in view chosen.
    const keys = stage.getAttribute('data-slides').split(',').map((k) => k.replace(/-.*$/, ''));
    if (chapters.map((c) => c.dataset.chapter).join(',') !== keys.join(',')) problems.push(`the chapters are ${chapters.map((c) => c.dataset.chapter).join(',')}, the slides ${keys.join(',')}`);
    const chosen = chapters.filter((c) => c.getAttribute('aria-current') === 'true').map((c) => c.dataset.chapter);
    if (chosen.join() !== slide) problems.push(`the chosen chapter is "${chosen.join()}" on the ${slide}`);
    // The one in view is the card: its own tile is not shown beside it (Raz, 2026-11-23).
    chapters.forEach((c) => { if (c.getAttribute('aria-current') === 'true' && seen(c)) problems.push(`the chapter "${c.dataset.chapter}" repeats the card beside it`); });
    chapters.forEach((c) => {
      const l = c.querySelector('.tb-chapter-label');
      if (l && l.scrollWidth > l.clientWidth + 0.5) problems.push(`the chapter "${l.textContent}" has its name cut short`);
      if (l && c.getBoundingClientRect().bottom < l.getBoundingClientRect().bottom - 0.5) problems.push(`the chapter "${l.textContent}" has its name cut off`);
    });
    if (document.querySelector('.tb-hero-screen .tb-carousel-dot')) problems.push('the stage still has dots');
    if (document.querySelector('.tb-carousel-arrow')) problems.push('the stage has arrows');

    // The foot (a ready hero): Share then Play, one row, one width; Play the bottom-most button.
    if (screen.getAttribute('data-state') === 'ready') {
      const [share, play] = foot;
      if (foot.length !== 2 || !share.matches('.tb-share') || !play.matches('.tb-play')) problems.push(`the foot holds ${foot.map((b) => `"${b.textContent.trim()}"`).join(', ') || 'nothing'}, not Share and Play`);
      else {
        const a = share.getBoundingClientRect();
        const b = play.getBoundingClientRect();
        if (Math.abs(a.width - b.width) > 1 || Math.abs(a.top - b.top) > 1 || a.left > b.left) problems.push(`Share (${Math.round(a.left)},${Math.round(a.top)} ${Math.round(a.width)}) and Play (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}) are not one row of one width, Share first`);
      }
      if (play) {
        const pb = play.getBoundingClientRect().bottom;
        screen.querySelectorAll('button, a').forEach((el) => {
          // (A picture's full-screen opener is the picture, not a button under Play.)
          if (el !== play && !el.matches('.tb-slide-open') && seen(el) && el.getBoundingClientRect().bottom > pb + 1) problems.push(`"${el.className}" is lower than Play`);
        });
      }
    }

    // Wider than tall: the side beside the card, the card down to the bottom margin.
    if (innerWidth > innerHeight) {
      const side = document.querySelector('.tb-hero-side').getBoundingClientRect();
      if (side.left < sb.right) problems.push('the chapters are not beside the card');
      const bottom = innerHeight - sb.bottom;
      if (innerHeight >= 560 && Math.abs(bottom - sb.left) > 2) problems.push(`the card stops ${Math.round(bottom)}px over the screen's bottom, its side margin is ${Math.round(sb.left)}px`);
    }
    return { slide, problems };
  });
}

/**
 * Go round every slide by its chapter and collect the problems on each:
 * [{ slide, problems: [...] }]. Leaves the stage on the slide it found.
 */
export async function checkHeroLayout(page, { settle = 900 } = {}) {
  const stage = page.locator('.tb-live-stage');
  // data-slides names a slide not ready yet as key-state ("figure-locked").
  const slides = (await stage.getAttribute('data-slides')).split(',').map((k) => k.replace(/-.*$/, ''));
  const start = slides.indexOf(await stage.getAttribute('data-slide'));
  const out = [];
  // Go to a chapter's slide by clicking its tile. The current chapter's own
  // tile is display:none by design (a duplicate of the big view, Raz
  // 2026-11-23), so when we are already on that slide there is nothing to
  // click, and nothing to wait for.
  const go = async (i) => {
    // Wait until we are on that slide already, or its tile can be clicked.
    // Checking data-slide once and then clicking raced a slide still
    // settling: it landed on the target just after the check, its tile went
    // display:none, and the click waited 30 s for a hidden tile (run #118).
    const ready = await page.waitForFunction((n) => {
      const k = document.querySelector('.tb-live-stage')?.getAttribute('data-slide');
      const tile = document.querySelectorAll('.tb-chapter')[n];
      if (tile && k === tile.dataset.chapter) return 'here';
      return tile && tile.getBoundingClientRect().width > 0 ? 'tile' : false;
    }, i, { timeout: 20000 }).then((h) => h.jsonValue(), () => 'tile');
    if (ready === 'here') return true;
    // Short, and not fatal: if the slide lands on the target between the wait
    // and the click, the tile hides again; the check below says where we are.
    await page.locator('.tb-chapter').nth(i).click({ timeout: 5000 }).catch(() => {});
    // 20 s, not 5: the robot draws the 3D hero and the toy without a GPU
    // (software GL on CI), where a slide change on the toy hero took over 5 s
    // in runs 89-91. What this checks is WHERE a chapter goes, not how fast a
    // GPU-less machine gets there.
    return page.waitForFunction((k) => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === k, slides[i], { timeout: 20000 })
      .then(() => true, () => false);
  };
  for (let i = 0; i < slides.length; i++) {
    const landed = await go(i);
    await page.waitForTimeout(settle);
    if (slides[i] === 'figure') await toyShown(page);
    const got = await slideProblems(page);
    // A chapter goes straight to its own slide.
    if (!landed) got.problems.unshift(`the chapter "${slides[i]}" landed on "${got.slide}"`);
    out.push(got);
    if (slides[i] === 'figure') {
      const apart = await toyApart(page);
      if (apart) out.push(apart);
    }
  }
  if (start >= 0) {
    await go(start);
    await page.waitForTimeout(settle);
  }
  return out;
}

/** Wait (up to 15 s) until the toy, if there is one, has its parts on screen. */
async function toyShown(page) {
  await page.waitForFunction(() => {
    const slide = document.querySelector('.tb-slide[data-slide="figure"]');
    return !slide || !slide.querySelector('.tb-figure-room') || !!slide.querySelector('.tb-parts-stage[data-toy-parts]');
  }, null, { timeout: 15000, polling: 200 }).catch(() => {});
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

/**
 * The live 3D hero, centred in the card by its own outline: the card's pixels
 * that differ from its plate, with the overlays hidden, sampled a few times
 * as it dances. Returns the mean offset of the outline's centre from the
 * card's, in px, and each sample's.
 */
export async function heroCentring(page, { samples = 5 } = {}) {
  const card = await page.locator('.tb-live-stage').boundingBox();
  const hide = await page.addStyleTag({ content: '.tb-live-stage .tb-dock-layer { visibility: hidden !important; }' });
  const got = [];
  for (let i = 0; i < samples; i++) {
    const png = await page.screenshot({ clip: card });
    got.push(await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const at = (x, y) => (y * c.width + x) * 4;
      const bg = at(Math.round(c.width / 2), 3);
      const [br, bgg, bb] = [d[bg], d[bg + 1], d[bg + 2]];
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      const R = 30; // past the card's rounded corners
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if ((x < R || x > c.width - R) && (y < R || y > c.height - R)) continue;
          const i = at(x, y);
          // The contact shadow is faint: only the figure differs this much.
          if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgg) + Math.abs(d[i + 2] - bb) > 80) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      return x1 < 0 ? null : { dx: (x0 + x1) / 2 - c.width / 2, dy: (y0 + y1) / 2 - c.height / 2 };
    }, png.toString('base64')));
    await page.waitForTimeout(400);
  }
  await hide.evaluate((el) => el.remove());
  const ok = got.filter(Boolean);
  const mean = (k) => (ok.length ? ok.reduce((a, s) => a + s[k], 0) / ok.length : NaN);
  return { dx: mean('dx'), dy: mean('dy'), samples: ok, card };
}

async function main() {
  const [base, hero, sizes = '1920x1080,1280x800,390x844,360x780,844x390'] = process.argv.slice(2);
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
    await page.waitForTimeout(1500);
    const c = await heroCentring(page);
    console.log(`${size} hero centring: ${Math.round(c.dx)}px across, ${Math.round(c.dy)}px down (card ${Math.round(c.card.width)}x${Math.round(c.card.height)})`);
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
