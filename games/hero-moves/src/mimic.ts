import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import { parseHero, type Hero } from './avatar/loader'
import { applyLook } from './look'

/**
 * A hero copies a person in a video, frame for frame: the landing page's
 * "It comes alive!" clip (docs/content/README.md).
 *
 * Input is what tools/mimic/extract_pose.py writes: MediaPipe Pose's 3D
 * "world" landmarks per video frame (metres, origin between the hips, x =
 * image right, y = down, z = away from the camera) plus the 2D ones.
 *
 * Every bone is aimed, not copied: each limb segment of the hero is turned so
 * it points the way the same segment of the person points. Directions carry no
 * length, so this is as proportion-blind as the mocap retargeter
 * (anim/retarget.ts): a hero who is a third head still waves with the arm it
 * has. Torso, hips and head take a full orientation from two vectors each
 * (up and side), so they turn and lean as well as tilt.
 *
 * The person faces the camera and so does the hero, so the person's left arm
 * drives the hero's left arm and both appear on the same side of the screen:
 * side by side, they read as doing the same thing.
 *
 * Feet are pinned to the floor after posing (the lower foot touches y = 0),
 * which turns bent knees into the hero dropping, not floating.
 *
 * Offline only: the page renders one frame per call so a recorder can step it
 * (tools/mimic/render.mjs). window.__mimic.load(vrm, pose, opts) then
 * window.__mimic.frame(i) -> PNG data URL.
 */

type V = THREE.Vector3
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

// MediaPipe Pose landmark indices.
const L = {
  nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
} as const

interface PoseFile { fps: number; frames: ({ world: number[][]; image: number[][] } | null)[] }

/** World landmarks in three's frame (y up, +z toward the camera), smoothed over time. */
function prepare(pose: PoseFile, sigma: number): { world: V[][]; image: number[][][] } {
  const n = pose.frames.length
  // Fill untracked frames from the nearest tracked one.
  const filled = pose.frames.slice()
  let last = filled.find((f) => f) ?? null
  for (let i = 0; i < n; i++) { if (filled[i]) last = filled[i]; else filled[i] = last }
  const raw = filled.map((f) => f!.world.map(([x, y, z]) => v(x, -y, -z)))
  const image = filled.map((f) => f!.image)
  if (sigma <= 0) return { world: raw, image }
  const r = Math.ceil(sigma * 2.5)
  const w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)))
  const world = raw.map((_, i) => raw[0].map((__, j) => {
    const acc = v(); let ws = 0
    for (let k = -r; k <= r; k++) {
      const t = Math.min(n - 1, Math.max(0, i + k))
      acc.addScaledVector(raw[t][j], w[k + r]); ws += w[k + r]
    }
    return acc.divideScalar(ws)
  }))
  return { world, image }
}

