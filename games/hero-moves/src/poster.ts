import * as THREE from 'three'
import { parseHero, type Hero } from './avatar/loader'
import { loadRetargeted } from './anim/clips'
import { animUrl } from './anim/files'
import { makeThing, type Kind } from './arena/things'

/**
 * Key art for the app's game chooser, rendered offline from a real hero.
 *
 * Not a screenshot: a staged shot — a low, three-quarter-front camera, the
 * hero frozen at the best frame of a real clip, a bold rim light, brand-colour
 * shapes behind, a blurred far layer for depth and a soft vignette. Both
 * posters share the composition so they read as a set.
 *
 *   poster.html?vrm=<url>&kind=rumble|dance&w=800&h=1000[&t=<clip seconds>]
 *   window.__poster() -> PNG data URL, once window.__ready
 *
 * tools/make-posters.mjs drives it and writes the WebPs the app ships.
 */

const params = new URLSearchParams(location.search)
const KIND = (params.get('kind') ?? 'rumble') as 'rumble' | 'dance'
const W = Number(params.get('w') ?? 800)
const H = Number(params.get('h') ?? 1000)
const VRM = params.get('vrm') ?? ''

const PAL = {
  grape: 0x5b3df5, grapeDeep: 0x3a22b8, sun: 0xffc233, cream: 0xfff6e9, ink: 0x231942,
  pink: 0xff5fa2, mint: 0x15997a, red: 0xe5484d, sky: 0x2fa8e0, lilac: 0xe9e3ff,
}
const css = (c: number) => '#' + c.toString(16).padStart(6, '0')

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(W, H, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.setClearColor(0x000000, 0)
document.body.style.margin = '0'

const out = document.createElement('canvas')
out.width = W; out.height = H
out.style.width = `${W / 2}px`
document.body.appendChild(out)

// ------------------------------------------------------------------ backdrop (2D)

/** Rays from behind the hero, a sun disc, and the palette's colour fields. */
function paintBackdrop(g: CanvasRenderingContext2D, cx: number, cy: number) {
  const [a, b] = KIND === 'rumble' ? [PAL.grape, PAL.grapeDeep] : [0x7a2fd6, PAL.grapeDeep]
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.7)
  grad.addColorStop(0, css(a)); grad.addColorStop(1, css(b))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  // Rays.
  g.save(); g.translate(cx, cy)
  const n = 16
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(255,194,51,0.10)'
    g.beginPath(); g.moveTo(0, 0)
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2
    g.lineTo(Math.cos(a0) * W * 2, Math.sin(a0) * W * 2)
    g.lineTo(Math.cos(a1) * W * 2, Math.sin(a1) * W * 2)
    g.closePath(); g.fill()
  }
  g.restore()
  // Dance party: two stage spotlights sweeping down onto the hero.
  if (KIND === 'dance') {
    for (const [x0, x1] of [[W * 0.05, cx - W * 0.05], [W * 0.95, cx + W * 0.05]]) {
      const beam = g.createLinearGradient(x0, 0, x1, H * 0.85)
      beam.addColorStop(0, 'rgba(255,241,184,0.55)')
      beam.addColorStop(1, 'rgba(255,241,184,0.0)')
      g.fillStyle = beam
      g.beginPath()
      g.moveTo(x0 - W * 0.04, -10); g.lineTo(x0 + W * 0.04, -10)
      g.lineTo(x1 + W * 0.22, H * 0.9); g.lineTo(x1 - W * 0.22, H * 0.9)
      g.closePath(); g.fill()
    }
  }
  // The sun every ready hero stands in front of, in the app.
  g.fillStyle = css(PAL.sun)
  g.beginPath(); g.arc(cx, cy, W * 0.36, 0, Math.PI * 2); g.fill()
  g.fillStyle = 'rgba(255,255,255,0.25)'
  g.beginPath(); g.arc(cx, cy, W * 0.36, Math.PI * 1.1, Math.PI * 1.45); g.lineTo(cx, cy); g.fill()
}

