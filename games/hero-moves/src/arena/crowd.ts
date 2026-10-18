import * as THREE from 'three'
import { parseHero, type Hero } from '../avatar/loader'
import { loadRetargeted } from '../anim/clips'
import { animUrl } from '../anim/files'
import { ARENA, BACK_BLOCKS, BLOCK_SIZE, PAL } from './world'

/**
 * The crowd: other children's heroes cheering from the stands along both
 * sides of the room — never inside it, never hittable.
 *
 * Raz, after the first classroom: "inside the arena I shouldn't be hitting
 * characters from other kids." So a hero that is not the player's is only
 * ever a fan. The crowd lives in its own group, outside the walls, and is
 * never in `Game.things` — the only list the punch, the auto-aim and the
 * ground pound read. `window.__arena.audit()` checks both facts.
 *
 * Who is in it:
 * - a class hero (made in a class session) is cheered by its classmates: the
 *   class's own finished heroes from `GET /api/classes/<id>/stage`, which only
 *   the class's teacher can read. That is who opens a class hero's game.
 * - anyone else, and any seat the class cannot fill, gets Editors' choice
 *   (`GET /api/creations/?featured_only=true`). A class hero can never be
 *   featured (the API refuses), so no class ever sees another class's child
 *   unless an editor starred a hero that is no longer a class hero.
 * - no API at all (GitHub Pages): the sample heroes this build ships.
 *
 * Every fan plays rotation-only retargeted CC0 clips (src/anim/), so a
 * jumping jack lands the same on a panda, a cloud and a star with legs.
 */

export interface CrowdSource { url: string; name: string; from: 'class' | 'featured' | 'sample' }

interface CreationLite {
  id: string
  user_id: string
  character_name?: string | null
  name?: string | null
  in_class?: boolean
  steps?: { step_name: string; status: string }[]
}
interface StageHero { creationId: string; heroName?: string | null; name?: string; vrmUrl: string }

const TOKEN_KEY = 'heromaker_jwt_token'
function authHeaders(): Record<string, string> {
  let token: string | null = null
  try { token = localStorage.getItem(TOKEN_KEY) } catch { /* storage blocked: no class lookup */ }
  return token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' }
}

async function getJson<T>(url: string, auth = false): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: auth ? authHeaders() : { Accept: 'application/json' } })
    if (!r.ok) return null
    return await r.json() as T
  } catch { return null }
}

