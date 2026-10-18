import * as THREE from 'three'
import { loadHero, type Hero } from '../avatar/loader'
import { loadRetargeted, loadVrma } from '../anim/clips'
import { animUrl } from '../anim/files'
import { roomMeter, union, type Room } from '../anim/room'
import { FILM_CLIPS, clipSpec } from './clips'
import { FilmSet } from './set'
import { Painter } from './overlay'
import { fill, place, scoreFor, type Act, type Beat, type Key, type Names, type Placed, type Script, type Shot } from './script'
import type { ScorePlan } from './music'

/**
 * Turns a script and a hero into pictures. `render(t)` draws the frame at film
 * time `t` — any `t`, in any order — which is what lets the same film play live
 * in the page, record in the browser, and render frame by frame offline.
 *
 * Nothing here is wall-clock driven. The one stateful thing is the hero's
 * spring bones (hair, capes), which settle over a few frames; they are reset
 * on every cut so a teleport between sets never flings them.
 */

export interface FilmOptions {
  script: Script
  names: Names
  heroUrl: string
  drawingUrl?: string | null
  width: number
  height: number
  /** Where the end card sends people. */
  link: string
  watermark?: boolean
}

interface Bound { action: THREE.AnimationAction; dur: number }
interface Pose { id: string; time: number; w: number }

