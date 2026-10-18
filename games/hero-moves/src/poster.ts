import * as THREE from 'three'
import { parseHero, type Hero } from './avatar/loader'
import { loadRetargeted } from './anim/clips'
import { animUrl } from './anim/files'
import { makeThing, type Kind } from './arena/things'

/**
 * Key art for the app's game chooser, rendered offline from a real hero.
 *
 * Not a screenshot: a staged shot — a low camera, the hero frozen at the best
 * frame of a real clip, a bold rim light, a blurred far layer for depth and a
 * vignette. The two posters share that craft and nothing else: each game owns
 * a palette (its toybox.css token), a world and a silhouette, so a child can
 * tell them apart at thumbnail size before reading a title.
 *
 *   Robot Rumble  tangerine and red action rays, a comic impact burst, an
 *                 arena ring; the hero mid-air, landing a flying cross punch
 *                 on a wind-up robot. A wide, diagonal silhouette.
 *   Dance party   a night club: deep violet dark, magenta and pink spotlight
 *                 beams, a disco ball and a lit LED floor; the hero in a
 *                 disco point, one arm to the sky, knee up. A tall silhouette.
 *
 *   poster.html?vrm=<url>&kind=rumble|dance&w=800&h=1000[&clip=<file>&t=<s>&yaw=<rad>]
 *   window.__poster() -> PNG data URL, once window.__ready
 *
 * tools/make-posters.mjs drives it and writes the WebPs the app ships.
 */

const params = new URLSearchParams(location.search)
const KIND = (params.get('kind') ?? 'rumble') as 'rumble' | 'dance'
const W = Number(params.get('w') ?? 800)
const H = Number(params.get('h') ?? 1000)
const VRM = params.get('vrm') ?? ''

/** Toy Box tokens (frontend/src/styles/toybox.css), as numbers. */
const PAL = {
  grape: 0x5b3df5, grapeDeep: 0x3a22b8, sun: 0xffc233, cream: 0xfff6e9, ink: 0x231942,
  red: 0xc62828, plate5: 0xd6ecff, plate6: 0xffd6e7,
  rumble: 0xff7a1a, rumbleDeep: 0xd9480f,
  dance: 0xd6247f, danceDeep: 0x1e0b3a,
  // Accents the arena itself paints with (src/arena/things.ts).
  pink: 0xff5fa2, sky: 0x2fa8e0,
}
const css = (c: number, a = 1) => `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${a})`

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

const seeded = (seed: number) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }
const rnd = seeded(7)

// ------------------------------------------------------------------ backdrops (2D)

/** Robot Rumble: hot rays bursting out from the punch, and a comic "POW" star at the fist. */
function paintRumble(g: CanvasRenderingContext2D, cx: number, cy: number, fx: number, fy: number) {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.75)
  grad.addColorStop(0, '#ffb03b')
  grad.addColorStop(0.35, css(PAL.rumble))
  grad.addColorStop(0.75, css(PAL.rumbleDeep))
  grad.addColorStop(1, css(PAL.red))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  // Action rays from the impact, alternating sun and red.
  g.save(); g.translate(fx, fy)
  const n = 22
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? css(PAL.red, 0.28) : css(PAL.sun, 0.3)
    g.beginPath(); g.moveTo(0, 0)
    const a0 = (i / n) * Math.PI * 2 + 0.08, a1 = ((i + 0.55) / n) * Math.PI * 2 + 0.08
    g.lineTo(Math.cos(a0) * W * 2, Math.sin(a0) * W * 2)
    g.lineTo(Math.cos(a1) * W * 2, Math.sin(a1) * W * 2)
    g.closePath(); g.fill()
  }
  g.restore()
  // The impact burst: a jagged star, sun on cream, with the Toy Box ink outline.
  const star = (r0: number, r1: number, pts: number, rot: number) => {
    g.beginPath()
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 ? r0 : r1 * (0.85 + 0.15 * Math.sin(i * 2.3))
      const a = rot + (i / (pts * 2)) * Math.PI * 2
      g.lineTo(fx + Math.cos(a) * r, fy + Math.sin(a) * r)
    }
    g.closePath()
  }
  g.lineJoin = 'round'
  star(W * 0.13, W * 0.27, 11, 0.2)
  g.fillStyle = css(PAL.sun); g.fill()
  g.lineWidth = W / 110; g.strokeStyle = css(PAL.ink); g.stroke()
  star(W * 0.07, W * 0.15, 11, 0.45)
  g.fillStyle = css(PAL.cream); g.fill()
}

