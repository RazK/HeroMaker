import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PAL, makeBlob } from './world'

/**
 * The toys in the room. Each one is a single merged, vertex-coloured mesh plus
 * a painted blob shadow: two draw calls a toy, so a screen full of robots
 * costs less than the hero's outline does.
 */

export type Kind = 'robot' | 'balloon' | 'gold' | 'crate' | 'ball' | 'rival'

export interface Thing {
  kind: Kind
  obj: THREE.Group
  body: THREE.Object3D
  blob: THREE.Mesh
  pos: THREE.Vector3
  vel: THREE.Vector3
  radius: number
  hp: number
  /** Seconds alive. */
  age: number
  /** Animation clock, offset per toy so a crowd does not march in step. */
  phase: number
  /** Squash from the last hit, 1 → 0. */
  squash: number
  /** Leaving: popping, being stolen, rolling off. */
  dying: number
  dead: boolean
  /** A robot that has reached the chest and is diving in. */
  stealing?: boolean
  /** A rolling ball: the side it came from, and whether it has been jumped. */
  dir?: number
  jumped?: boolean
  /** Balloon float height. */
  float?: number
  extra?: THREE.Object3D
  /** A rival hero: who it is, what it is doing, and for how long. */
  rival?: import('./rivals').Rival
  rstate?: 'walk' | 'knock' | 'dizzy' | 'wave' | 'leave'
  rt?: number
  /** Bopped already: no longer a target, on its way out. */
  bopped?: boolean
}

const lambert = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 })

function colored(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const c = new THREE.Color(hex)
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  g.deleteAttribute('uv')
  return g
}

function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz)
  geo.translate(x, y, z)
  return geo
}

const ROBOT_COLOURS = [PAL.red, PAL.grape, 0x2fa8e0, PAL.green, 0xff8a3d]
const robotGeos = new Map<number, THREE.BufferGeometry>()

/** A wind-up tin robot, ~0.9 m tall: friendly eyes, an antenna, a key in its back. */
function robotGeometry(col: number) {
  let g = robotGeos.get(col)
  if (g) return g
  const metal = 0xd9dce6
  const parts = [
    colored(at(new THREE.BoxGeometry(0.52, 0.42, 0.4), 0, 0.42, 0), col),           // body
    colored(at(new THREE.BoxGeometry(0.42, 0.34, 0.36), 0, 0.8, 0), metal),         // head
    colored(at(new THREE.BoxGeometry(0.36, 0.12, 0.02), 0, 0.82, 0.185), PAL.ink),  // visor
    colored(at(new THREE.SphereGeometry(0.045, 8, 6), -0.08, 0.83, 0.2), 0xffffff), // eyes
    colored(at(new THREE.SphereGeometry(0.045, 8, 6), 0.08, 0.83, 0.2), 0xffffff),
    colored(at(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), 0, 1.04, 0), PAL.ink),
    colored(at(new THREE.SphereGeometry(0.05, 10, 8), 0, 1.13, 0), PAL.sun),        // antenna bulb
    colored(at(new THREE.BoxGeometry(0.14, 0.22, 0.16), -0.14, 0.11, 0), PAL.ink),  // feet
    colored(at(new THREE.BoxGeometry(0.14, 0.22, 0.16), 0.14, 0.11, 0), PAL.ink),
    colored(at(new THREE.BoxGeometry(0.1, 0.26, 0.12), -0.33, 0.46, 0, 0, 0, 0.3), metal), // arms
    colored(at(new THREE.BoxGeometry(0.1, 0.26, 0.12), 0.33, 0.46, 0, 0, 0, -0.3), metal),
    colored(at(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), 0, 0.45, -0.26, Math.PI / 2), PAL.sunDeep), // key shaft
    colored(at(new THREE.TorusGeometry(0.07, 0.025, 6, 12), -0.07, 0.45, -0.34, 0, Math.PI / 2), PAL.sun),  // key bows
    colored(at(new THREE.TorusGeometry(0.07, 0.025, 6, 12), 0.07, 0.45, -0.34, 0, Math.PI / 2), PAL.sun),
    colored(at(new THREE.BoxGeometry(0.2, 0.08, 0.02), 0, 0.47, 0.205), 0xffffff),  // a chest badge
  ]
  g = mergeGeometries(parts)!
  g.computeVertexNormals()
  robotGeos.set(col, g)
  return g
}

const BALLOON_COLOURS = [PAL.red, PAL.grape, 0x2fa8e0, PAL.green]
const balloonGeos = new Map<number, THREE.BufferGeometry>()
function balloonGeometry(col: number) {
  let g = balloonGeos.get(col)
  if (g) return g
  const egg = new THREE.SphereGeometry(0.3, 18, 14)
  egg.scale(1, 1.18, 1)
  g = mergeGeometries([
    colored(at(egg, 0, 0, 0), col),
    colored(at(new THREE.ConeGeometry(0.06, 0.08, 8), 0, -0.38, 0, Math.PI), col),
    colored(at(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), 0, -0.76, 0), PAL.ink),
    colored(at(new THREE.SphereGeometry(0.06, 8, 6), -0.1, 0.12, 0.25), 0xffffff), // shine
  ])!
  g.computeVertexNormals()
  balloonGeos.set(col, g)
  return g
}

let crateMat: THREE.Material | null = null
const crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
function crateMaterial() {
  if (crateMat) return crateMat
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffc233'; g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fff6e9'; g.beginPath(); g.roundRect(10, 10, 108, 108, 16); g.fill()
  // A star, the Toy Box star glyph scaled up.
  g.save(); g.translate(64, 66); g.scale(4.2, 4.2); g.translate(-12, -12)
  g.fillStyle = '#ffc233'; g.strokeStyle = '#d99a00'; g.lineWidth = 1.2; g.lineJoin = 'round'
  const p = new Path2D('M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z')
  g.fill(p); g.stroke(p); g.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  crateMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })
  return crateMat
}

