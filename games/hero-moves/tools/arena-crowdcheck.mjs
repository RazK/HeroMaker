/**
 * Robot Rumble's crowd rules, checked against a mocked app:
 *
 *  1. Nothing the player can hit is a hero or a drawing. A bot plays a round
 *     with the stands full, punching everything; every half second the page's
 *     own `__arena.audit()` must say every live target is a generated toy, no
 *     fan and no pinned drawing is in the game's tree or in a target, every
 *     fan is in the stands (a letter block or a grandstand row, behind the
 *     court and within its width), and every drawing hangs on the back wall.
 *  2. The crowd cheers when the player scores (`state().crowd.cheers`).
 *  3. Who is in the stands:
 *     - a personal hero gets Editors' choice;
 *     - a class hero, opened by its teacher, gets its own classmates first,
 *       then Editors' choice — and never a hero from the teacher's other class;
 *     - a class hero with nobody signed in gets Editors' choice only.
 *  4. With no gallery at all the game still plays (empty stands).
 *
 *   npx vite preview --port 4188 --strictPort &
 *   node tools/arena-crowdcheck.mjs [--base=http://127.0.0.1:4188] [--seconds=20]
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const BASE = args.base ?? 'http://127.0.0.1:4188'
const SECONDS = Number(args.seconds ?? 20)
const AV = new URL('../assets/avatars/', import.meta.url).pathname
const vrm = (name) => fs.readFileSync(`${AV}${name}.opt.vrm`)
const DRAWING = fs.readFileSync(new URL('../../../marketing/concepts/assets/pairs/turtle-cool-drawing.jpg', import.meta.url))

// Every hero id the mock app knows, and which sample file plays it.
const FILES = {
  OWN: 'Crayon_Kid', MATE1: 'Cloudy', MATE2: 'Skelly', OTHERCLASS: 'Gingerella', FEAT1: 'Superstar', FEAT2: 'Yummy_Bear', FEAT3: 'Gingerella',
}
// A hero as GET /api/v1/heroes/{id} answers it (the fields the game reads).
const hero = (id, extra = {}) => ({ id, object: 'hero', owner_id: 'u', status: 'completed', name: id, artist: { name: 'Maya', age: 6 }, in_class: false, ...extra })

async function mockApp(page, { inClass, classes = true, featured = ['FEAT1', 'FEAT2', 'FEAT3'] }) {
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url())
    const p = u.pathname
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const auth = route.request().headers().authorization === 'Bearer teacher-token'
    let m
    if ((m = /^\/api\/files\/u\/([^/]+)\/thumb_original\.jpg$/.exec(p))) return route.fulfill({ body: DRAWING, contentType: 'image/jpeg' })
    if ((m = /^\/api\/files\/u\/([^/]+)\/opt_avatar\.vrm$/.exec(p))) {
      const f = FILES[m[1]]
      return f ? route.fulfill({ body: vrm(f), contentType: 'application/octet-stream' }) : route.fulfill({ status: 404, body: '' })
    }
    if (p === '/api/v1/gallery' && u.searchParams.get('view') === 'featured') return json({ object: 'list', view: 'featured', data: featured.map((id) => hero(id)) })
    if ((m = /^\/api\/v1\/heroes\/([^/]+)$/.exec(p))) return json(hero(m[1], { in_class: m[1] === 'OWN' && inClass }))
    if (p === '/api/v1/classes') return auth && classes ? json({ classes: [{ id: 'other' }, { id: 'mine' }] }) : json({ detail: 'no' }, 401)
    if ((m = /^\/api\/v1\/classes\/([^/]+)\/stage$/.exec(p))) {
      if (!auth) return json({ detail: 'no' }, 401)
      const ids = m[1] === 'mine' ? ['OWN', 'MATE1', 'MATE2'] : ['OTHERCLASS']
      return json({ title: m[1], heroes: ids.map((id) => ({ creationId: id, heroName: id, name: 'kid', vrmUrl: `/api/files/u/${id}/opt_avatar.vrm` })) })
    }
    return json({ detail: 'not found' }, 404)
  })
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const fails = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what) }

async function open(scenario, { token = null, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  if (scenario) await mockApp(page, scenario)
  if (token) await ctx.addInitScript((t) => { try { localStorage.setItem('heromaker_jwt_token', t) } catch {} }, token)
  const own = scenario ? `vrm=${encodeURIComponent('/api/files/u/OWN/opt_avatar.vrm')}&name=Me&` : ''
  await page.goto(`${BASE}/arena.html?${own}manual=1&dpr=1${query}`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
  await page.waitForFunction(() => window.__crowd !== undefined, null, { timeout: 300000 })
  const fans = await page.evaluate(() => window.__arena.state().crowd.fans.map((f) => `${f.name}:${f.from}`))
  return { ctx, page, fans }
}

// ---- 3. who is in the stands
{
  const { ctx, fans } = await open({ inClass: false })
  console.log('   personal hero:', fans.join(', '))
  check(fans.length === 3 && fans.every((f) => f.endsWith(':featured')), 'a personal hero is cheered by Editors\' choice')
  check(!fans.some((f) => f.startsWith('OWN:')), 'the player\'s own hero is never in the stands')
  await ctx.close()
}
{
  const { ctx, fans } = await open({ inClass: true }, { token: 'teacher-token' })
  console.log('   class hero, teacher:', fans.join(', '))
  check(fans[0]?.endsWith(':class') && fans[1]?.endsWith(':class'), 'a class hero is cheered by its classmates first')
  check(new Set(fans.slice(0, 2).map((f) => f.split(':')[0])).size === 2 && fans.slice(0, 2).every((f) => /^MATE/.test(f)), 'the classmates are the class\'s own')
  check(!fans.some((f) => f.startsWith('OTHERCLASS:')), 'never a hero from another class')
  check(fans.slice(2).every((f) => f.endsWith(':featured')), 'the seats left go to Editors\' choice')
  await ctx.close()
}
{
  const { ctx, fans } = await open({ inClass: true })
  console.log('   class hero, nobody signed in:', fans.join(', '))
  check(fans.every((f) => f.endsWith(':featured')), 'a class hero with no teacher signed in gets Editors\' choice only')
  await ctx.close()
}
{
  const { ctx, fans } = await open({ inClass: true }, { token: 'teacher-token', query: '&class=mine' })
  check(fans.filter((f) => f.endsWith(':class')).length === 2, '?class= names the class directly')
  await ctx.close()
}

// ---- 4. no crowd: the game still plays
{
  const { ctx, page } = await open({ inClass: false, featured: [] }, { query: '&crowd=0' })
  await page.evaluate(() => { window.__arena.start(5); window.__arena.step(150, 1 / 30) })
  const s = await page.evaluate(() => window.__arena.state())
  check(s.phase === 'play' && s.crowd.size === 0 && s.things.length > 0, 'with empty stands the round plays')
  await ctx.close()
}

// ---- 1 + 2. a round with full stands: nothing hittable is a hero, the crowd cheers
{
  const { ctx, page, fans } = await open({ inClass: true }, { token: 'teacher-token' })
  check(fans.length >= 4, `the stands are full (${fans.length})`)
  await page.evaluate(() => window.__arena.start(11))
  const audits = await page.evaluate(([n]) => {
    const out = []
    const press = (k, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k }))
    const held = new Set()
    for (let i = 0; i < n; i++) {
      const s = window.__arena.state()
      const h = s.hero
      const ts = s.things.filter((t) => t.kind !== 'ball' && (t.y < 1.8 || t.kind === 'bouncy'))
      ts.sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))
      const want = new Set()
      const t = ts[0]
      if (t) {
        const dx = t.x - h.x, dz = t.z - h.z
        if (Math.hypot(dx, dz) > 1.2) {
          if (dx > 0.3) want.add('arrowright'); if (dx < -0.3) want.add('arrowleft')
          if (dz > 0.3) want.add('arrowdown'); if (dz < -0.3) want.add('arrowup')
        } else if (i % 5 === 0) { press('j', true); press('j', false) }
      }
      for (const k of held) if (!want.has(k)) { press(k, false); held.delete(k) }
      for (const k of want) if (!held.has(k)) { press(k, true); held.add(k) }
      window.__arena.step(1, 1 / 30, i % 15 === 0)
      if (i % 15 === 0) out.push(window.__arena.audit())
    }
    for (const k of held) press(k, false)
    return out
  }, [Math.round((SECONDS + 2.6) * 30)])
  const bad = audits.filter((a) => !a.ok)
  const kinds = [...new Set(audits.flatMap((a) => a.kinds))].sort()
  check(audits.length > 10 && bad.length === 0, `audit held on all ${audits.length} checks (target kinds seen: ${kinds.join(', ')})`)
  if (bad.length) console.log(JSON.stringify(bad[0]))
  const s = await page.evaluate(() => window.__arena.state())
  check(s.score > 0, `the bot scored (${s.score}; ${JSON.stringify(s.stats)})`)
  check(s.crowd.cheers > 0, `the crowd cheered ${s.crowd.cheers} times`)
  check(!kinds.includes('rival'), 'no rival kind exists any more')
  check(s.crowd.cards === fans.length, `every fan's drawing is pinned to the wall (${s.crowd.cards} of ${fans.length})`)
  check(audits.at(-1).crowdSeated && audits.at(-1).drawingsOnWall && audits.at(-1).cardsHittable === 0, 'fans in the stands, drawings on the wall, none hittable')
  await ctx.close()
}

await browser.close()
if (fails.length) { console.log(`${fails.length} failed`); process.exit(1) }
console.log('all passed')