/** `/api/files/<user>/<creation>/opt_avatar.vrm` → the creation id. */
function creationIdOf(path: string): string | null {
  const m = /\/api\/files\/[^/]+\/([^/]+)\//.exec(path)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * The class a class hero belongs to: `?class=<id>` when the opener knows it,
 * otherwise the signed-in teacher's classes, searched for this hero.
 */
async function classHeroes(classParam: string | null, ownId: string | null): Promise<StageHero[] | null> {
  const stage = async (id: string) => (await getJson<{ heroes?: StageHero[] }>(`/api/classes/${encodeURIComponent(id)}/stage`, true))?.heroes ?? null
  if (classParam) {
    const heroes = await stage(classParam)
    if (heroes && (!ownId || heroes.some((h) => h.creationId === ownId))) return heroes
    return null
  }
  if (!ownId) return null
  const mine = await getJson<{ classes?: { id: string }[] }>('/api/classes', true)
  for (const c of (mine?.classes ?? []).slice(0, 8)) {
    const heroes = await stage(c.id)
    if (heroes?.some((h) => h.creationId === ownId)) return heroes
  }
  return null
}

const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Up to `max` heroes for the stands, never the player's own. Classmates
 * first for a class hero, Editors' choice for every seat left.
 */
export async function crowdSources(own: string | null, samples: Record<string, string>, max = 6, classParam: string | null = null): Promise<CrowdSource[]> {
  const ownPath = own ? new URL(own, location.href).pathname : ''
  const ownId = creationIdOf(ownPath)
  const out: CrowdSource[] = []
  const seen = new Set<string>([ownPath])
  const push = (s: CrowdSource) => { if (!seen.has(s.url) && out.length < max) { seen.add(s.url); out.push(s) } }

  // A class hero? (Public: the hero's own page says so, never which class.)
  let inClass = !!classParam
  if (!inClass && ownId) inClass = !!(await getJson<CreationLite>(`/api/creations/${encodeURIComponent(ownId)}`))?.in_class
  if (inClass) {
    const mates = await classHeroes(classParam, ownId)
    for (const h of shuffle((mates ?? []).filter((h) => h.creationId !== ownId))) {
      push({ url: new URL(h.vrmUrl, location.href).pathname, name: (h.heroName || h.name || 'A hero').trim(), from: 'class' })
    }
  }

  const body = await getJson<CreationLite[] | { creations?: CreationLite[] }>('/api/creations/?featured_only=true')
  if (body) {
    const list = Array.isArray(body) ? body : body.creations ?? []
    const featured = list
      // Editors' choice is never a class hero (the API refuses to star one);
      // checked again here so a class's children can only ever meet their own.
      .filter((c) => !c.in_class && c.steps?.some((s) => s.step_name === 'convert_vrm' && s.status === 'completed'))
      .map((c): CrowdSource => ({ url: `/api/files/${c.user_id}/${c.id}/opt_avatar.vrm`, name: (c.character_name || c.name || 'A hero').trim(), from: 'featured' }))
    for (const s of shuffle(featured)) push(s)
  }
  if (!out.length && !body) {
    for (const [k, url] of shuffle(Object.entries(samples))) {
      push({ url: new URL(url, location.href).pathname, name: k.split('/').pop()!.replace('.opt.vrm', '').replace(/_/g, ' '), from: 'sample' })
    }
  }
  return out
}

// ------------------------------------------------------------------ the fans

/** Cheers, all CC0 (Quaternius UAL). Each fan loops two of them and bursts with `burst`. */
const CHEERS = {
  jacks: 'Jumping_Jacks.glb',
  pump: 'Victory_Fist_Pump.glb',
  wave: 'Greeting.glb',
  dance: 'Dance_Simple.glb',
  charleston: 'Dance_Charleston.glb',
} as const
type Cheer = keyof typeof CHEERS
const CHEER_IDS = Object.keys(CHEERS) as Cheer[]
const BURST = 'Victory.glb'

const PLATE_H = 0.3
const PLATE_TOP = PLATE_H - 0.17

/**
 * Seats outside the play area, most-seen first, left and right in turn. The
 * first are the big letter blocks either side of the toy chest: high, behind
 * the back edge, and in shot even in a phone's narrow portrait view. Then a
 * plate each behind the low side walls (x = ±5.2), which a wide screen shows
 * all the time and a phone shows as the hero runs to that side. Every fan
 * faces the camera's side of the room, so the front the child drew shows.
 */
interface Seat { x: number; y: number; z: number; plate: boolean }
const block = (i: number): Seat => ({ x: BACK_BLOCKS[i][0], y: BLOCK_SIZE, z: BACK_BLOCKS[i][1], plate: false })
const SEATS: Seat[] = [
  block(1), block(2),
  { x: -5.65, y: PLATE_TOP, z: -2.5, plate: true }, { x: 5.65, y: PLATE_TOP, z: -2.5, plate: true },
  block(0), block(3),
]
export const CROWD_MAX = SEATS.length
/** Fans stand a little smaller than the player, so the player's hero is the star. */
const FAN_HEIGHT = 1.55

class Fan {
  readonly mixer: THREE.AnimationMixer
  private loops: THREE.AnimationAction[] = []
  private burst: THREE.AnimationAction | null = null
  private current: THREE.AnimationAction | null = null
  private loopAt = 0
  private nextSwap: number
  private burstUntil = 0
  private hopT = -1
  private hopH = 0
  private delay = -1
  private bigQueued = false
  /** Where it stands; the hop lifts it off its seat. */
  readonly base = new THREE.Vector3()
  readonly sphere = new THREE.Sphere()
  visible = true

  constructor(readonly hero: Hero, readonly name: string, readonly from: CrowdSource['from'], private seed: number) {
    this.mixer = new THREE.AnimationMixer(hero.vrm.scene)
    this.nextSwap = 4 + (seed % 3) * 1.3
    // Marked so the toy check (things.ts isToy) can never mistake it for one.
    hero.root.userData.hero = true
  }

  async load(): Promise<boolean> {
    // Two loops each, picked so neighbours differ, plus the shared burst.
    const picks = [CHEER_IDS[this.seed % CHEER_IDS.length], CHEER_IDS[(this.seed + 2) % CHEER_IDS.length]]
    const bind = async (file: string) => {
      try { return this.mixer.clipAction((await loadRetargeted(animUrl(file), this.hero.vrm)).clip) } catch { return null }
    }
    const [a, b, burst] = await Promise.all([bind(CHEERS[picks[0]]), bind(CHEERS[picks[1]]), bind(BURST)])
    this.loops = [a, b].filter(Boolean) as THREE.AnimationAction[]
    this.burst = burst
    if (!this.loops.length) return false
    this.playLoop(0, true)
    return true
  }

  private playLoop(i: number, first = false) {
    const a = this.loops[i % this.loops.length]
    this.loopAt = i % this.loops.length
    a.reset()
    a.setLoop(THREE.LoopRepeat, Infinity)
    // Out of step with each other: a random start and a slightly different tempo.
    a.timeScale = 0.9 + ((this.seed * 37) % 25) / 100
    if (first) a.time = (this.seed * 0.73) % a.getClip().duration
    a.enabled = true
    a.setEffectiveWeight(1)
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, 0.35, false)
    a.play()
    this.current = a
  }

  /** Jump up, arms high: the player scored. `big` holds the arms up longer and jumps higher. */
  react(delay: number, big: boolean) {
    if (this.delay >= 0 || this.burstUntil > 0) { this.bigQueued ||= big; return }
    this.delay = delay
    this.bigQueued = big
  }

  private fire() {
    const big = this.bigQueued
    this.bigQueued = false
    this.hopT = 0
    this.hopH = big ? 0.45 : 0.28
    const b = this.burst
    if (!b) return
    b.reset()
    b.setLoop(THREE.LoopOnce, 1)
    b.clampWhenFinished = true
    b.timeScale = 1.25
    b.time = 0.2
    b.enabled = true
    b.setEffectiveWeight(1)
    if (this.current) b.crossFadeFrom(this.current, 0.1, false)
    b.play()
    this.current = b
    this.burstUntil = big ? 1.5 : 1.0
  }

  update(dt: number) {
    if (this.delay >= 0) {
      this.delay -= dt
      if (this.delay < 0) this.fire()
    }
    if (this.burstUntil > 0) {
      this.burstUntil -= dt
      if (this.burstUntil <= 0) { this.burstUntil = 0; this.playLoop(this.loopAt) }
    } else {
      this.nextSwap -= dt
      if (this.nextSwap <= 0 && this.loops.length > 1) {
        this.playLoop(this.loopAt + 1)
        this.nextSwap = 5 + ((this.seed * 13) % 4)
      }
    }
    let y = 0
    if (this.hopT >= 0) {
      this.hopT += dt / 0.42
      y = this.hopT >= 1 ? 0 : Math.sin(this.hopT * Math.PI) * this.hopH
      if (this.hopT >= 1) this.hopT = -1
    }
    this.hero.root.position.set(this.base.x, this.base.y + y, this.base.z)
    if (!this.visible) return
    this.mixer.update(dt)
    // The humanoid only: spring bones and look-at are the player's hero's
    // luxuries, and skipping them is most of what a fan saves.
    this.hero.vrm.humanoid.update()
  }
}