/** Dance party: a dark club, a magenta glow behind the dancer and coloured beams from the rig. */
function paintDance(g: CanvasRenderingContext2D, cx: number, cy: number) {
  const base = g.createLinearGradient(0, 0, 0, H)
  base.addColorStop(0, '#2c0f55')
  base.addColorStop(0.6, css(PAL.danceDeep))
  base.addColorStop(1, '#12061f')
  g.fillStyle = base
  g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.75)
  glow.addColorStop(0, css(PAL.dance, 0.85))
  glow.addColorStop(0.45, css(PAL.dance, 0.35))
  glow.addColorStop(1, css(PAL.dance, 0))
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)
  // Beams fanning down from the lighting rig; the white one lands on the dancer.
  g.save()
  g.globalCompositeOperation = 'lighter'
  const beams: [number, number, number, number, number][] = [
    // x at the top, x at the floor, half-width at the floor, colour, alpha
    [0.08, 0.62, 0.2, PAL.pink, 0.42], [0.92, 0.36, 0.2, PAL.pink, 0.42],
    [0.28, 0.02, 0.14, PAL.dance, 0.55], [0.74, 1.0, 0.14, PAL.dance, 0.55],
    [0.5, 0.5, 0.3, 0xfff0f8, 0.34],
  ]
  for (const [x0, x1, hw, col, a] of beams) {
    const beam = g.createLinearGradient(W * x0, 0, W * x1, H * 0.92)
    beam.addColorStop(0, css(col, a)); beam.addColorStop(1, css(col, 0))
    g.fillStyle = beam
    g.beginPath()
    g.moveTo(W * x0 - W * 0.025, -10); g.lineTo(W * x0 + W * 0.025, -10)
    g.lineTo(W * (x1 + hw), H * 0.92); g.lineTo(W * (x1 - hw), H * 0.92)
    g.closePath(); g.fill()
  }
  // Lamps in the rig.
  for (const [x, col] of [[0.08, PAL.pink], [0.28, PAL.dance], [0.5, 0xffffff], [0.74, PAL.dance], [0.92, PAL.pink]] as const) {
    const l = g.createRadialGradient(W * x, 0, 0, W * x, 0, W * 0.07)
    l.addColorStop(0, css(0xffffff, 0.95)); l.addColorStop(0.4, css(col, 0.7)); l.addColorStop(1, css(col, 0))
    g.fillStyle = l
    g.fillRect(W * x - W * 0.08, -W * 0.08, W * 0.16, W * 0.16)
  }
  // Disco-ball glints scattered over the walls (own seed: draw() may run twice).
  const rnd = seeded(11)
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H * 0.62, r = 1.5 + rnd() * W * 0.006
    g.fillStyle = css(i % 3 ? 0xffffff : PAL.plate6, 0.35 + rnd() * 0.5)
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  g.restore()
}

function vignette(g: CanvasRenderingContext2D) {
  const col = KIND === 'rumble' ? 0x5a0f08 : 0x0a0418
  const v = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62)
  v.addColorStop(0, css(col, 0))
  v.addColorStop(1, css(col, KIND === 'rumble' ? 0.5 : 0.7))
  g.fillStyle = v
  g.fillRect(0, 0, W, H)
}

// ------------------------------------------------------------------ scene

