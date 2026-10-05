import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { parseHero, type Hero } from './avatar/loader'
import { Animator } from './avatar/animator'
import { Performer, CLIPS } from './anim/performer'
import { preloadClip } from './anim/clips'
import { animUrl } from './anim/files'
import { damp } from './core/math'

/**
 * The hero page of the HeroMaker app, as a module the app imports at run time.
 *
 * Built by this game's build into /play/herostage.js, beside the Dance party
 * page, so the app's hero page and the game share one copy of three.js, one
 * copy of every clip and one VRM URL — all HTTP-cached between them. The app
 * cannot bundle this source itself: Railway builds the frontend image with
 * frontend/ as its whole Docker context, and the game is not in it. What it
 * does get is this build's output, copied into frontend/public/play/ by
 * devops/scripts/bundle-game.sh before every image build.
 *
 * It is the same Performer, retargeting and loader the games use, unforked.
 *
 * Everything is loaded once per page: a VRM is downloaded and parsed once, a
 * clip once for every hero, and leaving the hero page and coming back reuses
 * all of it, including the WebGL context.
 */

/** Move ids, in the order the app lays out its buttons. */
export const MOVES: string[] = CLIPS.map((c) => c.id)
/** What the hero does between moves. */
const IDLE = 'dance'
/**
 * The room a pose needs, in the hero's own space: lowest and highest point,
 * and the widest either side of centre.
 */
interface Room { lo: number; hi: number; half: number }
const union = (a: Room, b: Room): Room => ({ lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), half: Math.max(a.half, b.half) })

// ------------------------------------------------------------- downloads

type Listener = (fraction: number) => void
interface Download { promise: Promise<ArrayBuffer>; progress: number; listeners: Set<Listener> }
const downloads = new Map<string, Download>()

function download(url: string): Download {
  let d = downloads.get(url)
  if (d) return d
  const listeners = new Set<Listener>()
  const entry: Download = { progress: 0, listeners, promise: Promise.resolve(new ArrayBuffer(0)) }
  const report = (p: number) => { entry.progress = p; listeners.forEach((l) => l(p)) }
  entry.promise = (async () => {
    const r = await fetch(url)
    if (!r.ok || !r.body) throw new Error(`${url}: ${r.status}`)
    const total = Number(r.headers.get('content-length')) || 0
    const reader = r.body.getReader()
    const parts: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      got += value.length
      if (total) report(Math.min(0.99, got / total))
    }
    const bytes = new Uint8Array(got)
    let at = 0
    for (const p of parts) { bytes.set(p, at); at += p.length }
    report(1)
    return bytes.buffer
  })()
  // A failed download is forgotten, so opening the hero again retries it.
  entry.promise.catch(() => downloads.delete(url))
  downloads.set(url, entry)
  d = entry
  return d
}

/**
 * Start downloading `url` (once per page) and report its progress, 0 to 1.
 * Returns an unsubscribe. Safe to call as often as a screen re-renders.
 */
export function prefetch(url: string, onProgress?: Listener): () => void {
  const d = download(url)
  if (!onProgress) return () => {}
  onProgress(d.progress)
  d.listeners.add(onProgress)
  return () => { d.listeners.delete(onProgress) }
}

// ------------------------------------------------------------- parsed, cached

interface Loaded {
  hero: Hero
  performer: Performer
  /** Breathing idle for the moments no clip owns the rig (before clips land). */
  animator: Animator
  /** Resolves once the idle dance is bound; the hero is never shown in a T-pose. */
  idle: Promise<boolean>
  /** Resolves once every move is bound. */
  moves: Promise<number>
  /** What the idle dance needs, and what each move needs; filled once the moves are bound. */
  room: { idle: Room; moves: Map<string, Room> }
}

/** The few most recent heroes stay parsed. Reopening one costs nothing. */
const KEEP = 6
const heroes = new Map<string, Promise<Loaded>>()
const sculpts = new Map<string, Promise<THREE.Object3D>>()

// Clips do not depend on the hero: start them with the module, not the VRM.
for (const c of CLIPS) void preloadClip(animUrl(c.url), c.kind)

function remember<T>(cache: Map<string, Promise<T>>, url: string, make: () => Promise<T>, drop: (v: T) => void) {
  const hit = cache.get(url)
  if (hit) {
    cache.delete(url)
    cache.set(url, hit) // most recent last
    return hit
  }
  const p = make()
  p.catch(() => cache.delete(url))
  cache.set(url, p)
  while (cache.size > KEEP) {
    const [oldest, old] = cache.entries().next().value as [string, Promise<T>]
    cache.delete(oldest)
    old.then(drop, () => {})
  }
  return p
}