function vignette(g: CanvasRenderingContext2D) {
  const v = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62)
  v.addColorStop(0, 'rgba(35,25,66,0)')
  v.addColorStop(1, 'rgba(35,25,66,0.55)')
  g.fillStyle = v
  g.fillRect(0, 0, W, H)
}

// ------------------------------------------------------------------ scene

const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 50)
const far = new THREE.Scene()   // blurred layer
const near = new THREE.Scene()  // the hero and what flies past it

function lights(s: THREE.Scene) {
  s.add(new THREE.HemisphereLight(0xffffff, 0x8a6cff, 1.1))
  const key = new THREE.DirectionalLight(0xfff3e0, 2.4)
  key.position.set(2.5, 3, 5)
  s.add(key)
  // The bold rim: hard, warm, from behind and above.
  const rim = new THREE.DirectionalLight(0xffd36b, 4.5)
  rim.position.set(-3, 4, -4)
  s.add(rim)
  const rim2 = new THREE.DirectionalLight(0xff8ad0, 2.5)
  rim2.position.set(4, 1.5, -3)
  s.add(rim2)
}
lights(far); lights(near)

const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647 })()

function confetti(s: THREE.Scene, n: number, spread: THREE.Vector3, at: THREE.Vector3) {
  const cols = [PAL.sun, PAL.pink, PAL.sky, PAL.mint, 0xffffff, PAL.red]
  const geo = new THREE.PlaneGeometry(0.07, 0.12)
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.5 }))
    m.position.set(at.x + (rnd() - 0.5) * spread.x, at.y + (rnd() - 0.5) * spread.y, at.z + (rnd() - 0.5) * spread.z)
    m.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6)
    s.add(m)
  }
}

