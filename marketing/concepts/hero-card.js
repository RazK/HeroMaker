/**
 * The live half of the hero card, shared by all five concepts.
 *
 * The hero shot is a card: one child's real drawing on the left, and on the
 * right the hero it actually became — the real rigged VRM, moving, with three
 * buttons that let the visitor pick what it does. Not a picture of one.
 *
 * Nothing here knows how to animate a VRM. `hero-card-engine.js` is compiled
 * straight out of `games/hero-moves/src/{avatar/loader,anim/clips,
 * anim/performer,anim/retarget}.ts`, so the loading, the retargeting that puts
 * CC0 mocap on a hero whose head is a third of its height, the clip table with
 * its credits, and `Performer.airborne` are all the code the game ships. This
 * file is only the stage: a canvas, three lights, a camera, and the fallback.
 *
 * Markup per card (see any concept-*.html):
 *
 *   <figure class="livecard" data-hero-shot>
 *     … the drawing half …
 *     <div class="livecard-media herocard" data-hero-card
 *          data-vrm="assets/Crayon_Kid.opt.vrm" data-clips="assets/anim/"
 *          data-rim="#FA5197" data-key="#FFF4E4"
 *          data-ambient=".5" data-shadow=".5">
 *       <img class="herocard-still" src="…-hero-cutout.webp" alt="…">
 *     </div>
 *     <div class="livecard-moves" data-hero-moves hidden>
 *       <button type="button" data-move="fly" data-default aria-pressed="true">Fly</button>
 *       …
 *     </div>
 *   </figure>
 *
 * `data-move` carries the game's own clip ids, so `CLIPS` supplies the file and
 * the CC0 credit, and `Performer.airborne` already knows which of them leave
 * the ground — the camera eases back for those rather than letting the hero fly
 * out through the top of the card.
 *
 * How it degrades, in order of how likely it is:
 *
 *   reduced motion   no autoplay and nothing fetched; the still stays and the
 *                    buttons still work, so a visitor who wants motion can ask
 *   no WebGL         the still stays and the buttons are removed, rather than
 *                    leaving three controls that do nothing
 *   load failure     the same, plus one console warning
 *
 * The still is the product's own render of the same hero with its backdrop
 * keyed out, so a card that never goes live still shows the hero — and the
 * caption beside it then says "the real VRM file" rather than claiming motion.
 * It is in the markup, not created here, so it survives this script not running
 * at all.
 */

const CARDS = '[data-hero-card]'

/** Cheap one-off probe. A card with no WebGL must not download 1.2 MB of VRM. */
function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const reduceMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