const CROSS = 0.32
const TRANSITION = 0.36
const FOV = 34
const MAX_AZ = 40

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export class Film {
  readonly canvas: HTMLCanvasElement
  readonly duration: number
  readonly beats: Placed[]
  readonly plan: ScorePlan
  readonly title: string

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private set: FilmSet
  private mixer: THREE.AnimationMixer
  private bound = new Map<string, Bound>()
  private rooms = new Map<string, Room>()
  private painter: Painter
  private ctx2d: CanvasRenderingContext2D
  private shadow: THREE.Mesh
  private lastBeat = -1
  private lastT = 0
  /** Rest-pose landmarks in the hero's own space. */
  private neckY: number
  private headY: number

  private constructor(private hero: Hero, private opts: FilmOptions, private drawing: HTMLImageElement | null) {
    const { width: W, height: H } = opts
    const { beats, duration } = place(opts.script)
    this.beats = beats
    this.duration = duration
    this.plan = scoreFor(opts.script, beats, duration)
    this.title = fill(opts.script.title, opts.names)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(W, H, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.camera = new THREE.PerspectiveCamera(FOV, W / H, 0.05, 80)
    this.set = new FilmSet(beats.map((b) => b.backdrop))
    this.scene.add(this.set.group)
    this.scene.add(hero.root)

    // A soft contact shadow under the hero for every set, on top of the real one.
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(20,12,40,0.45)'); grad.addColorStop(1, 'rgba(20,12,40,0)')
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.012
    this.shadow.scale.setScalar(Math.max(0.8, hero.width * 0.9))
    this.scene.add(this.shadow)

    this.mixer = new THREE.AnimationMixer(hero.vrm.scene)

    this.canvas = document.createElement('canvas')
    this.canvas.width = W; this.canvas.height = H
    this.ctx2d = this.canvas.getContext('2d')!
    this.painter = new Painter(this.ctx2d, W, H)

    hero.root.updateMatrixWorld(true)
    const y = (b: 'neck' | 'head') => {
      const n = hero.vrm.humanoid.getRawBoneNode(b)
      return n ? hero.root.worldToLocal(n.getWorldPosition(new THREE.Vector3())).y : null
    }
    this.headY = y('head') ?? hero.height * 0.8
    this.neckY = Math.min(y('neck') ?? this.headY, this.headY)
  }

  /** Load the hero, its drawing and every clip the script uses, then build the sets. */
  static async create(opts: FilmOptions, progress: (f: number, what: string) => void = () => {}): Promise<Film> {
    progress(0.05, 'Finding your hero')
    const drawing = opts.drawingUrl ? loadImage(opts.drawingUrl).catch(() => null) : Promise.resolve(null)
    const hero = await loadHero(opts.heroUrl)
    progress(0.45, 'Learning the moves')
    const ids = new Set<string>(['idle'])
    for (const b of opts.script.beats) for (const a of b.acts) ids.add(a.clip)
    const film = new Film(hero, opts, await drawing)
    let done = 0
    await Promise.all([...ids].map(async (id) => {
      const spec = clipSpec(id)
      if (!spec) { console.warn(`film: no clip "${id}"`); return }
      try {
        const url = animUrl(spec.url)
        const { clip } = spec.kind === 'vrma' ? await loadVrma(url, hero.vrm) : await loadRetargeted(url, hero.vrm)
        const action = film.mixer.clipAction(clip)
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.enabled = true
        action.weight = 0
        action.play()
        film.bound.set(id, { action, dur: clip.duration })
      } catch (err) {
        console.warn(`film: clip ${id} unavailable`, err)
      }
      progress(0.45 + 0.4 * (++done / ids.size), 'Learning the moves')
    }))
    // Measure each clip on this hero, so the camera knows how much room a backflip needs.
    const measure = roomMeter(hero)
    for (const [id, b] of film.bound) film.rooms.set(id, measure(b.action.getClip()))
    // roomMeter leaves the clips' mixer cache alone but resets the pose; re-arm ours.
    for (const b of film.bound.values()) { b.action.enabled = true; b.action.play() }
    progress(0.92, 'Setting the stage')
    film.render(0)
    progress(1, 'Ready')
    return film
  }

  get drawingImage() { return this.drawing }

  beatAt(t: number): Placed {
    for (const b of this.beats) if (t < b.end) return b
    return this.beats[this.beats.length - 1]
  }

  // ---------------------------------------------------------------- pose
  private poseFor(beat: Beat, u: number): Pose[] {
    const acts = [...beat.acts].sort((a, b) => a.at - b.at)
    let i = acts.length - 1
    while (i > 0 && acts[i].at > u) i--
    const cur = acts[i]
    const local = (a: Act, at: number) => {
      const b = this.bound.get(a.clip)
      if (!b) return { time: 0, done: Infinity, dur: 0 }
      const raw = Math.max(0, at - a.at) * (a.speed ?? 1) + (a.offset ?? 0)
      if (a.loop) return { time: raw % b.dur, done: Infinity, dur: b.dur }
      return { time: Math.min(raw, b.dur - 1e-3), done: a.at + (b.dur - (a.offset ?? 0)) / (a.speed ?? 1), dur: b.dur }
    }
    const out: Pose[] = []
    const c = local(cur, u)
    // A one-shot that has finished hands back to the idle loop.
    const over = u - c.done
    if (over > 0 && this.bound.has('idle')) {
      const k = clamp01(over / CROSS)
      out.push({ id: cur.clip, time: c.time, w: 1 - k })
      out.push({ id: 'idle', time: over % this.bound.get('idle')!.dur, w: k })
    } else out.push({ id: cur.clip, time: c.time, w: 1 })
    // Cross-fade in from whatever the previous act was doing.
    const since = u - cur.at
    if (i > 0 && since < CROSS) {
      const k = smooth(clamp01(since / CROSS))
      for (const p of out) p.w *= k
      const prev = acts[i - 1]
      const pl = local(prev, u)
      const pover = u - pl.done
      if (pover > 0 && this.bound.has('idle')) {
        const kk = clamp01(pover / CROSS)
        out.push({ id: prev.clip, time: pl.time, w: (1 - k) * (1 - kk) })
        out.push({ id: 'idle', time: pover % this.bound.get('idle')!.dur, w: (1 - k) * kk })
      } else out.push({ id: prev.clip, time: pl.time, w: 1 - k })
    }
    return out
  }

  private applyPose(poses: Pose[]) {
    const merged = new Map<string, Pose>()
    for (const p of poses) {
      if (!this.bound.has(p.id) || p.w <= 1e-4) continue
      const m = merged.get(p.id)
      // The same clip twice (blast, blast) at two times: keep the heavier one.
      if (!m || p.w > m.w) merged.set(p.id, { ...p, w: (m && m.time === p.time ? m.w : 0) + p.w })
    }
    const total = [...merged.values()].reduce((a, p) => a + p.w, 0) || 1
    for (const [id, b] of this.bound) {
      const p = merged.get(id)
      b.action.weight = p ? p.w / total : 0
      if (p) b.action.time = p.time
    }
    this.mixer.update(0)
  }

  // ---------------------------------------------------------------- path
  private pathAt(path: Key[] | undefined, u: number) {
    const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }
    if (!path?.length) return out
    for (const f of ['x', 'y', 'z', 'yaw', 'pitch'] as const) {
      const keys = path.filter((k) => k[f] !== undefined)
      if (!keys.length) continue
      if (u <= keys[0].t) { out[f] = keys[0][f]!; continue }
      const last = keys[keys.length - 1]
      if (u >= last.t) { out[f] = last[f]!; continue }
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1]
        if (u >= a.t && u <= b.t) { out[f] = a[f]! + (b[f]! - a[f]!) * smooth((u - a.t) / Math.max(1e-3, b.t - a.t)); break }
      }
    }
    return out
  }

  // ---------------------------------------------------------------- camera
  /** The strip of the frame the hero should fill, as fractions from the top. */
  private band(beat: Beat): [number, number] {
    if (beat.card === 'end') return [0.12, 0.5]
    if (beat.card === 'greeting-end') return [0.2, 0.47]
    if (beat.card === 'title') return [0.44, 0.94]
    if (beat.title && beat.text) return [0.2, 0.74]
    if (beat.title) return [0.3, 0.86]
    if (beat.text) return [0.08, 0.74]
    return [0.08, 0.92]
  }

  private roomFor(beat: Beat): Room {
    const h = this.hero.height
    let r: Room = { lo: 0, hi: h * 1.02, half: this.hero.width * 0.42 }
    for (const a of beat.acts) { const m = this.rooms.get(a.clip); if (m) r = union(r, m) }
    // A clip that starts in mid-air (the superhero landing) or travels measures
    // far bigger than the moment worth framing; never let one shrink the hero
    // to a speck. The path decides where the hero is, the camera follows it.
    return { lo: Math.max(r.lo, -0.1 * h), hi: Math.min(r.hi, 1.6 * h), half: Math.min(r.half, Math.max(0.9 * h, this.hero.width * 0.6)) }
  }

  private shotState(shot: Shot, beat: Beat, band: [number, number]) {
    const h = this.hero.height
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const aspect = this.opts.width / this.opts.height
    let lo: number, hi: number, half: number
    const room = this.roomFor(beat)
    switch (shot.shot) {
      case 'close': {
        const headH = Math.max(h - this.neckY, h * 0.18)
        lo = Math.max(0, this.neckY - headH * 0.45); hi = h + headH * 0.12
        half = Math.max(headH * 0.75, this.hero.width * 0.22)
        break
      }
      case 'medium':
        lo = Math.max(0, Math.min(this.neckY * 0.45, h * 0.4)); hi = Math.max(h * 1.06, room.hi * 0.98)
        half = Math.min(room.half, this.hero.width * 0.55) * 0.95
        break
      default:
        lo = Math.min(0, room.lo) - h * 0.03; hi = room.hi + h * 0.04
        half = room.half * 1.04
    }
    const frac = band[1] - band[0]
    const dV = (hi - lo) / (2 * tanV * frac)
    const dH = (half * 1.12) / (tanV * aspect)
    const dist = Math.max(dV, dH) * (shot.push ?? 1) * (shot.shot === 'low' ? 0.92 : 1)
    const mid = (lo + hi) / 2
    const centre = (band[0] + band[1]) / 2
    const look = mid - (0.5 - centre) * 2 * dist * tanV
    // Eye a touch above the look point; a low shot looks up from the knees.
    const eye = shot.shot === 'low' ? Math.max(0.15, h * 0.18) : look + dist * Math.tan(THREE.MathUtils.degToRad(shot.shot === 'close' ? 2 : 6))
    const az = Math.max(-MAX_AZ, Math.min(MAX_AZ, shot.az ?? 0))
    return { dist, look, eye, az }
  }

  private placeCamera(beat: Placed, u: number, heroPos: { x: number; y: number; z: number }) {
    const band = this.band(beat)
    const a = this.shotState(beat.camera.from, beat, band)
    const b = beat.camera.to ? this.shotState(beat.camera.to, beat, band) : a
    const k = smooth(clamp01(u / beat.dur))
    const L = (p: number, q: number) => p + (q - p) * k
    const dist = L(a.dist, b.dist), az = THREE.MathUtils.degToRad(L(a.az, b.az))
    const look = L(a.look, b.look), eye = L(a.eye, b.eye)
    // Follow the hero across the stage loosely, and up into the air fully.
    const tx = heroPos.x * 0.55, tz = heroPos.z * 0.5
    this.camera.position.set(tx + Math.sin(az) * dist, eye + heroPos.y * 0.6, tz + Math.cos(az) * dist)
    this.camera.lookAt(tx, look + heroPos.y * 0.7, tz)
    this.camera.updateMatrixWorld()
  }

  /** Where the hero's face is on screen, in pixels. */
  private faceOnScreen() {
    const n = this.hero.vrm.humanoid.getRawBoneNode('head')
    const v = n ? n.getWorldPosition(new THREE.Vector3()) : this.hero.root.position.clone().setY(this.hero.height * 0.8)
    v.project(this.camera)
    return { x: (v.x * 0.5 + 0.5) * this.opts.width, y: (-v.y * 0.5 + 0.5) * this.opts.height }
  }

  // ---------------------------------------------------------------- frame
  render(t: number) {
    t = Math.max(0, Math.min(this.duration - 1e-3, t))
    const dt = Math.max(0, Math.min(0.1, t - this.lastT)) || 1 / 30
    this.lastT = t
    const beat = this.beatAt(t)
    const u = t - beat.start
    const prev = beat.index > 0 ? this.beats[beat.index - 1] : null

    this.set.show(beat.backdrop)

    // Pose: a hard cut between beats is softened by blending out of the last pose.
    let poses = this.poseFor(beat, u)
    if (prev && (beat.transition === 'cut' || beat.transition === 'flash') && u < CROSS) {
      const k = smooth(u / CROSS)
      poses = [...poses.map((p) => ({ ...p, w: p.w * k })), ...this.poseFor(prev, prev.dur + u).map((p) => ({ ...p, w: p.w * (1 - k) }))]
    }
    this.applyPose(poses)

    const pos = this.pathAt(beat.path, u)
    this.hero.root.position.set(pos.x, pos.y, pos.z)
    this.hero.root.rotation.set(THREE.MathUtils.degToRad(pos.pitch), THREE.MathUtils.degToRad(pos.yaw), 0, 'YXZ')
    this.shadow.position.set(pos.x, 0.012, pos.z)
    const lift = clamp01(1 - pos.y / 1.5)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = lift
    this.shadow.scale.setScalar(Math.max(0.8, this.hero.width * 0.9) * (0.6 + 0.4 * lift))

    if (beat.index !== this.lastBeat) {
      this.hero.vrm.springBoneManager?.reset()
      this.lastBeat = beat.index
    }
    this.hero.vrm.update(dt)

    this.placeCamera(beat, u, pos)
    this.set.follow(this.camera, new THREE.Vector3(pos.x, pos.y + this.hero.height * 0.7, pos.z))
    this.set.update(dt, (t * this.opts.script.bpm / 60) % 1)
    this.renderer.render(this.scene, this.camera)

    // ---- 2D
    const g = this.ctx2d, P = this.painter, { width: W, height: H } = this.opts
    g.drawImage(this.renderer.domElement, 0, 0, W, H)
    const n = this.opts.names
    const face = this.faceOnScreen()

    for (const f of beat.fx ?? []) {
      const tau = u - (f.at ?? 0)
      const seed = beat.index * 97 + Math.round((f.at ?? 0) * 10) + 1
      if (f.kind === 'confetti') P.confetti(tau, seed, f.palette ?? 'bright')
      else if (f.kind === 'sparkle') P.sparkles(tau, f.dur ?? 1.5, face.x, face.y + 60 * P.s, 230 * P.s, seed)
      else if (f.kind === 'stars') P.stars(tau, seed)
      else if (f.kind === 'hearts') P.hearts(tau, seed)
    }
    // Confetti from a previous beat keeps falling across a cut.
    if (prev) for (const f of prev.fx ?? []) if (f.kind === 'confetti') P.confetti(prev.dur + u - (f.at ?? 0), prev.index * 97 + Math.round((f.at ?? 0) * 10) + 1, f.palette ?? 'bright')

    if (beat.card === 'title') {
      const age = n.age ? `, ${n.age}` : ''
      P.titleCard(this.title, `Starring ${n.hero} · Drawn by ${n.artist}${age}`, u, beat.dur)
    }
    if (beat.title && !beat.card) {
      const greeting = !beat.text
      P.headline(fill(beat.title, n), u, beat.dur + (greeting ? 0.4 : 0), { y: (greeting ? 150 : 128) * P.s, size: greeting ? 100 : 120, maxLines: 2 })
    }
    if (beat.text) P.caption(fill(beat.text, n), n.hero, u, beat.dur)
    if (beat.sub && !beat.card) P.caption(fill(beat.sub, n), `${n.hero} ${n.from ?? ''}`, u - 0.9, beat.dur - 0.9 + 0.4, { size: 44, y: H - 60 * P.s })
    if (beat.card === 'end') {
      const age = n.age ? `, ${n.age}` : ''
      P.endCard(this.drawing, `${n.artist}${age}`, `Made from ${n.artist}'s drawing`, 'Make your own at HeroMaker', u)
    }
    if (beat.card === 'greeting-end') {
      const age = n.age ? `, ${n.age}` : ''
      P.headline(fill(this.opts.script.title, n), u + 2, 99, { y: 78 * P.s, size: 80, maxLines: 2 })
      P.greetingEnd(this.drawing, `${n.artist}${age}`, `${n.artist} drew this hero!`, this.opts.link, u)
    }
    if (this.opts.watermark && beat.card !== 'end' && beat.card !== 'title') P.watermark()

    // Transitions: close at the end of this beat if the next one opens with one, open at its start.
    const next = this.beats[beat.index + 1]
    const kind = (b?: Placed | null) => (b ? b.transition ?? (b.index > 0 && this.beats[b.index - 1].backdrop !== b.backdrop ? 'iris' : 'wipe') : 'cut')
    const nk = kind(next)
    const left = beat.dur - u
    if (next && left < TRANSITION) {
      const k = 1 - left / TRANSITION
      if (nk === 'iris') P.iris(k, face.x, face.y)
      else if (nk === 'wipe') P.wipe(k, true)
      else if (nk === 'flash') P.flash(k * k * 0.9)
    }
    const ck = beat.index > 0 ? kind(beat) : 'cut'
    if (u < TRANSITION) {
      const k = 1 - u / TRANSITION
      if (ck === 'iris') P.iris(k, face.x, face.y)
      else if (ck === 'wipe') P.wipe(k, false)
      else if (ck === 'flash') P.flash(k)
    }
    // Fade up from ink at the very start, and down at the very end.
    if (t < 0.4) P.fade(1 - t / 0.4)
    if (this.duration - t < 0.5) P.fade(1 - (this.duration - t) / 0.5)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.set.dispose()
    this.hero.dispose()
    this.renderer.dispose()
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => fail(new Error(`image ${url}`))
    img.src = url
  })
}

export { FILM_CLIPS }
