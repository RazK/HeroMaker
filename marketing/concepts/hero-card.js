/**
 * The live half of the transformation card, shared by all five concepts.
 *
 * The hero shot is a card: a real child's drawing on one side, and on the
 * other the same kind of thing the pipeline hands back — a real VRM, rigged
 * and actually moving. Not a picture of one.
 *
 * Nothing here knows how to animate a VRM. `hero-card-engine.js` is compiled
 * straight out of `games/hero-moves/src/{avatar/loader,anim/clips,
 * anim/retarget}.ts`, so the retargeting that puts CC0 mocap on a hero whose
 * head is a third of its height is the same code the game ships. This file is
 * only the stage: a canvas, three lights, a camera and a fallback.
 *
 * Markup per card (see any concept-*.html):
 *
 *   <div class="herocard" data-hero-card
 *        data-vrm="assets/Yummy_Bear.opt.vrm"
 *        data-clip="assets/Dance_Charleston.glb"
 *        data-rim="#FF6B35" data-key="#FFF3E6"
 *        data-ambient=".55" data-shadow=".38" data-outline="1">
 *     <img class="herocard-still" src="assets/Yummy_Bear.thumb.webp" alt="…">
 *   </div>
 *
 * Three ways this degrades, in order of how likely they are:
 *
 *   reduced motion   the still stays, nothing is ever fetched
 *   no WebGL         the still stays, nothing is ever fetched
 *   load failure     the still stays, one console warning
 *
 * The still is `Yummy_Bear.thumb.webp` — a real render of the same avatar, so
 * a card that never goes live still shows the hero rather than an empty box.
 * It is in the markup, not created here, so it survives this script not
 * running at all.
 */

const CARDS = '[data-hero-card]'

/** Cheap one-off probe. A card with no WebGL must not download 1.1 MB of VRM. */
function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

async function start(card) {
  const engine = await import('./hero-card-engine.js')
  const THREE = await import('three')

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

  // Some heroes are wider than they are tall; frame on whichever is bigger.
  const frame = Math.max(hero.height, hero.width * 1.05) * num('zoom', 1.24)
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 60)
  const dist = (frame / 2) / Math.tan((26 * Math.PI / 180) / 2)
  const yaw = num('yaw', 0.18)
  camera.position.set(Math.sin(yaw) * dist, hero.height * num('eye', 0.56), Math.cos(yaw) * dist)
  camera.lookAt(0, hero.height * num('look', 0.5), 0)

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

  // The clip is optional on purpose: a hero that arrived but whose animation
  // did not is a hero standing still, never a broken card.
  let mixer = null
  try {
    const url = card.dataset.clip
    const loaded = url.endsWith('.vrma')
      ? await engine.loadVrma(url, hero.vrm)
      : await engine.loadRetargeted(url, hero.vrm)
    mixer = new THREE.AnimationMixer(hero.vrm.scene)
    const action = mixer.clipAction(loaded.clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
  } catch (err) {
    console.warn('hero-card: clip unavailable —', err && err.message)
  }

  card.classList.add('is-live')

  const clock = new THREE.Clock()
  let visible = true
  let raf = 0

  const tick = () => {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.1)
    if (mixer) mixer.update(dt)
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

function arm(card) {
  if (card.dataset.heroCardArmed) return
  card.dataset.heroCardArmed = '1'
  start(card).catch((err) => {
    card.classList.remove('is-live')
    card.classList.add('is-still')
    console.warn('hero-card: falling back to the still —', err && err.message)
  })
}

function init() {
  const cards = [...document.querySelectorAll(CARDS)]
  if (cards.length === 0) return

  if (reduceMotion() || !hasWebGL()) {
    cards.forEach((c) => c.classList.add('is-still'))
    return
  }

  // Lazy on purpose: the avatar is 1.1 MB and the page must paint without it.
  if (!window.IntersectionObserver) { cards.forEach(arm); return }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      io.unobserve(e.target)
      arm(e.target)
    }
  }, { rootMargin: '400px 0px' })
  cards.forEach((c) => io.observe(c))
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