const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 50)
const far = new THREE.Scene()   // blurred layer
const near = new THREE.Scene()  // the hero and what flies past it

function lights(s: THREE.Scene) {
  if (KIND === 'rumble') {
    s.add(new THREE.HemisphereLight(0xfff0dc, 0xff7a1a, 1.1))
    const key = new THREE.DirectionalLight(0xfff3e0, 2.4)
    key.position.set(2.5, 3, 5)
    s.add(key)
    // The bold rim: hard and hot, from behind and above.
    const rim = new THREE.DirectionalLight(0xffc233, 4.5)
    rim.position.set(-3, 4, -4)
    s.add(rim)
    const rim2 = new THREE.DirectionalLight(0xff5a1a, 3)
    rim2.position.set(4, 1.5, -3)
    s.add(rim2)
  } else {
    s.add(new THREE.HemisphereLight(0xffe6f3, 0x3a1260, 1.0))
    // The follow spot: white, from above and in front.
    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(0.8, 5, 4)
    s.add(key)
    // Club rims: magenta from one side, a cool blue from the other, so a pink
    // hero still separates from a pink room.
    const rim = new THREE.DirectionalLight(0xff3fa4, 5)
    rim.position.set(-3.5, 3, -3)
    s.add(rim)
    const rim2 = new THREE.DirectionalLight(PAL.plate5, 3.5)
    rim2.position.set(3.5, 2, -3)
    s.add(rim2)
  }
}
lights(far); lights(near)

function confetti(s: THREE.Scene, n: number, cols: number[], spread: THREE.Vector3, at: THREE.Vector3, size = 1) {
  const geo = new THREE.PlaneGeometry(0.07 * size, 0.12 * size)
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.5 }))
    m.position.set(at.x + (rnd() - 0.5) * spread.x, at.y + (rnd() - 0.5) * spread.y, at.z + (rnd() - 0.5) * spread.z)
    m.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6)
    s.add(m)
  }
}