export class Crowd {
  readonly root = new THREE.Group()
  readonly fans: Fan[] = []
  private plates: THREE.InstancedMesh
  private frustum = new THREE.Frustum()
  private m = new THREE.Matrix4()
  private lastCheer = -10
  private clock = 0
  private rims: THREE.InstancedMesh
  private platesUsed = 0

  constructor(scene: THREE.Scene, private max = CROWD_MAX) {
    this.root.name = 'crowd'
    scene.add(this.root)
    // A fan on the floor stands on a plate, like every hero in the app: one
    // draw call for all of them, and one for their grape rims.
    const n = SEATS.filter((s) => s.plate).length
    const geo = new THREE.CylinderGeometry(0.62, 0.66, PLATE_H, 28)
    geo.translate(0, PLATE_H / 2 - 0.17, 0)
    this.plates = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n)
    const rimGeo = new THREE.TorusGeometry(0.64, 0.035, 6, 28).rotateX(Math.PI / 2)
    rimGeo.translate(0, PLATE_TOP, 0)
    this.rims = new THREE.InstancedMesh(rimGeo, new THREE.MeshStandardMaterial({ color: PAL.grape, roughness: 0.6 }), n)
    for (const m of [this.plates, this.rims]) { m.count = 0; m.frustumCulled = false; this.root.add(m) }
  }

  private addPlate(x: number, z: number) {
    const plateCols = [0xe9e3ff, 0xffe9a8, 0xcff5ea, 0xffdcc7, 0xd6ecff, 0xffd6e7]
    const i = this.platesUsed++
    const m = new THREE.Matrix4().makeTranslation(x, 0, z)
    this.plates.setMatrixAt(i, m)
    this.plates.setColorAt(i, new THREE.Color(plateCols[(i * 2 + 1) % plateCols.length]))
    this.rims.setMatrixAt(i, m)
    this.plates.count = this.rims.count = this.platesUsed
    this.plates.instanceMatrix.needsUpdate = this.rims.instanceMatrix.needsUpdate = true
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true
  }

  get size() { return this.fans.length }

  /** Seat a hero. Resolves false (and seats nobody) if it cannot cheer. */
  async add(hero: Hero, name: string, from: CrowdSource['from']): Promise<boolean> {
    if (this.fans.length >= this.max) return false
    const i = this.fans.length
    const fan = new Fan(hero, name, from, i * 7 + 3)
    if (!(await fan.load())) return false
    const { x, y, z, plate } = SEATS[i]
    const s = FAN_HEIGHT / Math.max(1.2, hero.height)
    hero.root.scale.setScalar(s)
    fan.base.set(x, y, z)
    if (plate) this.addPlate(x, z)
    // Face the camera's side of the room, turned in toward the play.
    hero.root.rotation.y = Math.atan2(0 - x * 0.75, 7 - z)
    const r = Math.max(hero.height, hero.width) * s * 0.6
    fan.sphere.set(new THREE.Vector3(x, fan.base.y + hero.height * s * 0.5, z), r)
    this.root.add(hero.root)
    this.fans.push(fan)
    return true
  }

  /**
   * The player scored. Most fans jump with their arms up, a beat apart; a big
   * moment (a crate, a combo step, a smash) brings everyone up.
   */
  cheer(big = false): boolean {
    if (!this.fans.length) return false
    if (!big && this.clock - this.lastCheer < 0.7) return false
    this.lastCheer = this.clock
    this.fans.forEach((f, i) => {
      if (big || (i + Math.floor(this.clock * 3)) % 3 !== 0) f.react(Math.random() * 0.22, big)
    })
    return true
  }

  /** The round is over: everybody up. */
  celebrate() { this.lastCheer = -10; this.cheer(true) }

  update(dt: number, camera: THREE.Camera) {
    this.clock += dt
    // A fan out of shot is not drawn and not animated: on a phone in portrait
    // the camera sees one side of the room at a time.
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.m)
    for (const f of this.fans) {
      f.visible = this.frustum.intersectsSphere(f.sphere)
      f.hero.root.visible = f.visible
      f.update(dt)
    }
  }

  /** Every fan stands outside the play area. */
  outside(): boolean {
    return this.fans.every((f) => Math.abs(f.base.x) > ARENA.maxX + 0.5 || f.base.z < ARENA.minZ - 0.5)
  }

  get onScreen() { return this.fans.filter((f) => f.visible).length }
}

/** Download, parse and seat one fan; false if it cannot cheer. */
export async function loadFan(crowd: Crowd, src: CrowdSource): Promise<boolean> {
  try {
    const r = await fetch(src.url)
    if (!r.ok) return false
    // No drawn outline: it doubles a skinned mesh, and the player's hero is the one that stands out.
    const hero = await parseHero(await r.arrayBuffer(), { outline: false })
    if (!(await crowd.add(hero, src.name, src.from))) { hero.dispose(); return false }
    return true
  } catch {
    return false
  }
}