let ballMat: THREE.Material | null = null
const ballGeo = new THREE.SphereGeometry(0.4, 20, 14)
function ballMaterial() {
  if (ballMat) return ballMat
  const c = document.createElement('canvas')
  c.width = 256; c.height = 128
  const g = c.getContext('2d')!
  const cols = ['#e5484d', '#fff6e9', '#2fa8e0', '#fff6e9', '#ffc233', '#fff6e9']
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 128) })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  ballMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.35 })
  return ballMat
}

let goldMat: THREE.Material | null = null

export function makeThing(kind: Kind, rnd: () => number): Thing {
  const obj = new THREE.Group()
  let body: THREE.Object3D
  let radius = 0.4
  let hp = 1
  let blobSize = 0.9
  if (kind === 'robot') {
    const col = ROBOT_COLOURS[Math.floor(rnd() * ROBOT_COLOURS.length)]
    body = new THREE.Mesh(robotGeometry(col), lambert)
    radius = 0.36
  } else if (kind === 'balloon' || kind === 'gold') {
    const col = kind === 'gold' ? PAL.sun : BALLOON_COLOURS[Math.floor(rnd() * BALLOON_COLOURS.length)]
    if (kind === 'gold') goldMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.5, emissive: 0x6b4a00 })
    body = new THREE.Mesh(balloonGeometry(col), kind === 'gold' ? goldMat! : lambert)
    radius = 0.34
    blobSize = 0.55
  } else if (kind === 'crate') {
    body = new THREE.Mesh(crateGeo, crateMaterial())
    body.position.y = 0.45
    radius = 0.55
    hp = 3
    blobSize = 1.3
  } else {
    body = new THREE.Mesh(ballGeo, ballMaterial())
    radius = 0.4
    blobSize = 0.9
  }
  const pivot = new THREE.Group()
  pivot.add(body)
  obj.add(pivot)
  const blob = makeBlob(blobSize)
  obj.add(blob)
  return {
    kind, obj, body: pivot, blob, radius, hp,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    age: 0, phase: rnd() * 10, squash: 0, dying: 0, dead: false,
  }
}

// ------------------------------------------------------------------ effects

const MAX_P = 360
/**
 * Confetti and sparks, every one of them in a single Points draw call. Each
 * particle is position + velocity + life on the CPU; nothing is allocated
 * after boot.
 */
export class Particles {
  readonly points: THREE.Points
  private pos = new Float32Array(MAX_P * 3)
  private col = new Float32Array(MAX_P * 3)
  private vel = new Float32Array(MAX_P * 3)
  private life = new Float32Array(MAX_P)
  private next = 0

  constructor() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const x = c.getContext('2d')!
    x.fillStyle = '#fff'
    x.beginPath(); x.roundRect(4, 4, 24, 24, 7); x.fill()
    const tex = new THREE.CanvasTexture(c)
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.13, vertexColors: true, map: tex, transparent: true, alphaTest: 0.4, sizeAttenuation: true,
    }))
    this.points.frustumCulled = false
    for (let i = 0; i < MAX_P; i++) this.pos[i * 3 + 1] = -100
  }

  burst(at: THREE.Vector3, n: number, colours: number[], speed = 4, up = 3) {
    const c = new THREE.Color()
    for (let k = 0; k < n; k++) {
      const i = this.next
      this.next = (this.next + 1) % MAX_P
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.35 + Math.random() * 0.65)
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z
      this.vel[i * 3] = Math.cos(a) * s
      this.vel[i * 3 + 1] = up * (0.5 + Math.random())
      this.vel[i * 3 + 2] = Math.sin(a) * s
      this.life[i] = 0.7 + Math.random() * 0.6
      c.set(colours[k % colours.length])
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b
    }
    ;(this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
  }

  update(dt: number) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      const j = i * 3
      this.vel[j + 1] -= 9 * dt
      this.vel[j] *= 1 - 1.5 * dt
      this.vel[j + 2] *= 1 - 1.5 * dt
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      if (this.pos[j + 1] < 0.03) { this.pos[j + 1] = 0.03; this.vel[j + 1] *= -0.35; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6 }
      if (this.life[i] <= 0) this.pos[j + 1] = -100
    }
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}

/** The ring a ground pound sends across the floor. */
export class Shockwave {
  readonly mesh: THREE.Mesh
  private t = 1
  private max = 2
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.sun, transparent: true, depthWrite: false }),
    )
    this.mesh.position.y = 0.02
    this.mesh.visible = false
  }
  fire(at: THREE.Vector3, radius: number) {
    this.mesh.position.set(at.x, 0.02, at.z)
    this.max = radius
    this.t = 0
    this.mesh.visible = true
  }
  update(dt: number) {
    if (this.t >= 1) return
    this.t = Math.min(1, this.t + dt / 0.35)
    const k = 1 - (1 - this.t) ** 3
    this.mesh.scale.setScalar(0.2 + k * this.max)
    ;(this.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - this.t
    if (this.t >= 1) this.mesh.visible = false
  }
}

/** A blinking arrow on the floor where a ball is about to roll in. */
export function makeWarning() {
  const s = new THREE.Shape()
  s.moveTo(0, 0.35); s.lineTo(0.42, 0); s.lineTo(0, -0.35); s.lineTo(0, -0.14); s.lineTo(-0.4, -0.14); s.lineTo(-0.4, 0.14); s.lineTo(0, 0.14)
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PAL.red, transparent: true, depthWrite: false }),
  )
  m.position.y = 0.015
  return m
}