/** Rotation taking the orthonormal frame (side, up) at rest to (side, up) now. */
function frameRotation(side: V, up: V): THREE.Quaternion {
  const y = up.clone().normalize()
  const x = side.clone().addScaledVector(y, -side.dot(y)).normalize()
  const z = x.clone().cross(y)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

class Mimic {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60)
  hero!: Hero
  world: V[][] = []
  image: number[][][] = []
  /** Rest-pose world rotation of each bone and the rest direction to its child. */
  rest = new Map<VRMHumanBoneName, { q: THREE.Quaternion; dir: V }>()
  restHeadFwd = v(0, 0, 1)
  shadow: THREE.Mesh
  heroHeight = 1
  /** Hip sway across the floor, in hero heights per person height. */
  travel = 0.6
  hip0 = { x: 0.5 }
  personHeight = 1

  constructor(public w: number, public h: number, bg: string | null) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: bg === null, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h)
    if (bg) this.renderer.setClearColor(new THREE.Color(bg), 1)
    else this.renderer.setClearColor(0x000000, 0)
    applyLook({ THREE, RoomEnvironment }, this.renderer, this.scene)
    document.body.appendChild(this.renderer.domElement)
    this.camera.aspect = w / h
    const c = document.createElement('canvas'); c.width = c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(35,25,66,0.30)'); grad.addColorStop(0.55, 'rgba(35,25,66,0.10)'); grad.addColorStop(1, 'rgba(35,25,66,0)')
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.002
    this.shadow.renderOrder = -2
    this.scene.add(this.shadow)
  }

  node(b: VRMHumanBoneName) { return this.hero.vrm.humanoid.getNormalizedBoneNode(b) }

  async load(vrmUrl: string, pose: PoseFile, opts: { sigma?: number; frameTop?: number; frameBottom?: number; travel?: number } = {}) {
    this.hero = await parseHero(await (await fetch(vrmUrl)).arrayBuffer())
    this.scene.add(this.hero.root)
    const { world, image } = prepare(pose, opts.sigma ?? 1.6)
    this.world = world; this.image = image
    if (opts.travel !== undefined) this.travel = opts.travel
    this.heroHeight = this.hero.height

    // Rest: every normalized bone at identity is the T-pose.
    const hum = this.hero.vrm.humanoid
    hum.resetNormalizedPose()
    this.hero.vrm.update(0)
    this.hero.root.updateMatrixWorld(true)
    const pos = (b: VRMHumanBoneName) => this.node(b)?.getWorldPosition(v())
    const child: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {
      leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand', rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand',
      leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot',
      leftFoot: 'leftToes', rightFoot: 'rightToes',
    }
    const all: VRMHumanBoneName[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
    for (const b of all) {
      const n = this.node(b); if (!n) continue
      const q = n.getWorldQuaternion(new THREE.Quaternion())
      let dir = v(0, 1, 0)
      const c = child[b]
      if (c && this.node(c)) dir = pos(c)!.sub(pos(b)!).normalize()
      else if (b === 'leftHand') dir = v(1, 0, 0)
      else if (b === 'rightHand') dir = v(-1, 0, 0)
      else if (b === 'leftFoot' || b === 'rightFoot') dir = v(0, -0.3, 1).normalize()
      this.rest.set(b, { q, dir })
    }

    // The person's height in the video, from the first frames: hips to the
    // lower ankle in image units, so floor travel can be scaled to the hero.
    const f0 = image[0]
    this.hip0.x = (f0[L.lHip][0] + f0[L.rHip][0]) / 2
    const hipY = (f0[L.lHip][1] + f0[L.rHip][1]) / 2
    this.personHeight = Math.max(0.1, (Math.max(f0[L.lAnkle][1], f0[L.rAnkle][1]) - hipY) * 2.1)

    // Frame the hero like the person: whole body, a little air above and below.
    const top = opts.frameTop ?? 0.12, bottom = opts.frameBottom ?? 0.1
    const span = this.heroHeight / (1 - top - bottom)
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const dist = span / 2 / Math.tan(fov / 2)
    const midY = this.heroHeight / 2 + (top - bottom) * span / 2
    this.camera.position.set(0, midY, dist)
    this.camera.lookAt(0, midY, 0)
    this.camera.updateProjectionMatrix()
    this.shadow.scale.setScalar(Math.max(0.5, Math.max(this.hero.width, this.heroHeight * 0.5) * 1.1))
    return { frames: world.length, fps: pose.fps, height: this.heroHeight }
  }

  /** Set bone `b` so that, in world space, it is `delta` applied to its rest orientation. */
  setWorld(b: VRMHumanBoneName, delta: THREE.Quaternion) {
    const n = this.node(b); const r = this.rest.get(b)
    if (!n || !r) return
    const wanted = delta.clone().multiply(r.q)
    const parent = n.parent!.getWorldQuaternion(new THREE.Quaternion())
    n.quaternion.copy(parent.invert().multiply(wanted))
    n.updateMatrixWorld(true)
  }

  /** Aim bone `b` so its rest direction points along `dir` (world). */
  aim(b: VRMHumanBoneName, dir: V, twist?: THREE.Quaternion) {
    const r = this.rest.get(b); if (!r) return
    const restDirNow = r.dir.clone()
    // Carry the parent's twist so the limb's roll follows the body.
    const base = twist ? restDirNow.applyQuaternion(twist) : restDirNow
    const q = new THREE.Quaternion().setFromUnitVectors(base.normalize(), dir.clone().normalize())
    this.setWorld(b, twist ? q.multiply(twist) : q)
  }

  pose(i: number) {
    const P = this.world[Math.min(i, this.world.length - 1)]
    const hum = this.hero.vrm.humanoid
    hum.resetNormalizedPose()
    this.hero.root.position.set(0, 0, 0)
    this.hero.root.updateMatrixWorld(true)

    const mid = (a: number, b: number) => P[a].clone().add(P[b]).multiplyScalar(0.5)
    const hipC = mid(L.lHip, L.rHip), shC = mid(L.lSh, L.rSh)
    const up = shC.clone().sub(hipC)
    const hipsQ = frameRotation(P[L.lHip].clone().sub(P[L.rHip]), up)
    const chestQ = frameRotation(P[L.lSh].clone().sub(P[L.rSh]), up)
    this.setWorld('hips', hipsQ)
    this.setWorld('spine', hipsQ.clone().slerp(chestQ, 0.5))
    this.setWorld('chest', chestQ)
    if (this.node('upperChest')) this.setWorld('upperChest', chestQ)

    // Head: side from ear to ear, forward from between the ears to the nose.
    const earC = mid(L.lEar, L.rEar)
    const side = P[L.lEar].clone().sub(P[L.rEar])
    const fwd = P[L.nose].clone().sub(earC)
    const headUp = side.clone().cross(fwd).normalize().negate()
    // side x fwd points down for a face looking +z with left = +x; negate for up.
    const headQ = frameRotation(side, headUp.dot(up) < 0 ? headUp.negate() : headUp)
    // The ear-nose line sits ~20 degrees below the face's true forward.
    const headLift = new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0).applyQuaternion(headQ), 0.25)
    const headW = headLift.multiply(headQ)
    this.setWorld('neck', chestQ.clone().slerp(headW, 0.4))
    this.setWorld('head', headW)

    const seg = (a: number, b: number) => P[b].clone().sub(P[a])
    const handDir = (wr: number, ix: number, pk: number) => mid(ix, pk).sub(P[wr])
    this.aim('leftUpperArm', seg(L.lSh, L.lEl), chestQ)
    this.aim('leftLowerArm', seg(L.lEl, L.lWr), chestQ)
    this.aim('leftHand', handDir(L.lWr, L.lIndex, L.lPinky), chestQ)
    this.aim('rightUpperArm', seg(L.rSh, L.rEl), chestQ)
    this.aim('rightLowerArm', seg(L.rEl, L.rWr), chestQ)
    this.aim('rightHand', handDir(L.rWr, L.rIndex, L.rPinky), chestQ)
    this.aim('leftUpperLeg', seg(L.lHip, L.lKnee), hipsQ)
    this.aim('leftLowerLeg', seg(L.lKnee, L.lAnkle), hipsQ)
    this.aim('leftFoot', seg(L.lHeel, L.lToe), hipsQ)
    this.aim('rightUpperLeg', seg(L.rHip, L.rKnee), hipsQ)
    this.aim('rightLowerLeg', seg(L.rKnee, L.rAnkle), hipsQ)
    this.aim('rightFoot', seg(L.rHeel, L.rToe), hipsQ)

    this.hero.vrm.update(0)
    this.hero.root.updateMatrixWorld(true)

    // Pin the lower foot to the floor; slide across it as the person does.
    const fy = (b: VRMHumanBoneName) => this.node(b)?.getWorldPosition(v()).y ?? 0
    const footMin = Math.min(fy('leftToes') || fy('leftFoot'), fy('rightToes') || fy('rightFoot'), fy('leftFoot'), fy('rightFoot'))
    // The loader grounded the rest mesh at y = 0; keep the lower foot joint at its rest height.
    const lift = this.restFootY - footMin
    const im = this.image[Math.min(i, this.image.length - 1)]
    const hipX = (im[L.lHip][0] + im[L.rHip][0]) / 2
    const dx = (hipX - this.hip0.x) / this.personHeight * this.heroHeight * this.travel
    this.hero.root.position.set(dx, lift, 0)
    this.hero.root.updateMatrixWorld(true)
    this.shadow.position.x = dx
    const air = Math.max(0, lift)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.4, 1 - air / (this.heroHeight * 0.3))
  }

  restFootY = 0

  render(): string {
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
  }
}

declare global { interface Window { __mimic: unknown } }

const q = new URLSearchParams(location.search)
const W = Number(q.get('w') ?? 720), H = Number(q.get('h') ?? 1280)
const bg = q.has('alpha') ? null : (q.get('bg') ?? '#fff6e9')
document.body.style.margin = '0'
document.body.style.background = bg ?? 'transparent'
const m = new Mimic(W, H, bg)

window.__mimic = {
  async load(vrmUrl: string, poseUrl: string, opts = {}) {
    const pose = await (await fetch(poseUrl)).json() as PoseFile
    const info = await m.load(vrmUrl, pose, opts)
    // Rest foot height: joints above the grounded mesh's lowest point.
    const fy = (b: VRMHumanBoneName) => m.node(b)?.getWorldPosition(v()).y ?? Infinity
    m.restFootY = Math.min(fy('leftToes'), fy('rightToes'), fy('leftFoot'), fy('rightFoot'))
    return info
  },
  frame(i: number) { m.pose(i); return m.render() },
}