function canvasTex(size: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  paint(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

function noteTex(fill: string) {
  return canvasTex(128, (g) => {
    g.translate(64, 64); g.scale(4.4, 4.4); g.translate(-12, -12)
    g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'
    g.strokeStyle = '#ffffff'; g.fillStyle = fill
    g.stroke(new Path2D('M9 18V5.5l11-2V16'))
    for (const [x, y] of [[6, 18], [17, 16]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.stroke() }
  })
}

async function pose(hero: Hero, file: string, t: number) {
  const { clip } = await loadRetargeted(animUrl(file), hero.vrm)
  const mixer = new THREE.AnimationMixer(hero.vrm.scene)
  mixer.clipAction(clip).play()
  mixer.setTime(t)
  hero.vrm.update(0)
  hero.root.updateMatrixWorld(true)
}

/** World position of whichever hand is furthest along +x: the punching one. */
function leadHand(hero: Hero) {
  hero.root.updateMatrixWorld(true)
  const hands = (['leftHand', 'rightHand'] as const).map((b) => {
    const v = new THREE.Vector3()
    hero.vrm.humanoid.getRawBoneNode(b)?.getWorldPosition(v)
    return v
  })
  return hands[0].x > hands[1].x ? hands[0] : hands[1]
}

/** Where the backdrop's centre and (Rumble) impact point land, in pixels. */
const anchors = { cx: W / 2, cy: H / 2, fx: W / 2, fy: H / 2 }
function toScreen(v: THREE.Vector3) {
  camera.updateMatrixWorld()
  const p = v.clone().project(camera)
  return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]
}

async function buildRumble(hero: Hero) {
  const h = hero.height
  // Mid-air, side-on, the cross punch at full extension, leaning into it.
  await pose(hero, params.get('clip') ?? 'Punch_Cross.glb', Number(params.get('t') ?? 0.5))
  hero.root.rotation.order = 'YXZ'
  hero.root.rotation.set(0.12, Number(params.get('yaw') ?? 1.2), 0)
  hero.root.position.set(-0.45, 0.4, 0)
  const fist = leadHand(hero)

  // The robot she is bopping: knocked back off its feet, right at the fist.
  const robot = (col: number, s: number) => {
    const th = makeThing('robot' as Kind, () => col)
    th.obj.scale.setScalar(s)
    th.blob.visible = false
    return th.obj
  }
  const target = robot(0.25, 0.65) // grape: the colour that pops most on tangerine
  target.position.set(fist.x + 0.5, fist.y - 0.45, fist.z + 0.1)
  target.rotation.set(0.1, -0.55, -0.55)
  near.add(target)
  // More wind-up robots marching in, far and blurred.
  const marching: [number, number, number, number, number][] = [[1.9, 0, -2.6, 0.7, 0.45], [-1.6, 0, -3.0, 0.65, 0.05], [0.5, 0, -3.6, 0.6, 0.7]]
  for (const [x, y, z, s, c] of marching) {
    const r = robot(c, s)
    r.position.set(x, y, z)
    r.rotation.set(0, -0.5 + x * 0.1, 0)
    far.add(r)
  }

  // The arena: a ring mat with three ropes along the back, blurred.
  const mat = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 5), [
    new THREE.MeshStandardMaterial({ color: PAL.rumbleDeep }), new THREE.MeshStandardMaterial({ color: PAL.rumbleDeep }),
    new THREE.MeshStandardMaterial({
      roughness: 0.7,
      map: canvasTex(256, (g) => {
        g.fillStyle = css(PAL.cream); g.fillRect(0, 0, 256, 256)
        g.strokeStyle = css(PAL.rumble); g.lineWidth = 14; g.strokeRect(10, 10, 236, 236)
        g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 54, 0, Math.PI * 2); g.stroke()
      }),
    }),
    new THREE.MeshStandardMaterial({ color: PAL.rumbleDeep }),
    new THREE.MeshStandardMaterial({ color: PAL.red }), new THREE.MeshStandardMaterial({ color: PAL.red }),
  ])
  mat.position.set(0, -0.1, -1.2)
  far.add(mat)
  const post = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 12)
  for (const x of [-2.9, 2.9]) {
    const p = new THREE.Mesh(post, new THREE.MeshStandardMaterial({ color: PAL.ink }))
    p.position.set(x, 0.75, -3.6)
    far.add(p)
  }
  ;[[0.5, PAL.red], [0.9, PAL.cream], [1.3, PAL.red]].forEach(([y, col]) => {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.8, 8), new THREE.MeshStandardMaterial({ color: col }))
    rope.rotation.z = Math.PI / 2
    rope.position.set(0, y, -3.6)
    far.add(rope)
  })

  // Sparks off the punch.
  confetti(near, 46, [PAL.sun, 0xffffff, PAL.cream, PAL.red, PAL.sun], new THREE.Vector3(2.4, 2.0, 1.2), new THREE.Vector3(fist.x + 0.3, fist.y, 0.3), 0.9)

  camera.position.set(0.3, 0.5, 5.2)
  camera.lookAt(0.15, h * 0.55 + 0.35, 0)
  camera.updateProjectionMatrix()
  ;[anchors.fx, anchors.fy] = toScreen(fist.clone().add(new THREE.Vector3(0.12, 0, 0)))
  ;[anchors.cx, anchors.cy] = toScreen(new THREE.Vector3(0, h * 0.6 + 0.4, 0))
}