function loadHero(url: string): Promise<Loaded> {
  return remember(heroes, url, async () => {
    const hero = await parseHero(await download(url).promise)
    const performer = new Performer(hero)
    const animator = new Animator(hero.rig)
    const idleSpec = CLIPS.find((c) => c.id === IDLE)!
    const idle = performer.load(idleSpec, animUrl)
    const room = { idle: { lo: 0, hi: hero.height, half: hero.width * 0.4 }, moves: new Map<string, Room>() }
    const loaded: Loaded = { hero, performer, animator, idle, moves: Promise.resolve(0), room }
    const measure = roomMeter(hero)
    loaded.moves = idle.then(() => Promise.all(CLIPS.filter((c) => c.id !== IDLE).map((c) => performer.load(c, animUrl))))
      .then((ok) => {
        for (const c of CLIPS) {
          const clip = performer.clip(c.id)
          if (clip) room.moves.set(c.id, measure(clip))
        }
        const dance = room.moves.get(IDLE)
        if (dance) room.idle = union(dance, { lo: 0, hi: hero.height, half: 0 })
        return ok.filter(Boolean).length + 1
      })
    return loaded
  }, (l) => { if (l.hero.root.parent !== world) { l.performer.dispose(); l.hero.dispose() } })
}

/**
 * Measures the room a clip needs on this hero by sampling it: where the head,
 * hands, feet and hips go. Solved against the clip, not the rest pose, so the
 * camera is already back when a backflip leaves the ground — and it holds for
 * any hero, whatever its proportions: the head is a sphere as big as the
 * hero's own head, so one that is a third of its height still fits upside down.
 */
const MEASURED = ['head', 'hips', 'chest', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm',
  'leftFoot', 'rightFoot', 'leftLowerLeg', 'rightLowerLeg'] as const
function roomMeter(hero: Hero) {
  const { vrm, root } = hero
  const v = new THREE.Vector3()
  const h = hero.height
  const margin = h * 0.05
  // Bones are joints, not skin: a head, a hand or a foot reaches past its
  // bone by as much as it does at rest. Measured once here, on the T-pose.
  root.updateMatrixWorld(true)
  const at = (name: string) => {
    const node = vrm.humanoid.getRawBoneNode(name as 'head')
    return node ? root.worldToLocal(node.getWorldPosition(new THREE.Vector3())) : null
  }
  const reach = new Map<string, number>()
  const head = at('head')
  reach.set('head', Math.max(h * 0.08, h - (head?.y ?? h * 0.8)))
  for (const side of ['left', 'right']) {
    const hand = at(`${side}Hand`)
    if (hand) reach.set(`${side}Hand`, Math.max(margin, hero.width / 2 - Math.abs(hand.x)))
    const foot = at(`${side}Foot`)
    if (foot) reach.set(`${side}Foot`, Math.max(margin, foot.y))
  }
  // Coming toward the camera makes a hero bigger on screen; allow for it.
  const near = (z: number) => 1 + Math.max(0, z) / (2.5 * h)
  return (clip: THREE.AnimationClip): Room => {
    const mixer = new THREE.AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    const room: Room = { lo: 0, hi: 0, half: 0 }
    const steps = 30
    for (let i = 0; i <= steps; i++) {
      mixer.setTime((clip.duration * i) / steps)
      vrm.humanoid.update()
      root.updateMatrixWorld(true)
      for (const name of MEASURED) {
        const node = vrm.humanoid.getRawBoneNode(name)
        if (!node) continue
        root.worldToLocal(node.getWorldPosition(v))
        const k = near(v.z)
        const r = (reach.get(name) ?? margin) * k
        const y = h / 2 + (v.y - h / 2) * k
        room.lo = Math.min(room.lo, y - r)
        room.hi = Math.max(room.hi, y + r)
        room.half = Math.max(room.half, Math.abs(v.x) * k + r)
      }
    }
    mixer.stopAllAction()
    mixer.uncacheRoot(vrm.scene)
    // Whatever plays next owns the rig again from a neutral start.
    vrm.humanoid.resetNormalizedPose()
    return room
  }
}

const gltfLoader = new GLTFLoader()

