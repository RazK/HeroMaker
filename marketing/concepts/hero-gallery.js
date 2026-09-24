/**
 * The gallery chapter, live from the product.
 *
 * "you see a preview of the actual gallery. literally use the gallery there."
 * So the row is not a mood board: it is the same public endpoint the site's
 * own gallery reads, and the pairs in it are real children's drawings and the
 * heroes they actually became.
 *
 *   GET https://heromaker.up.railway.app/api/creations/?limit=60
 *
 * Public, read-only, no key, and it answers `Access-Control-Allow-Origin: *`.
 * It returns a bare list at small limits and a `{creations, total}` envelope
 * at larger ones, so both are accepted — the same shape `marketing/fetch_pairs.py`
 * handles in Python.
 *
 * Files for one creation:
 *   /api/files/{user_id}/{id}/rendered.png    the hero
 *   /api/files/{user_id}/{id}/original.jpg    the drawing it came from
 * Prefixing the filename with `thumb_` gives the thumbnail, which is what a
 * row of tiles wants.
 *
 * A TILE IS THE PRODUCT'S TILE. Square, 8px radius, `object-fit:cover`, and
 * the drawing and the hero stacked and cross-fading on a 10s loop - the same
 * markup shape and the same keyframes as
 * `frontend/src/components/CreationGallery.{tsx,css}`. See chapters.css.
 *
 * IT MUST DEGRADE. The six committed pairs in `assets/pairs/` are already in
 * the markup when this file runs, so the chapter is never blank and never
 * waits. Live tiles replace them only once enough of them have actually
 * decoded — not when the fetch returns, because a 200 with broken images is
 * worse than the fallback. No network, a slow network, a 500, an empty list
 * or a bad shape all leave the committed pairs exactly where they are.
 */
const API = 'https://heromaker.up.railway.app'
const LIMIT = 60      // how many creations to ask about
const TILES = 12      // how many make it into the row
const NEEDED = 6      // fewer live pairs than the fallback is not an upgrade
const TIMEOUT = 8000

const file = (c, name) => `${API}/api/files/${c.user_id}/${c.id}/${name}`

/** Both shapes the endpoint answers with. */
const listOf = (body) =>
  Array.isArray(body) ? body : (body && Array.isArray(body.creations) ? body.creations : [])

const usable = (c) =>
  c && c.status === 'completed' && c.character_name && c.id && c.user_id

/**
 * Resolve true only if the image really decoded, and always resolve.
 *
 * Note what is NOT set on these images: `loading="lazy"`. A lazy image that is
 * not in the document never starts loading, and these are built detached on
 * purpose - the committed pairs stay on screen until the live ones are proven.
 * Marking them lazy made the swap wait for a fetch the browser had not begun,
 * for ever. The timeout is the second belt: a hung connection must cost the
 * chapter nothing, because it already has something good to show.
 */
const loads = (img) => new Promise((done) => {
  if (img.complete && img.naturalWidth > 0) return done(true)
  const t = setTimeout(() => done(false), TIMEOUT)
  const end = (ok) => { clearTimeout(t); done(ok) }
  img.addEventListener('load', () => end(img.naturalWidth > 0), { once: true })
  img.addEventListener('error', () => end(false), { once: true })
})

/**
 * One tile, built the way the product's own gallery builds one.
 *
 * `CreationGallery.tsx` stacks `thumb_original.jpg` and `thumb_rendered.png`
 * in one square container and cross-fades between them on a 10s loop
 * (`creation-gallery-image-original` / `-rendered`). The classes here are the
 * landing page's equivalents, and chapters.css carries the same keyframes, so
 * a live tile and a committed one are the same object.
 */
function tile(c) {
  const li = document.createElement('li')
  const pair = document.createElement('div')
  pair.className = 'hm-pair'

  const drawing = new Image()
  drawing.className = 'hm-img-drawing'
  drawing.src = file(c, 'thumb_original.jpg')
  drawing.alt = `the drawing ${c.character_name} was made from`
  drawing.decoding = 'async'

  const hero = new Image()
  hero.className = 'hm-img-hero'
  hero.src = file(c, 'thumb_rendered.png')
  hero.alt = `${c.character_name}, the 3D hero it became`
  hero.decoding = 'async'

  pair.append(drawing, hero)
  const name = document.createElement('b')
  name.textContent = c.character_name
  li.append(pair, name)
  return { li, ready: Promise.all([loads(drawing), loads(hero)]).then(r => r[0] && r[1]) }
}

async function fill(row) {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TIMEOUT)
  let body
  try {
    const res = await fetch(`${API}/api/creations/?limit=${LIMIT}`, {
      signal: stop.signal, mode: 'cors', credentials: 'omit',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.json()
  } catch (err) {
    console.warn('hero-gallery: keeping the committed pairs —', err && err.message)
    return
  } finally {
    clearTimeout(timer)
  }

  const all = listOf(body).filter(usable)
  // The headline figure is every finished hero on the live site, not just the
  // dozen that fit in the row.
  const finished = listOf(body).filter(c => c && c.status === 'completed').length
  if (finished > 0) {
    for (const el of document.querySelectorAll('[data-gallery-count]')) {
      el.textContent = String(finished)
    }
  }
  if (all.length < NEEDED) return

  // Newest first, so the row shows what the product made most recently.
  all.sort((a, b) => String(b.completed_at || b.created_at || '')
    .localeCompare(String(a.completed_at || a.created_at || '')))

  const built = all.slice(0, TILES).map(tile)
  const ok = await Promise.all(built.map(b => b.ready))
  const good = built.filter((_, i) => ok[i])
  if (good.length < NEEDED) {
    console.warn(`hero-gallery: only ${good.length} live pairs decoded — keeping the committed ones`)
    return
  }

  row.replaceChildren(...good.map(b => b.li))
  row.dataset.live = '1'
  row.scrollLeft = 0
}

function init() {
  const rows = [...document.querySelectorAll('[data-gallery-row]')]
  if (rows.length === 0) return
  // After paint: the committed pairs are the thing that must be on screen
  // first, and nothing here is allowed to delay them.
  const go = () => rows.forEach(fill)
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
