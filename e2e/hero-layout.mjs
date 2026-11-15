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
//     centre is the picture's (within 2px) and its top is under the picture;
//   - the dock (the name card, the moves, the toy's controls) is inside the
//     card, at least 16px from its edges, as on a phone (Raz: "on mobile, the
//     action items ... are inside the purple area, but here you put them
//     outside. Why?");
//   - on a desktop (1180px wide and 560px tall or more) the drawing's small
//     card is at least 32px in from the card's start and bottom edges, and
//     16px clear of the dock;
//   - wider than tall (and 560px tall or more), the 3D hero is at least 70%
//     of the free height between the dots and the dock, and a space clear of
//     both.
//
// Each slide also reports its measurements (insets, gaps, the hero's share),
// which the self-review in a PR quotes.
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
    // Inside the card: the dock, the dots, the small drawing.
    const m = { card: { l: Math.round(sb.left), t: Math.round(sb.top), w: Math.round(sb.width), h: Math.round(sb.height) } };
    const dockEls = [...document.querySelectorAll('.tb-dock-layer .tb-live-name, .tb-dock-layer .tb-hero-moves, .tb-dock-layer .tb-figure-dock')].filter(seen);
    if (dockEls.length) {
      const d = dockEls.map((e) => e.getBoundingClientRect());
      const db = { l: Math.min(...d.map((r) => r.left)), t: Math.min(...d.map((r) => r.top)), r: Math.max(...d.map((r) => r.right)), b: Math.max(...d.map((r) => r.bottom)) };
      m.dock = { top: Math.round(db.t), bottomInset: Math.round(sb.bottom - db.b), startInset: Math.round(db.l - sb.left), endInset: Math.round(sb.right - db.r), centreOff: Math.round((db.l + db.r) / 2 - (sb.left + sb.right) / 2) };
      if (db.l < sb.left + 16 || db.r > sb.right - 16 || db.t < sb.top + 16 || db.b > sb.bottom - 16) problems.push(`the dock is not inside the card with 16px to spare (${m.dock.startInset}/${m.dock.bottomInset}/${m.dock.endInset}px)`);
      // Its buttons' depth hangs under the box: the inset counts to the face.
    }
    if (dots.length) {
      const c = dots[0];
      m.dotTopInset = Math.round((c.top + c.bottom) / 2 - 4 - sb.top);
      m.dotsBottom = Math.round((c.top + c.bottom) / 2 + 4);
    }
    const one = document.querySelector('.tb-one-drawing');
    if (slide !== 'drawing' && one && seen(one)) {
      const r = one.getBoundingClientRect();
      m.mini = { startInset: Math.round(r.left - sb.left), bottomInset: Math.round(sb.bottom - r.bottom), h: Math.round(r.height), share: Math.round((r.height / sb.height) * 100) };
      // Clear of the dock: beside it (wider than tall) or above it (a phone).
      if (m.dock) {
        const d = dockEls.map((e) => e.getBoundingClientRect());
        const side = Math.min(...d.map((x) => x.left)) - r.right;
        const above = Math.min(...d.map((x) => x.top)) - r.bottom;
        m.mini.gapToDock = Math.round(Math.max(side, above));
      }
      const desktop = innerWidth >= 1180 && innerHeight >= 560 && innerWidth > innerHeight;
      if (desktop && (m.mini.startInset < 32 || m.mini.bottomInset < 32)) problems.push(`the small drawing is ${m.mini.startInset}px / ${m.mini.bottomInset}px from the card's start / bottom, under 32`);
      if (m.mini.gapToDock !== undefined && m.mini.gapToDock < 16) problems.push(`the small drawing is ${m.mini.gapToDock}px from the dock, under 16`);
    }
    return { slide, problems, m };
  });
}

/**
 * The 3D hero's visible height on the hero's slide, against the free height
 * between the dots and the dock: its ink outline, found in a screenshot of
 * the middle half of its room (the sun, the plate and the contact shadow are
 * all lighter than the outline).
 */
async function heroShare(page, m) {
  const room = page.locator('.tb-slide[data-slide="hero"] .tb-live-room');
  const rb = await room.boundingBox();
  if (!rb || !m.dock || m.dotsBottom === undefined) return null;
  // Only the band between the dots and the dock: nothing else is the hero.
  const y0 = Math.max(rb.y, m.dotsBottom + 1);
  const y1 = Math.min(rb.y + rb.height, m.dock.top - 1);
  // The hero dances while it waits: a few frames, the tallest it stands for
  // its size, all of them together for how close it comes to the dots and
  // the dock.
  const frames = [];
  for (let k = 0; k < 4; k++) {
    if (k) await page.waitForTimeout(300);
    frames.push(await page.screenshot({ clip: { x: rb.x + rb.width * 0.25, y: y0, width: rb.width * 0.5, height: y1 - y0 } }));
  }
  const measured = [];
  for (const png of frames) measured.push(await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let top = -1; let bottom = -1;
    for (let y = 0; y < c.height; y++) {
      let n = 0;
      for (let i = y * c.width * 4; i < (y + 1) * c.width * 4; i += 4) if (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2] < 150) n++;
      if (n >= 2) { if (top < 0) top = y; bottom = y; }
    }
    return { top, bottom, h: c.height };
  }, png.toString('base64')));
  const seen = measured.filter((r) => r.top >= 0);
  if (!seen.length) return null;
  const scale = (y1 - y0) / seen[0].h;
  const tallest = Math.max(...seen.map((r) => r.bottom - r.top)) * scale;
  const heroTop = y0 + Math.min(...seen.map((r) => r.top)) * scale;
  const heroBottom = y0 + Math.max(...seen.map((r) => r.bottom)) * scale;
  const free = m.dock.top - m.dotsBottom;
  return { heroH: Math.round(tallest), free, share: Math.round((tallest / free) * 100), dotsToHero: Math.round(heroTop - m.dotsBottom), heroToDock: Math.round(m.dock.top - heroBottom) };
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
    if (slides[i] === 'hero') {
      const h = await heroShare(page, got.m);
      if (h) {
        got.m.hero = h;
        // Wider than tall and 560px tall or more (a phone on its side is
        // measured, not held to it: 375px of height has no more to give).
        const roomy = await page.evaluate(() => innerWidth > innerHeight && innerHeight >= 560);
        if (roomy && h.share < 70) got.problems.push(`the hero is ${h.share}% of the free height between the dots and the dock, under 70%`);
        if (roomy && (h.dotsToHero < 16 || h.heroToDock < 16)) got.problems.push(`the hero is ${h.dotsToHero}px from the dots and ${h.heroToDock}px from the dock, under 16`);
      }
    }
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
    for (const { slide, problems, m } of await checkHeroLayout(page)) {
      bad += problems.length;
      console.log(`${size} ${slide}: ${problems.length ? problems.join('; ') : 'ok'}`);
      if (process.env.METRICS) console.log(`  ${JSON.stringify(m)}`);
    }
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