async function buildDance(hero: Hero) {
  const h = hero.height
  // The disco point: one arm to the sky, a knee up, centre floor.
  await pose(hero, params.get('clip') ?? 'Victory.glb', Number(params.get('t') ?? 0.8))
  hero.root.rotation.set(0, Number(params.get('yaw') ?? -0.25), 0)
  // The clip hops; plant the standing foot on the floor.
  hero.root.updateMatrixWorld(true)
  const foot = Math.min(...(['leftToes', 'rightToes', 'leftFoot', 'rightFoot'] as const).map((b) => {
    const node = hero.vrm.humanoid.getRawBoneNode(b)
    return node ? node.getWorldPosition(new THREE.Vector3()).y : Infinity
  }))
  if (Number.isFinite(foot)) hero.root.position.y -= foot - 0.06

  // The LED floor: a grid of lit tiles, the one under the dancer white-hot.
  const tile = 0.6, gap = 0.05
  const geo = new THREE.PlaneGeometry(tile - gap, tile - gap)
  geo.rotateX(-Math.PI / 2)
  const cols = [PAL.dance, PAL.pink, PAL.grape, PAL.plate6, 0x3a1260, PAL.dance, 0x5a1a8a]
  for (let ix = -5; ix <= 5; ix++) {
    for (let iz = -7; iz <= 2; iz++) {
      const centre = ix === 0 && iz === 0
      const col = centre ? 0xffffff : cols[(ix * 3 + iz * 5 + 70) % cols.length]
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }))
      m.position.set(ix * tile, 0, iz * tile)
      near.add(m)
    }
  }
  const under = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x12061f }))
  under.rotation.x = -Math.PI / 2
  under.position.set(0, -0.01, -1.5)
  near.add(under)
  // The follow spot's pool on the floor.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd6ef, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.01
  near.add(pool)

  // A disco ball hanging over the floor.
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 2),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ff, emissive: 0x3a2a5a, metalness: 0, roughness: 0.3, flatShading: true }),
  )
  ball.position.set(-0.8, h + 0.4, -0.6)
  near.add(ball)
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 3, 4), new THREE.MeshBasicMaterial({ color: 0x8a83a3 }))
  string.position.set(-0.8, h + 0.4 + 1.6, -0.6)
  near.add(string)

  // Spotlight cones from the rig, additive, in the blurred layer.
  for (const [x, rz, col] of [[-1.9, -0.4, PAL.pink], [1.9, 0.4, PAL.dance]] as const) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.1, 5, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    cone.position.set(x, 2.3, -0.8)
    cone.rotation.z = rz
    far.add(cone)
  }
  // Music notes floating up, in the club's pinks. The top-end corner stays
  // clear: the app's camera badge sits there.
  const notes: [number, number, number, number, string][] = [
    [0.8, h * 0.78, 0.3, 0.4, '#ff5fa2'], [-0.78, h * 0.42, 0.4, 0.34, '#ffd6e7'],
    [0.8, h * 0.3, 0.7, 0.3, '#d6247f'],
  ]
  for (const [x, y, z, s, fill] of notes) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex(fill), rotation: (x > 0 ? -0.3 : 0.3) }))
    sp.scale.setScalar(s); sp.position.set(x, y, z)
    ;(z < 0 ? far : near).add(sp)
  }
  confetti(near, 34, [PAL.pink, 0xffffff, PAL.plate6, PAL.dance], new THREE.Vector3(3.6, 2.6, 1.4), new THREE.Vector3(0, h * 0.9 + 0.6, 0.2))

  camera.position.set(0.5, 0.95, 4.4)
  camera.lookAt(0.05, h * 0.55, 0)
  camera.updateProjectionMatrix()
  ;[anchors.cx, anchors.cy] = toScreen(new THREE.Vector3(0, h * 0.7, 0))
}

async function build() {
  const r = await fetch(VRM)
  const hero = await parseHero(await r.arrayBuffer())
  near.add(hero.root)
  await (KIND === 'rumble' ? buildRumble(hero) : buildDance(hero))
}

function draw(): string {
  const g = out.getContext('2d')!
  if (KIND === 'rumble') paintRumble(g, anchors.cx, anchors.cy, anchors.fx, anchors.fy)
  else paintDance(g, anchors.cx, anchors.cy)
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
