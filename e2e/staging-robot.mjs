// The staging robot: drives the real site the way a customer would, end to end.
//
//   landing page -> heroes gallery -> sign up -> buy credits (Lemon Squeezy
//   test mode) -> upload a drawing -> every pipeline stage completes -> the
//   hero is in "My Creations" -> play a game with it
//
// It talks to nothing but the public frontend URL, like a person would. No
// API shortcuts: a step passes only if the UI shows it passed. Every step
// writes a screenshot to e2e/out/ so a failure can be seen, not guessed at.
//
//   BASE_URL=https://<staging frontend> node e2e/staging-robot.mjs
//   STEPS=landing,gallery,signup   run a subset (default: all)
//
// It spends real money at OpenAI and Meshy (one hero, ~10 credits of
// provider cost) and a Lemon Squeezy TEST-mode purchase, which is free.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DRAWING = path.join(HERE, '..', 'marketing', 'concepts', 'assets', 'pairs', 'crayon-kid-drawing.jpg');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const ALL_STEPS = ['landing', 'gallery', 'signup', 'buy', 'create', 'profile', 'game'];
const STEPS = (process.env.STEPS || ALL_STEPS.join(',')).split(',').map((s) => s.trim());
const PIPELINE_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS || 25 * 60 * 1000);

if (!BASE_URL) {
  console.error('BASE_URL is required');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const results = [];
let shot = 0;

async function snap(page, name) {
  const file = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

// On failure, say what the page actually showed: the visible text is what a
// person would read, and it is what a log reader needs to fix the test.
async function describe(page) {
  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('select, script, style').forEach((n) => n.remove());
    return clone.innerText;
  }).catch(() => '(no body)');
  return `url=${page.url()}\n--- visible text ---\n${text.slice(0, 3000)}`;
}

async function step(page, name, fn) {
  if (!STEPS.includes(name)) {
    results.push({ name, status: 'skipped' });
    return;
  }
  const started = Date.now();
  console.log(`\n=== ${name} ===`);
  try {
    const note = await fn();
    await snap(page, name);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name, status: 'passed', secs, note: note || '' });
    console.log(`PASS ${name} (${secs}s) ${note || ''}`);
  } catch (err) {
    await snap(page, `${name}-FAILED`);
    results.push({ name, status: 'failed', error: String(err && err.message ? err.message : err) });
    console.log(`FAIL ${name}: ${err && err.stack ? err.stack : err}`);
    console.log(await describe(page));
    throw err;
  }
}

function report() {
  const lines = ['| step | result | time | note |', '|---|---|---|---|'];
  for (const r of results) {
    const mark = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    lines.push(`| ${r.name} | ${mark} ${r.status} | ${r.secs ? r.secs + 's' : ''} | ${(r.note || r.error || '').replace(/\|/g, '/').slice(0, 200)} |`);
  }
  const md = `## Staging robot: ${BASE_URL}\n\n${lines.join('\n')}\n`;
  writeFileSync(path.join(OUT, 'report.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
  console.log('\n' + md);
}

async function creditsShown(page) {
  const txt = await page.locator('.header-auth-credits').innerText();
  return Number(txt.replace(/[^0-9]/g, ''));
}

// ---------------------------------------------------------------------------
// Lemon Squeezy's hosted checkout. Card fields live in Stripe iframes whose
// markup changes between Stripe versions, so each field is looked for by the
// several names Stripe has used, in every frame on the page.
// ---------------------------------------------------------------------------
async function fillFirst(page, selectors, value, label, { mainOnly = false } = {}) {
  for (const frame of mainOnly ? [page.mainFrame()] : page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 5000 }).catch(() => {});
          await loc.fill('', { timeout: 5000 }).catch(() => {});
          await loc.pressSequentially(value, { delay: 30 });
          console.log(`  filled ${label} via ${sel} in ${frame.url().slice(0, 60)}`);
          return true;
        }
      }
    }
  }
  return false;
}