function blockTex(ch: string, col: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = col; g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fff6e9'; g.beginPath(); g.roundRect(12, 12, 104, 104, 18); g.fill()
  g.fillStyle = col; g.font = '900 84px Nunito, system-ui, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 70)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

function noteTex() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.translate(64, 64); g.scale(4.4, 4.4); g.translate(-12, -12)
  g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'
  g.strokeStyle = '#231942'; g.fillStyle = '#ffc233'
  const p = new Path2D('M9 18V5.5l11-2V16')
  g.stroke(p)
  for (const [x, y] of [[6, 18], [17, 16]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.stroke() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

async function pose(hero: Hero, file: string, t: number) {
  const { clip } = await loadRetargeted(animUrl(file), hero.vrm)
  const mixer = new THREE.AnimationMixer(hero.vrm.scene)
  mixer.clipAction(clip).play()
  mixer.setTime(t)
  hero.vrm.update(0)
  hero.root.updateMatrixWorld(true)
}

async function build() {
  const r = await fetch(VRM)
  const hero = await parseHero(await r.arrayBuffer())
  near.add(hero.root)
  const h = hero.height

  if (KIND === 'rumble') {
    // Mid-air, fist out: the cross at full extension, a metre off the floor.
    await pose(hero, params.get('clip') ?? 'Punch_Cross.glb', Number(params.get('t') ?? 0.55))
    hero.root.position.set(0, 0.55, 0)
    hero.root.rotation.set(0.05, Number(params.get('yaw') ?? 0.95), 0.06)
    // Wind-up robots flying out of the punch, mid-tumble.
    const robots: [number, number, number, number][] = [[1.2, 1.85, 0.25, 0.55], [-1.25, 0.5, -0.5, 0.65], [0.95, 2.6, -1.2, 0.5]]
    robots.forEach(([x, y, z, s], i) => {
      const th = makeThing('robot' as Kind, rnd)
      th.obj.scale.setScalar(s)
      th.obj.position.set(x, y, z)
      th.obj.rotation.set(0.8 * (i + 1), 0.6 - i, 0.5 * i)
      th.blob.visible = false
      ;(i === 2 ? far : near).add(th.obj)
    })
    // Toy blocks, far and blurred.
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const blocks: [string, string, number, number, number, number][] = [
      ['H', '#5b3df5', -1.9, 0.45, -2.6, 0.9], ['E', '#ffc233', -0.9, 0.35, -3.2, 0.7],
      ['R', '#15997a', 1.6, 0.4, -2.8, 0.8], ['O', '#e5484d', 2.4, 1.2, -3.4, 0.7],
    ]
    for (const [ch, col, x, y, z, s] of blocks) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: blockTex(ch, col), roughness: 0.6 }))
      m.scale.setScalar(s); m.position.set(x, y, z); m.rotation.set(0.2, x * 0.3, 0.1)
      far.add(m)
    }
    confetti(near, 60, new THREE.Vector3(3.2, 2.6, 1.6), new THREE.Vector3(0.2, 1.3, 0.3))
    camera.position.set(1.1, 0.45, 4.6)
    camera.lookAt(0.1, h * 0.62 + 0.4, 0)
  } else {
    // A big dance move centre stage, under two spotlights.
    await pose(hero, params.get('clip') ?? 'Dance_Charleston.glb', Number(params.get('t') ?? 1.2))
    hero.root.rotation.set(0, Number(params.get('yaw') ?? 0.45), 0)
    // The stage: a sun disc of a floor with a grape rim.
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.25, 48), [
      new THREE.MeshStandardMaterial({ color: PAL.grapeDeep, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: PAL.sun, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: PAL.grapeDeep }),
    ])
    stage.position.y = -0.125
    near.add(stage)
    // Spotlight cones, additive.
    for (const [x, rz] of [[-1.8, -0.42], [1.9, 0.45]]) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.1, 5, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      )
      cone.position.set(x, 2.3, -0.5)
      cone.rotation.z = rz
      far.add(cone)
    }
    // Music notes floating up.
    const tex = noteTex()
    const notes: [number, number, number, number][] = [[-1.1, 1.9, 0.4, 0.55], [1.2, 2.2, 0.2, 0.45], [0.9, 0.9, 0.8, 0.4], [-1.5, 0.9, -0.4, 0.35], [-0.3, 2.6, -0.6, 0.35]]
    for (const [x, y, z, s] of notes) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, rotation: (x > 0 ? -0.3 : 0.3) }))
      sp.scale.setScalar(s); sp.position.set(x, y, z)
      ;(z < 0 ? far : near).add(sp)
    }
    confetti(near, 40, new THREE.Vector3(3.6, 2.8, 1.4), new THREE.Vector3(0, 1.8, 0.2))
    camera.position.set(0.9, 0.3, 4.1)
    camera.lookAt(0.05, h * 0.56, 0)
  }
  camera.updateProjectionMatrix()
}

function draw(): string {
  const g = out.getContext('2d')!
  // Where the hero's chest lands on screen anchors the sun and the rays.
  const c = new THREE.Vector3(0, KIND === 'rumble' ? 1.6 : 1.1, 0).project(camera)
  const cx = (c.x * 0.5 + 0.5) * W, cy = (-c.y * 0.5 + 0.5) * H
  paintBackdrop(g, cx, cy)
  renderer.render(far, camera)
  g.save(); g.filter = `blur(${Math.round(W / 160)}px)`; g.drawImage(renderer.domElement, 0, 0); g.restore()
  renderer.render(near, camera)
  g.drawImage(renderer.domElement, 0, 0)
  vignette(g)
  return out.toDataURL('image/png')
}

build().then(() => {
  ;(window as unknown as Record<string, unknown>).__poster = draw
  draw()
  ;(window as unknown as Record<string, unknown>).__ready = true
}).catch((e) => { (window as unknown as Record<string, unknown>).__ready = `error:${(e as Error).message}` })