/** Soft contact shadow, drawn once into a canvas texture. */
function shadowTexture(THREE) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(0.45, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The engine, however it can be had.
 *
 * `hero-card-engine.js` leaves three and @pixiv/three-vrm to the page's import
 * map, which points at cdn.jsdelivr.net. Where that CDN is unreachable — a
 * corporate proxy, no network, CI — the import rejects and the same code,
 * bundled with its dependencies, comes off the disk instead. Either way the
 * animation is the game's, and `THREE` comes back from the engine so the stage
 * and the clips are built against one copy of three.
 */
let enginePromise = null
const loadEngine = () => (enginePromise ??= import('./hero-card-engine.js').catch((err) => {
  console.warn('hero-card: CDN modules unavailable, using the bundled engine —', err && err.message)
  return import('./hero-card-engine.bundle.js')
}))

const whenIdle = (fn) =>
  (window.requestIdleCallback || ((f) => setTimeout(f, 900)))(fn, { timeout: 4000 })

async function start(card, firstMove) {
  const shot = card.closest('[data-hero-shot]')
  const buttons = [...(shot ? shot.querySelectorAll('[data-hero-moves] button[data-move]') : [])]
  const engine = await loadEngine()
  const THREE = engine.THREE

  const num = (name, fallback) => {
    const v = parseFloat(card.dataset[name])
    return Number.isFinite(v) ? v : fallback
  }

  const hero = await engine.loadHero(card.dataset.vrm, {
    outline: card.dataset.outline === '1',
  })

  const renderer = new THREE.WebGLRenderer({
    alpha: true, antialias: true, powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearAlpha(0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  card.appendChild(canvas)

  const scene = new THREE.Scene()
  scene.add(hero.root)

  const ambient = num('ambient', 0.55)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8ca0, 1.6 * ambient + 0.7))
  const key = new THREE.DirectionalLight(new THREE.Color(card.dataset.key || '#ffffff'), 1.7)
  key.position.set(1.4, 2.6, 2.4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(new THREE.Color(card.dataset.rim || '#ffffff'), 1.25)
  rim.position.set(-2.2, 1.6, -1.8)
  scene.add(rim)

  // A drawn-on blob rather than a shadow map: no depth pass, no shadow acne on
  // a hero whose geometry came out of a five-year-old's felt-tip.
  const shade = num('shadow', 0.38)
  if (shade > 0) {
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(THREE), transparent: true, opacity: shade,
        depthWrite: false, color: new THREE.Color(card.dataset.shadowColor || '#000000'),
      }),
    )
    blob.rotation.x = -Math.PI / 2
    blob.position.y = 0.002
    const span = Math.max(hero.width, hero.height * 0.42) * 1.7
    blob.scale.set(span, span, 1)
    scene.add(blob)
  }

  // ---- camera -------------------------------------------------------------
  // Framed with headroom on purpose: a clip swings the arms well outside the
  // rest bounding box. Some heroes are wider than they are tall, so the frame
  // is solved from whichever is bigger.
  const FOV = 26
  const base = Math.max(hero.height, hero.width * 1.05) * num('zoom', 1.45)
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60)
  const yaw = num('yaw', 0.18)
  // Backflip and Fly leave the floor. The game already knows which clips do -
  // `Performer.airborne` - and this is the pull-back that keeps them inside the
  // card instead of sending the hero out through the top of it.
  const AIR = num('airZoom', 1.8)
  let widen = 1

  const placeCamera = () => {
    const dist = (base * widen / 2) / Math.tan((FOV * Math.PI / 180) / 2)
    const lift = (widen - 1) * 0.5
    camera.position.set(
      Math.sin(yaw) * dist,
      hero.height * (num('eye', 0.54) + lift),
      Math.cos(yaw) * dist,
    )
    camera.lookAt(0, hero.height * (num('look', 0.47) + lift), 0)
  }
  placeCamera()

  const resize = () => {
    const w = Math.max(1, Math.round(card.clientWidth))
    const h = Math.max(1, Math.round(card.clientHeight))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  if (window.ResizeObserver) new ResizeObserver(resize).observe(card)
  else window.addEventListener('resize', resize)

  // ---- the moves ----------------------------------------------------------
  // `data-move` is the game's own clip id, so CLIPS supplies the filename and
  // the CC0 credit, and nothing here keeps a second copy of that table.
  const dir = card.dataset.clips || 'assets/anim/'
  const resolve = (file) => dir + file
  const performer = new engine.Performer(hero)
  const specs = new Map(engine.CLIPS.map((c) => [c.id, c]))
  const wanted = buttons.map((b) => b.dataset.move).filter((id) => specs.has(id))

  const mark = (id) => {
    for (const b of buttons) {
      const on = b.dataset.move === id
      b.setAttribute('aria-pressed', String(on))
      b.classList.toggle('is-on', on)
    }
  }

  // The last button pressed wins, even if an earlier one is still downloading.
  let asked = null
  const playMove = async (id) => {
    asked = id
    if (!performer.has(id)) {
      if (!await performer.load(specs.get(id), resolve)) return
      if (asked !== id) return
    }
    performer.play(id, { loop: true, fade: performer.playing ? 0.3 : 0 })
    mark(id)
  }

  for (const b of buttons) {
    b.addEventListener('click', () => playMove(b.dataset.move))
  }

  // Only the default clip is fetched up front. The other two arrive once the
  // browser is idle, or straight away if the visitor asks for one first.
  if (firstMove && wanted.includes(firstMove)) await playMove(firstMove)
  whenIdle(() => {
    for (const id of wanted) {
      if (!performer.has(id)) performer.load(specs.get(id), resolve)
    }
  })

  card.classList.add('is-live')
  if (shot) shot.classList.add('is-live')

  // ---- the loop -----------------------------------------------------------
  const clock = new THREE.Clock()
  let visible = true
  let raf = 0

  const tick = () => {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.1)
    performer.update(dt)
    const want = performer.airborne ? AIR : 1
    if (Math.abs(want - widen) > 0.001) {
      widen += (want - widen) * Math.min(1, dt * 3.5)
      placeCamera()
    }
    hero.vrm.update(dt)
    renderer.render(scene, camera)
  }

  const play = () => { if (!raf) { clock.getDelta(); raf = requestAnimationFrame(tick) } }
  const pause = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
  const sync = () => (visible && !document.hidden ? play() : pause())

  // Off-screen or in a background tab, a landing page has no business holding
  // the GPU. Render one frame first so the card is never handed over blank.
  renderer.render(scene, camera)
  if (window.IntersectionObserver) {
    new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      sync()
    }, { rootMargin: '120px' }).observe(card)
  }
  document.addEventListener('visibilitychange', sync)
  sync()
}

function setStill(card) {
  card.classList.remove('is-live')
  card.classList.add('is-still')
  const shot = card.closest('[data-hero-shot]')
  if (!shot) return
  shot.classList.remove('is-live')
  shot.classList.add('is-still')
}

/** Three controls that cannot do anything are worse than no controls. */
function dropMoves(card) {
  const shot = card.closest('[data-hero-shot]')
  const moves = shot && shot.querySelector('[data-hero-moves]')
  if (moves) moves.remove()
}

function arm(card, firstMove) {
  if (card.dataset.heroCardArmed) return
  card.dataset.heroCardArmed = '1'
  start(card, firstMove).catch((err) => {
    setStill(card)
    dropMoves(card)
    console.warn('hero-card: falling back to the still —', err && err.message)
  })
}

function init() {
  const cards = [...document.querySelectorAll(CARDS)]
  if (cards.length === 0) return

  if (!hasWebGL()) {
    cards.forEach((c) => { setStill(c); dropMoves(c) })
    return
  }

  for (const card of cards) {
    const shot = card.closest('[data-hero-shot]')
    const moves = shot && shot.querySelector('[data-hero-moves]')
    if (moves) moves.hidden = false
    const pick = moves && (moves.querySelector('button[data-default]') || moves.querySelector('button[data-move]'))
    const first = pick && pick.dataset.move

    // Asked for stillness: nothing is fetched and nothing moves on its own,
    // but the buttons stay live so a visitor can still choose to see it.
    if (reduceMotion()) {
      setStill(card)
      if (moves) {
        moves.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-move]')
          if (btn) arm(card, btn.dataset.move)
        }, { once: true })
      }
      continue
    }

    // Lazy on purpose: the avatar is 1.2 MB and the page must paint without it.
    if (!window.IntersectionObserver) { arm(card, first); continue }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io.unobserve(e.target)
        arm(e.target, first)
      }
    }, { rootMargin: '400px 0px' })
    io.observe(card)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