async function payOnLemonSqueezy(page, email) {
  await page.waitForURL(/lemonsqueezy\.com/, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000); // Stripe mounts its iframes after load
  await snap(page, 'checkout-loaded');

  // Main frame only: Stripe also mounts a "Link" sign-in iframe with its own
  // email box, and typing there starts Link's one-time-code flow instead.
  await fillFirst(page, ['input[type=email]', 'input[name=email]'], email, 'email', { mainOnly: true });
  const card = await fillFirst(page, [
    'input[name=cardnumber]', 'input[autocomplete="cc-number"]', '#Field-numberInput', 'input[name=number]',
  ], '4242424242424242', 'card number');
  const exp = await fillFirst(page, [
    'input[name=exp-date]', 'input[autocomplete="cc-exp"]', '#Field-expiryInput', 'input[name=expiry]',
  ], '1234', 'expiry');
  const cvc = await fillFirst(page, [
    'input[name=cvc]', 'input[autocomplete="cc-csc"]', '#Field-cvcInput',
  ], '123', 'cvc');
  await fillFirst(page, ['input[name=name]', 'input[autocomplete="cc-name"]', 'input[name=billingName]', 'input[placeholder*="name" i]'], 'Robot Tester', 'name', { mainOnly: true });
  // Billing country decides which address fields appear, so set it first.
  for (const sel of await page.locator('select').all()) {
    const hasUS = await sel.locator('option', { hasText: /^United States$/ }).count().catch(() => 0);
    if (hasUS) {
      await sel.selectOption({ label: 'United States' });
      console.log('  selected billing country United States');
      await page.waitForTimeout(1000);
      break;
    }
  }
  await fillFirst(page, ['input[name=postal]', 'input[name=postalCode]', 'input[autocomplete="postal-code"]', '#Field-postalCodeInput', 'input[name=zip]'], '10001', 'postal');
  if (!card || !exp || !cvc) {
    const frames = page.frames().map((f) => f.url().slice(0, 100)).join('\n  ');
    throw new Error(`could not find card fields (card=${card} exp=${exp} cvc=${cvc}); frames:\n  ${frames}`);
  }
  await snap(page, 'checkout-filled');

  let pay = page.getByRole('button', { name: /^(pay|purchase|buy|complete|place order)/i }).first();
  if (!(await pay.count())) pay = page.locator('button[type=submit]').first();
  console.log(`  pressing "${(await pay.innerText().catch(() => '?')).trim()}"`);
  await pay.click({ timeout: 15000 });
  // Test mode lands on a receipt page, then (or instead) on our redirect_url.
  await page.waitForURL((u) => u.toString().startsWith(BASE_URL) || /thank|receipt|success/i.test(u.toString()), { timeout: 120000 });
  if (!page.url().startsWith(BASE_URL)) {
    await snap(page, 'checkout-receipt');
    const back = page.getByRole('link', { name: /continue|return|back/i }).first();
    if (await back.count()) await back.click();
    await page.waitForURL((u) => u.toString().startsWith(BASE_URL), { timeout: 60000 });
  }
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch();
// English, US: third-party pages (the checkout) localise to the runner's
// locale otherwise, and the robot finds buttons by their English names.
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));

const stamp = Date.now().toString(36);
const user = { username: `robot_${stamp}`, email: `robot+${stamp}@example.com`, password: `robot-${stamp}-pw` };
let heroName = null;