/** The unrigged 3D sculpt, grounded, centred and scaled to a hero's height. */
function loadSculpt(url: string): Promise<THREE.Object3D> {
  return remember(sculpts, url, async () => {
    const buffer = await download(url).promise
    const gltf = await new Promise<{ scene: THREE.Group }>((ok, fail) => gltfLoader.parse(buffer, '', ok, fail))
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const scale = 1.7 / Math.max(size.y, 1e-3)
    model.scale.setScalar(scale)
    const centre = box.getCenter(new THREE.Vector3())
    model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale)
    model.traverse((o) => { o.frustumCulled = false })
    const turntable = new THREE.Group()
    turntable.add(model)
    turntable.userData.size = size.multiplyScalar(scale)
    return turntable
  }, (obj) => obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()) }
  }))
}

/** Download and parse a hero and its moves ahead of showing it. */
export function prepareHero(url: string): Promise<void> {
  return loadHero(url).then(() => {})
}
export function prepareSculpt(url: string): Promise<void> {
  return loadSculpt(url).then(() => {})
}

// ------------------------------------------------------------- the stage

let renderer: THREE.WebGLRenderer | null = null
const scene = new THREE.Scene()
const world = new THREE.Group()
scene.add(world)
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60)

scene.add(new THREE.HemisphereLight(0xffffff, 0xffe9c4, 0.85))
const key = new THREE.DirectionalLight(0xfff3e0, 2.1)
key.position.set(1.2, 3.5, 4)
scene.add(key)
const fill = new THREE.DirectionalLight(0xe9e3ff, 0.6)
fill.position.set(-3, 1.5, 2)
scene.add(fill)

/** A soft contact shadow, so the hero stands on the plate instead of floating over it. */
const shadow = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(35,25,66,0.28)')
  grad.addColorStop(1, 'rgba(35,25,66,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.002
  mesh.renderOrder = -2
  return mesh
})()
world.add(shadow)

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.25
  pmrem.dispose()
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  return renderer
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2

export interface StageEvents {
  /** The move now playing, or null when the hero is back to its idle dance. */
  onPlaying?: (id: string | null) => void
}

type Shown =
  | { kind: 'sculpt'; obj: THREE.Object3D; url: string }
  | { kind: 'hero'; loaded: Loaded; url: string }

/**
 * One stage on the page: the 3D canvas inside `container`, showing either the
 * turning sculpt or the live hero. Create it when the hero page mounts and
 * dispose it when the page goes; the WebGL context and every parsed file
 * outlive it, so the next one starts instantly.
 */
export class HeroStage {
  private shown: Shown | null = null
  private wanted: string | null = null
  private playing: string | null = null
  private pop = 1
  /** The room framed now, easing toward what is shown and playing. */
  private room: Room = { lo: 0, hi: 1.7, half: 0.5 }
  private roomTarget: Room = { lo: 0, hi: 1.7, half: 0.5 }
  private last = performance.now()
  private observer: ResizeObserver
  private size = { w: 1, h: 1 }
  /** Pixels at the top of the stage covered by something (the intro's stepper). */
  private insetTarget = 0
  private inset = 0

  constructor(private container: HTMLElement, private events: StageEvents = {}) {
    const r = getRenderer()
    container.appendChild(r.domElement)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    r.setAnimationLoop(() => this.frame())
  }

  /** Show the 3D sculpt turning on the spot. Resolves once it is on screen. */
  async showSculpt(url: string): Promise<void> {
    this.wanted = url
    const obj = await loadSculpt(url)
    if (this.wanted !== url) return
    this.put({ kind: 'sculpt', obj, url })
  }

  /** Show the live hero, idle-dancing. Resolves once it is on screen and moving. */
  async showHero(url: string): Promise<void> {
    this.wanted = url
    const loaded = await loadHero(url)
    // Wait for the idle dance (a few hundred ms at most, usually already here)
    // rather than show a T-pose first.
    await Promise.race([loaded.idle, new Promise((r) => setTimeout(r, 1500))])
    if (this.wanted !== url) return
    if (this.shown?.kind === 'hero' && this.shown.url === url) return
    // A move left playing when the page was last closed is over.
    if (loaded.performer.playing && loaded.performer.playing !== IDLE) loaded.performer.stop(0)
    this.put({ kind: 'hero', loaded, url })
  }

  /** Resolves once every move can be played on the hero being shown. */
  async movesReady(url: string): Promise<void> {
    await (await loadHero(url)).moves
  }

  /** Play a move now, cutting off whatever was playing. False if it cannot. */
  play(id: string): boolean {
    if (this.shown?.kind !== 'hero') return false
    const { performer } = this.shown.loaded
    if (!performer.has(id)) return false
    if (performer.playing === id) performer.stop(0.1)
    performer.play(id)
    this.setPlaying(id)
    return true
  }

  /** Keep the top `px` of the stage clear, easing there. */
  setInsetTop(px: number) {
    this.insetTarget = Math.max(0, px)
  }

  clear() {
    this.wanted = null
    this.put(null)
  }

  dispose() {
    this.wanted = null
    this.put(null)
    this.observer.disconnect()
    renderer?.setAnimationLoop(null)
    renderer?.domElement.remove()
  }

  private put(next: Shown | null) {
    if (this.shown) {
      const old = this.shown.kind === 'hero' ? this.shown.loaded.hero.root : this.shown.obj
      world.remove(old)
    }
    this.shown = next
    this.setPlaying(null)
    if (!next) return
    const obj = next.kind === 'hero' ? next.loaded.hero.root : next.obj
    obj.rotation.y = 0
    world.add(obj)
    if (next.kind === 'hero') {
      this.roomTarget = next.loaded.room.idle
    } else {
      const size = next.obj.userData.size as THREE.Vector3
      this.roomTarget = { lo: 0, hi: size.y, half: Math.max(size.x, size.z) / 2 }
    }
    this.room = { ...this.roomTarget }
    const restHalf = next.kind === 'hero' ? next.loaded.hero.width * 0.4 : this.roomTarget.half
    shadow.scale.setScalar(Math.max(0.7, restHalf * 1.8))
    this.pop = reducedMotion() ? 1 : 0
    this.resize()
  }

  private setPlaying(id: string | null) {
    if (this.playing === id) return
    this.playing = id
    this.events.onPlaying?.(id)
  }

  private resize() {
    const r = renderer
    if (!r) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    r.setSize(w, h, false)
    this.size = { w, h }
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    this.aim()
  }

  /** Fit the room the shown thing needs, centred below any inset, with a margin. */
  private aim() {
    const { w, h } = this.size
    const inset = Math.min(this.inset, h * 0.4)
    // Vertically, only the stage below the inset is ours; across, all of it.
    const tanV = Math.tan((camera.fov * Math.PI) / 360) * (h - inset) / h
    const tanH = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect
    const { lo, hi, half } = this.room
    const tall = hi - lo
    const dist = Math.max((tall * 1.12) / 2 / tanV, (half * 2 * 1.08) / 2 / tanH)
    const mid = (lo + hi) / 2
    camera.position.set(0, mid + tall * 0.06, dist)
    camera.lookAt(0, mid, 0)
    // Slide the picture down into the clear band.
    if (inset > 0.5) camera.setViewOffset(w, h, 0, -inset / 2, w, h)
    else if (camera.view?.enabled) camera.clearViewOffset()
  }

  private frame() {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const s = this.shown
    if (s?.kind === 'hero') {
      const { performer, animator, hero } = s.loaded
      performer.update(dt)
      if (!performer.active) {
        // A move has ended (or the idle dance has only just arrived): back to
        // dancing, ready for the next tap. Until that clip exists, breathe.
        this.setPlaying(null)
        if (performer.has(IDLE)) {
          performer.play(IDLE, { loop: true })
          // Pose it now: otherwise this frame renders the bare T-pose.
          performer.update(0)
        } else animator.update(dt, now / 1000)
      }
      hero.vrm.update(dt)
      const { room } = s.loaded
      const move = this.playing ? room.moves.get(this.playing) : undefined
      this.roomTarget = move ? union(room.idle, move) : room.idle
    }
    // Out fast, so the room is there before a backflip reaches the top; back
    // in gently once the move is over.
    const t = this.roomTarget, r = this.room
    const growing = t.hi > r.hi + 1e-3 || t.lo < r.lo - 1e-3 || t.half > r.half + 1e-3
    const rate = growing ? 9 : 2.5
    this.room = { lo: damp(r.lo, t.lo, rate, dt), hi: damp(r.hi, t.hi, rate, dt), half: damp(r.half, t.half, rate, dt) }
    this.inset = Math.abs(this.inset - this.insetTarget) < 0.5 ? this.insetTarget : damp(this.inset, this.insetTarget, 6, dt)
    if (s?.kind === 'sculpt') s.obj.rotation.y += dt * (reducedMotion() ? 0.3 : 1.1)
    if (s && this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / 0.32)
      const k = 0.85 + 0.15 * easeOutBack(this.pop)
      ;(s.kind === 'hero' ? s.loaded.hero.root : s.obj).scale.setScalar(k)
    }
    shadow.visible = !!s
    this.aim()
    renderer?.render(scene, camera)
  }
}