let exitCode = 0;
try {
  await step(page, 'landing', async () => {
    const res = await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    if (!res || res.status() >= 400) throw new Error(`landing answered ${res && res.status()}`);
    await page.getByRole('heading', { name: 'HeroMaker' }).waitFor();
    return `HTTP ${res.status()}`;
  });

  await step(page, 'gallery', async () => {
    const items = page.locator('.creation-gallery-item');
    await items.first().waitFor({ timeout: 45000 });
    const n = await items.count();
    // Open one hero and come back, as a browsing visitor would.
    await items.first().click();
    await page.locator('.step-card').first().waitFor({ timeout: 30000 });
    await page.locator('.app-header-center').click();
    await items.first().waitFor();
    return `${n} heroes shown; opened one and returned`;
  });

  await step(page, 'signup', async () => {
    await page.locator('.header-auth-button').click();
    await page.locator('button.auth-modal-tab', { hasText: 'Sign Up' }).click();
    await page.fill('#username', user.username);
    await page.fill('#email', user.email);
    await page.fill('#name', 'Robot Tester');
    await page.fill('#dateOfBirth', '2000-01-01');
    await page.fill('#password', user.password);
    await page.locator('button.auth-modal-submit').click();
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    return `${user.username}, balance ${await creditsShown(page)}`;
  });

  await step(page, 'buy', async () => {
    const before = await creditsShown(page);
    await page.locator('.header-auth-user-button').click();
    await page.getByRole('button', { name: /Buy Credits/ }).click();
    const pack = page.locator('.buy-credits-pack[data-pack="starter"]');
    await pack.waitFor({ timeout: 20000 });
    const price = await pack.locator('.buy-credits-pack-price').innerText();
    if (!/^\$\d+\.\d{2}$/.test(price.trim())) throw new Error(`price renders as "${price}"`);
    await pack.click();
    await payOnLemonSqueezy(page, user.email);
    // Back on our site: the webhook, not the browser, grants the credits.
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    const deadline = Date.now() + 60000;
    let after = before;
    while (Date.now() < deadline && after <= before) {
      await page.waitForTimeout(2000);
      after = await creditsShown(page).catch(() => before);
    }
    if (after <= before) throw new Error(`balance still ${after} a minute after paying (was ${before})`);
    return `paid ${price}; balance ${before} -> ${after}`;
  });

  await step(page, 'create', async () => {
    const input = page.locator('.header-upload-buttons input[type=file]');
    await input.setInputFiles(DRAWING);
    const go = page.locator('button.post-upload-action-primary');
    await go.waitFor({ timeout: 60000 });
    if (await go.isDisabled()) throw new Error(`Go is disabled: ${await describe(page)}`);
    await go.click();
    await page.locator('.step-card').first().waitFor({ timeout: 60000 });

    const deadline = Date.now() + PIPELINE_TIMEOUT_MS;
    let lastLine = '';
    while (Date.now() < deadline) {
      if (await page.locator('.control-bar-success').isVisible().catch(() => false)) break;
      const failed = page.locator('.step-card-failed');
      if (await failed.count()) {
        const name = await failed.first().locator('.step-card-name').innerText().catch(() => '?');
        const err = await failed.first().locator('.step-card-error').innerText().catch(() => '?');
        throw new Error(`stage "${name}" failed: ${err}`);
      }
      const cards = await page.locator('.step-card').evaluateAll((els) => els.map((el) => {
        const n = el.querySelector('.step-card-name')?.textContent?.trim();
        const s = (el.className.match(/step-card-(pending|processing|completed|failed)/) || [])[1];
        return `${n}:${s}`;
      }));
      const line = cards.join('  ');
      if (line !== lastLine) {
        console.log(`  [${new Date().toISOString().slice(11, 19)}] ${line}`);
        lastLine = line;
      }
      await page.waitForTimeout(10000);
    }
    if (!(await page.locator('.control-bar-success').isVisible().catch(() => false))) {
      throw new Error(`hero not ready after ${PIPELINE_TIMEOUT_MS / 60000} min; last: ${lastLine}`);
    }
    const done = await page.locator('.step-card-completed').count();
    heroName = await page.locator('.hero-name-editor, .hero-name').first().innerText().catch(() => null);
    return `all ${done} visible stages completed; "Your hero is ready!" shown`;
  });

  await step(page, 'profile', async () => {
    await page.locator('.app-header-center').click();
    await page.locator('select.creation-gallery-ownership-select').selectOption('my');
    await page.locator('select.creation-gallery-status-select').selectOption({ index: 0 }).catch(() => {});
    const mine = page.locator('.creation-gallery-item');
    await mine.first().waitFor({ timeout: 30000 });
    const n = await mine.count();
    if (n < 1) throw new Error('no heroes under My Creations');
    const done = await page.locator('.creation-gallery-item .creation-gallery-status-completed').count();
    return `${n} hero(es) under My Creations, ${done} completed${heroName ? ` (${heroName})` : ''}`;
  });

  await step(page, 'game', async () => {
    const mine = page.locator('.creation-gallery-item').first();
    const play = mine.locator('.play-hero-button');
    await play.waitFor({ timeout: 20000 });
    const [game] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
      play.click(),
    ]);
    const gp = game || page;
    await gp.waitForURL(/\/play\//, { timeout: 30000 });
    await gp.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
    const loaded = await gp.evaluate(() => window.__reel && window.__reel.hero && window.__reel.hero());
    await gp.evaluate(() => { window.__reel.add('jump'); window.__reel.add('dance'); window.__reel.play(); });
    await gp.waitForFunction(() => window.__reel.playing(), null, { timeout: 15000 });
    await gp.waitForTimeout(3000);
    await snap(gp, 'game-playing');
    return `game loaded the user's hero (${loaded || 'custom'}) and is playing`;
  });
} catch {
  exitCode = 1;
} finally {
  report();
  await browser.close();
}
process.exit(exitCode);
