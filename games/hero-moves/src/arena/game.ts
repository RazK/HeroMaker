import * as THREE from 'three'
import type { Hero } from '../avatar/loader'
import { makeRng } from '../core/math'
import type { Input } from './controls'
import { Moves, type MoveId } from './moves'
import { makeThing, makeWarning, Particles, Shockwave, type Kind, type Thing } from './things'
import { ARENA, CHEST, PAL, World, makeBlob } from './world'
import type { Sfx } from './sfx'

/**
 * Robot Rumble's rules: wind-up robots march in from the front of the room
 * toward the toy chest at the back, and the hero stops them.
 *
 * The direction is the whole design. Robots come from the camera's side, so
 * the hero spends the round turned toward the camera to meet them — the face
 * the child drew is what the player looks at, not the back the pipeline
 * guessed. See README.md in this folder for the measurement.
 */

export const ROUND_SECONDS = 75
const GRAVITY = 19
const JUMP_V = 6.6
const RUN_SPEED = 4.1
const HURT_LOCK = 0.55
const INVULNERABLE = 1.6
const COMBO_WINDOW = 2.6
const POUND_RADIUS = 2.3
/**
 * Balloons, crates and gold appear only in front of this line: the toys the
 * hero goes after are between it and the camera, so going after them turns
 * the hero's face toward the player. Robots enter at the front edge too.
 */
const FRONT_HALF = -0.6

export const POINTS: Record<Kind, number> = { robot: 100, balloon: 50, gold: 50, crate: 250, ball: 50 }

export type Phase = 'menu' | 'countdown' | 'play' | 'end'

export interface GameEvents {
  popup(at: THREE.Vector3, text: string, tone: 'score' | 'combo' | 'bad' | 'bonus'): void
  shake(amount: number): void
  hitStop(seconds: number): void
}

interface Attack { move: MoveId; hitAt: number; t: number; done: boolean; reach: number }

export class Game {
  readonly root = new THREE.Group()
  readonly things: Thing[] = []
  readonly particles = new Particles()
  readonly shock = new Shockwave()
  readonly moves: Moves
  phase: Phase = 'menu'
  time = 0
  score = 0
  combo = 0
  best = 0
  stats = { robots: 0, balloons: 0, crates: 0, jumps: 0, slams: 0, stolen: 0, hurt: 0, punches: 0, maxCombo: 0 }

  // ---- hero state
  readonly pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private vy = 0
  heading = 0
  /** What is drawn: the heading, nudged toward the camera when running away. */
  private visualHeading = 0
  private targetHeading = 0
  private loco = 0
  private grounded = true
  private attack: Attack | null = null
  private chain = 0
  private chainUntil = 0
  private pounding = false
  private lockUntil = 0
  private hurtUntil = 0
  private invulnUntil = 0
  private stillFor = 0
  private comboUntil = 0
  /** Time-integrated: seconds the hero's face pointed at the camera, of all seconds played. */
  readonly facing = { front: 0, total: 0, detail: {} as Record<string, number> }

  private heroBlob: THREE.Mesh
  private warnings: { mesh: THREE.Mesh; until: number; side: number; z: number }[] = []
  private rnd = makeRng(1)
  private spawn = { robot: 1.2, balloon: 2.5, crate: 8, ball: 12, gold: [24, 50] as number[] }
  /** Where the camera is, so "facing the camera" can be measured honestly. */
  cameraPos = new THREE.Vector3(0, 5, 10)

  constructor(readonly hero: Hero, readonly world: World, private sfx: Sfx, private ev: GameEvents) {
    this.moves = new Moves(hero.vrm)
    this.root.add(hero.root)
    this.heroBlob = makeBlob(Math.max(0.9, hero.width * 0.55))
    this.root.add(this.heroBlob)
    this.root.add(this.particles.points)
    this.root.add(this.shock.mesh)
    world.scene.add(this.root)
  }

  get radius() { return Math.min(0.55, Math.max(0.3, this.hero.radius)) }
  get airborne() { return !this.grounded }
  get remaining() { return Math.max(0, ROUND_SECONDS - this.time) }
  get multiplier() { return Math.min(5, 1 + Math.floor(this.combo / 5)) }

  reset(seed = 1) {
    for (const t of this.things) this.root.remove(t.obj)
    this.things.length = 0
    for (const w of this.warnings) this.root.remove(w.mesh)
    this.warnings.length = 0
    this.rnd = makeRng(seed)
    this.spawn = { robot: 1.2, balloon: 2.5, crate: 8, ball: 12, gold: [24, 50] }
    this.time = 0
    this.score = 0
    this.combo = 0
    this.stats = { robots: 0, balloons: 0, crates: 0, jumps: 0, slams: 0, stolen: 0, hurt: 0, punches: 0, maxCombo: 0 }
    this.facing.front = this.facing.total = 0
    this.facing.detail = {}
    this.pos.set(0, 0, 0.6)
    this.vel.set(0, 0, 0)
    this.vy = 0
    this.grounded = true
    this.heading = this.targetHeading = this.visualHeading = 0
    this.attack = null
    this.pounding = false
    this.lockUntil = this.hurtUntil = this.invulnUntil = 0
    this.moves.stop()
    this.hero.root.visible = true
  }

  /** The end-of-round celebration: a cheer, then a dance, facing the camera. */
  celebrate() {
    this.attack = null
    this.pounding = false
    this.vel.set(0, 0, 0)
    this.targetHeading = 0
    this.hero.root.visible = true
    for (const t of this.things) if (!t.dead && !t.dying) { t.dying = 0.001; this.particles.burst(t.pos.clone().setY(0.6), 10, [PAL.sun, PAL.grape, PAL.red]) }
    for (const w of this.warnings) this.root.remove(w.mesh)
    this.warnings.length = 0
    if (this.moves.has('victory')) this.moves.play('victory', { mask: 'full', speed: 1 })
  }

  // ------------------------------------------------------------- the frame

  /**
   * `dt` is game time for this frame. The caller clamps it for the physics;
   * the round clock it advances is the same clamped value, because a frame
   * the physics skipped is a frame the player could not act in either.
   */
  update(dt: number, input: Input) {
    const now = this.time
    const playing = this.phase === 'play'
    if (playing) this.time += dt

    this.updateHero(dt, playing ? input : { x: 0, y: 0, punch: false, jump: false })
    if (playing) this.spawnThings()
    this.updateThings(dt)
    this.particles.update(dt)
    this.shock.update(dt)
    this.world.update(dt, now)

    if (this.combo > 0 && this.time > this.comboUntil && playing) this.breakCombo()

    // Measured, not assumed: how much of the round the face was toward us.
    if (playing) {
      const toCam = new THREE.Vector3(this.cameraPos.x - this.pos.x, 0, this.cameraPos.z - this.pos.z).normalize()
      const fwd = new THREE.Vector3(Math.sin(this.visualHeading), 0, Math.cos(this.visualHeading))
      this.facing.total += dt
      const front = fwd.dot(toCam) > 0
      if (front) this.facing.front += dt
      // Four views: front, front three-quarter / profile, back three-quarter, back.
      const c = fwd.dot(toCam)
      const view = c > 0.5 ? 'front' : c > 0 ? 'front34' : c > -0.5 ? 'back34' : 'back'
      this.facing.detail[view] = (this.facing.detail[view] ?? 0) + dt
      const what = `${this.attack ? 'attack' : Math.hypot(this.vel.x, this.vel.z) > 1 ? 'run' : 'still'}-${front ? 'front' : 'back'}`
      this.facing.detail[what] = (this.facing.detail[what] ?? 0) + dt
    }
  }

  private updateHero(dt: number, input: Input) {
    const t = this.time
    const free = t >= this.lockUntil && t >= this.hurtUntil && this.phase === 'play'

    // ---- intent
    const want = new THREE.Vector3(input.x, 0, -input.y)
    const mag = Math.min(1, want.length())
    if (!free) want.set(0, 0, 0)
    const attacking = !!this.attack && !this.attack.done
    const speed = RUN_SPEED * (attacking ? 0.45 : 1) * (this.grounded ? 1 : 0.85)
    const target = want.lengthSq() > 0 ? want.normalize().multiplyScalar(speed * mag) : want
    const accel = this.grounded ? 14 : 5
    this.vel.x += (target.x - this.vel.x) * (1 - Math.exp(-accel * dt))
    this.vel.z += (target.z - this.vel.z) * (1 - Math.exp(-accel * dt))

    // ---- facing: movement first; standing still, turn to meet the nearest
    // robot, and with nothing near, settle three-quarters toward the camera.
    if (mag > 0.15 && free) {
      this.targetHeading = Math.atan2(want.x, want.z)
      this.stillFor = 0
    } else {
      this.stillFor += dt
      if (this.stillFor > 0.18 && !attacking && free) {
        const near = this.nearest(['robot', 'crate', 'balloon', 'gold'], 2.6, true)
        if (near) this.targetHeading = Math.atan2(near.pos.x - this.pos.x, near.pos.z - this.pos.z)
        else {
          const toCam = Math.atan2(this.cameraPos.x - this.pos.x, this.cameraPos.z - this.pos.z)
          this.targetHeading = toCam + 0.35 * Math.sign(this.pos.x || 1)
        }
      }
    }
    const turnRate = attacking ? 26 : 13
    this.heading = wrap(this.heading + wrap(this.targetHeading - this.heading) * (1 - Math.exp(-turnRate * dt)))

    // ---- buttons
    if (free && input.jump && this.grounded) this.jump()
    if (input.punch && this.phase === 'play' && t >= this.hurtUntil) {
      if (!this.grounded && !this.pounding && this.pos.y > 0.25) this.startPound()
      else if (this.grounded && !this.pounding) this.punch()
    }

    // ---- attack timeline
    const a = this.attack
    if (a) {
      a.t += dt
      if (!a.done && a.t >= a.hitAt) { a.done = true; this.resolvePunch(a) }
      if (a.t > a.hitAt + 0.25) this.attack = null
    }

    // ---- physics
    if (!this.grounded) {
      this.vy -= GRAVITY * dt
      this.pos.y += this.vy * dt
      if (this.pos.y <= 0) {
        this.pos.y = 0
        this.grounded = true
        this.vy = 0
        if (this.pounding) this.landPound()
        else if (this.moves.playing === 'jump') this.moves.play('jump', { mask: 'full', from: 1.12, to: 1.55, speed: 1.6, fadeIn: 0.01, fadeOut: 0.12 })
      }
    }
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    const r = this.radius
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, ARENA.minX + r, ARENA.maxX - r)
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, ARENA.minZ + r, ARENA.maxZ - r)
    // The chest is solid.
    const dc = new THREE.Vector2(this.pos.x - CHEST.x, this.pos.z - CHEST.z)
    if (dc.length() < 1.1 + r) { dc.setLength(1.1 + r); this.pos.x = CHEST.x + dc.x; this.pos.z = CHEST.z + dc.y }

    // ---- animation
    const sp = Math.hypot(this.vel.x, this.vel.z) / RUN_SPEED
    this.loco += (Math.min(1, sp * 1.2) - this.loco) * (1 - Math.exp(-10 * dt))
    this.moves.setLocomotion(this.grounded ? this.loco : 0)
    // Landing tail of a jump: hand the legs back to the run straight away.
    if (this.moves.playing === 'jump' && this.grounded && this.loco > 0.4 && this.moves.time > 1.2) this.moves.stop()
    this.moves.update(dt)
    this.hero.vrm.update(dt)

    const blink = t < this.invulnUntil && this.phase === 'play' && Math.floor(t * 15) % 3 === 0
    this.hero.root.visible = !blink
    this.hero.root.position.copy(this.pos)
    // Running straight away from the camera, lean the body up to ~30 degrees
    // back toward it: a cross-step that keeps a cheek and an eye in view
    // instead of a full back, the half of the model nobody drew.
    const toCamYaw = Math.atan2(this.cameraPos.x - this.pos.x, this.cameraPos.z - this.pos.z)
    const off = wrap(this.heading - toCamYaw)
    const away = Math.max(0, (Math.abs(off) - Math.PI * 0.6) / (Math.PI * 0.4))
    const bias = away * 0.5 * this.loco * (off >= 0 ? -1 : 1)
    this.visualHeading += wrap(this.heading + bias - this.visualHeading) * (1 - Math.exp(-14 * dt))
    this.hero.root.rotation.y = this.visualHeading
    this.heroBlob.position.set(this.pos.x, 0.006, this.pos.z)
    const lift = Math.max(0, this.pos.y)
    this.heroBlob.scale.setScalar(Math.max(0.9, this.hero.width * 0.55) * (1 - Math.min(0.5, lift * 0.3)))
  }

  private jump() {
    this.grounded = false
    this.vy = JUMP_V
    this.attack = null
    this.stats.jumps++
    this.sfx.jump()
    // Jump_2 opens on the tucked, airborne pose and ends in a landing crouch;
    // its crouch is timed to the floor in updateHero.
    this.moves.play('jump', { mask: 'full', from: 0.2, to: 1.0, speed: 1.15, fadeIn: 0.06, hold: true })
  }

  private punch() {
    const t = this.time
    if (this.attack && this.attack.t < 0.2) return // still winding the last one
    this.chain = t < this.chainUntil ? (this.chain + 1) % 3 : 0
    this.chainUntil = t + 0.75
    const move: MoveId = this.chain === 0 ? 'jabL' : this.chain === 1 ? 'jabR' : 'cross'
    const moving = this.loco > 0.35
    // Auto-aim: snap toward the best target in reach so a child's rough aim
    // still connects. Proportions do not matter — reach is from the capsule.
    const target = this.nearest(['robot', 'crate', 'balloon', 'gold'], this.radius + 1.7, true)
    if (target) {
      this.targetHeading = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z)
      // A little lunge into it.
      const d = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z)
      const step = Math.max(0, d - (this.radius + target.radius + 0.35))
      if (step > 0) {
        const s = Math.min(step, 0.9) * 7
        this.vel.x += Math.sin(this.targetHeading) * s
        this.vel.z += Math.cos(this.targetHeading) * s
      }
    }
    if (move === 'cross') this.moves.play('cross', { mask: moving ? 'upper' : 'full', from: 0.12, to: 0.95, speed: 1.9 })
    else this.moves.play(move, { mask: moving ? 'upper' : 'full', from: 0.05, to: 0.72, speed: 1.8 })
    this.attack = { move, t: 0, hitAt: move === 'cross' ? 0.16 : 0.12, done: false, reach: move === 'cross' ? 1.05 : 0.9 }
    this.stats.punches++
    this.sfx.whoosh()
  }

  private resolvePunch(a: Attack) {
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
    const hits: { th: Thing; d: number }[] = []
    for (const th of this.things) {
      if (th.dead || th.dying || th.kind === 'ball') continue
      const dx = th.pos.x - this.pos.x, dz = th.pos.z - this.pos.z
      const d = Math.hypot(dx, dz)
      const reach = this.radius + th.radius + a.reach
      if (d > reach) continue
      // Balloons float: only the ones low enough to punch, or any when jumping.
      if ((th.kind === 'balloon' || th.kind === 'gold') && th.pos.y > 2.0 + this.pos.y) continue
      const cos = d < 1e-3 ? 1 : (dx * fwd.x + dz * fwd.z) / d
      if (cos < 0.25 && d > this.radius + th.radius * 0.6) continue
      hits.push({ th, d })
    }
    hits.sort((p, q) => p.d - q.d)
    for (const { th } of hits.slice(0, a.move === 'cross' ? 3 : 2)) this.hit(th, fwd, a.move === 'cross' ? 2 : 1)
  }

  private startPound() {
    this.pounding = true
    this.attack = null
    this.vy = Math.min(this.vy, 0) - 15
    this.moves.play('pound', { mask: 'full', from: 0.42, to: 1.6, speed: 1.5, fadeIn: 0.05, fadeOut: 0.2 })
    this.sfx.whoosh()
  }

  private landPound() {
    this.pounding = false
    this.lockUntil = this.time + 0.3
    this.vel.multiplyScalar(0.2)
    this.stats.slams++
    this.shock.fire(this.pos, POUND_RADIUS)
    this.particles.burst(this.pos.clone().setY(0.1), 26, [PAL.sun, 0xffffff, PAL.grape], 6, 2)
    this.sfx.slam()
    this.ev.shake(0.5)
    this.ev.hitStop(0.06)
    navigator.vibrate?.(40)
    let n = 0
    for (const th of this.things) {
      if (th.dead || th.dying || th.kind === 'ball') continue
      const d = Math.hypot(th.pos.x - this.pos.x, th.pos.z - this.pos.z)
      if (d > POUND_RADIUS + th.radius) continue
      if ((th.kind === 'balloon' || th.kind === 'gold') && th.pos.y > 1.8) continue
      const away = new THREE.Vector3(th.pos.x - this.pos.x, 0, th.pos.z - this.pos.z).normalize()
      this.hit(th, away, 3)
      n++
    }
    if (n >= 3) this.ev.popup(this.pos.clone().setY(this.hero.height + 0.3), `SMASH x${n}!`, 'combo')
  }

  /** Something got hit: score it, pop it, make it feel like it. */
  private hit(th: Thing, dir: THREE.Vector3, power: number) {
    th.hp -= power
    th.squash = 1
    const top = th.pos.clone().setY(th.kind === 'crate' ? 1.0 : th.kind === 'robot' ? 0.8 : th.pos.y)
    this.combo++
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo)
    this.comboUntil = this.time + COMBO_WINDOW
    const mult = this.multiplier
    if (th.hp > 0) {
      // A crate takes a few: it skids, and pays a little for each knock.
      th.vel.addScaledVector(dir, 2.2)
      const pts = 25 * mult
      this.score += pts
      this.ev.popup(top, `+${pts}`, 'score')
      this.particles.burst(top, 6, [PAL.sun, 0xffffff], 2.5, 2)
      this.sfx.hit(this.combo)
      this.ev.hitStop(0.035)
      this.ev.shake(0.12)
      return
    }
    th.dying = 0.001
    th.vel.copy(dir).multiplyScalar(th.kind === 'robot' ? 5 : 2).setY(th.kind === 'robot' ? 4.5 : 0)
    const pts = POINTS[th.kind] * mult
    this.score += pts
    if (th.kind === 'robot') {
      this.stats.robots++
      this.particles.burst(top, 18, [PAL.sun, PAL.red, PAL.grape, 0x2fa8e0], 4.5, 3)
      this.sfx.hit(this.combo)
      this.ev.shake(0.2)
    } else if (th.kind === 'crate') {
      this.stats.crates++
      this.particles.burst(top, 30, [PAL.sun, PAL.sunDeep, 0xffffff], 5, 4)
      this.sfx.crate()
      this.sfx.bonus()
      this.ev.shake(0.35)
    } else {
      this.stats.balloons++
      this.particles.burst(th.pos, 14, th.kind === 'gold' ? [PAL.sun, 0xffffff] : [PAL.red, PAL.grape, 0xffffff], 3, 1)
      this.sfx.pop()
      if (th.kind === 'gold') {
        this.time = Math.max(0, this.time - 5)
        this.sfx.bonus()
        this.ev.popup(top.clone().setY(top.y + 0.45), '+5 sec', 'bonus')
      }
    }
    this.ev.popup(top, `+${pts}`, 'score')
    if (this.combo >= 5 && this.combo % 5 === 0) this.ev.popup(this.pos.clone().setY(this.hero.height + 0.5), `COMBO x${this.multiplier}`, 'combo')
    this.ev.hitStop(0.05)
    navigator.vibrate?.(15)
  }

  private breakCombo() { this.combo = 0 }

  // ------------------------------------------------------------- the toys

  private nearest(kinds: Kind[], within: number, preferFront = false): Thing | null {
    let best: Thing | null = null
    let bestScore = Infinity
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
    for (const th of this.things) {
      if (th.dead || th.dying || !kinds.includes(th.kind)) continue
      if ((th.kind === 'balloon' || th.kind === 'gold') && th.pos.y > 2.0 + this.pos.y) continue
      const dx = th.pos.x - this.pos.x, dz = th.pos.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (d > within + th.radius) continue
      const cos = d < 1e-3 ? 1 : (dx * fwd.x + dz * fwd.z) / d
      // Between two targets, the one on the camera's side wins: turning to
      // it turns the face toward the player.
      const toCamX = this.cameraPos.x - this.pos.x, toCamZ = this.cameraPos.z - this.pos.z
      const camCos = d < 1e-3 ? 1 : (dx * toCamX + dz * toCamZ) / (d * (Math.hypot(toCamX, toCamZ) || 1))
      const score = d + (preferFront ? (1 - cos) * 0.5 + Math.max(0, -camCos) * 0.9 : 0)
      if (score < bestScore) { bestScore = score; best = th }
    }
    return best
  }

  private add(kind: Kind) {
    const th = makeThing(kind, this.rnd)
    this.things.push(th)
    this.root.add(th.obj)
    return th
  }

  private spawnThings() {
    const t = this.time
    const k = t / ROUND_SECONDS
    const live = (kind: Kind) => this.things.filter((x) => x.kind === kind && !x.dead && !x.dying).length
    const r = this.rnd

    if (t >= this.spawn.robot) {
      const n = k > 0.5 && r() < 0.35 ? 2 : 1
      for (let i = 0; i < n && live('robot') < 9; i++) {
        const th = this.add('robot')
        th.pos.set(ARENA.minX + 0.6 + r() * (ARENA.maxX - ARENA.minX - 1.2), 0, ARENA.maxZ + 1.0 + i * 0.5)
        const sp = 0.6 + 0.45 * k + r() * 0.15
        th.vel.set(0, 0, -sp)
      }
      this.spawn.robot = t + lerp(2.3, 0.85, k) * (0.8 + r() * 0.4)
    }
    if (t >= this.spawn.balloon) {
      if (live('balloon') < 4) {
        const th = this.add('balloon')
        th.pos.set(lerp(ARENA.minX + 0.8, ARENA.maxX - 0.8, r()), 0.2, lerp(FRONT_HALF, ARENA.maxZ - 0.6, r()))
        th.float = 1.15 + r() * 0.35
      }
      this.spawn.balloon = t + 2.8 + r() * 2
    }
    if (this.spawn.gold.length && t >= this.spawn.gold[0]) {
      this.spawn.gold.shift()
      const th = this.add('gold')
      th.pos.set(lerp(ARENA.minX + 1, ARENA.maxX - 1, r()), 0.2, lerp(FRONT_HALF, 2, r()))
      th.float = 1.25
    }
    if (t >= this.spawn.crate) {
      if (live('crate') < 2) {
        const th = this.add('crate')
        for (let tries = 0; tries < 8; tries++) {
          th.pos.set(lerp(ARENA.minX + 1, ARENA.maxX - 1, r()), 6, lerp(FRONT_HALF, ARENA.maxZ - 0.9, r()))
          if (Math.hypot(th.pos.x - this.pos.x, th.pos.z - this.pos.z) > 1.6) break
        }
        th.vel.set(0, 0, 0)
      }
      this.spawn.crate = t + 10 + r() * 3
    }
    if (t >= this.spawn.ball) {
      const side = r() < 0.5 ? -1 : 1
      const z = lerp(ARENA.minZ + 1.2, ARENA.maxZ - 0.6, r())
      const w = makeWarning()
      w.position.set(side * (ARENA.maxX - 0.5), 0.015, z)
      w.rotation.y = side > 0 ? Math.PI : 0
      this.root.add(w)
      this.warnings.push({ mesh: w, until: t + 0.9, side, z })
      this.spawn.ball = t + lerp(7, 3.6, k) * (0.85 + r() * 0.3)
    }
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i]
      w.mesh.visible = Math.floor(t * 8) % 2 === 0
      if (t < w.until) continue
      this.root.remove(w.mesh)
      this.warnings.splice(i, 1)
      const th = this.add('ball')
      th.dir = -w.side
      th.pos.set(w.side * (ARENA.maxX + 0.8), 0.4, w.z)
      th.vel.set(-w.side * (3.0 + 1.2 * k), 0, 0)
    }
  }

  private updateThings(dt: number) {
    const heroR = this.radius
    for (const th of this.things) {
      if (th.dead) continue
      th.age += dt
      th.phase += dt
      th.squash = Math.max(0, th.squash - dt * 5)

      if (th.dying) {
        th.dying += dt
        th.vel.y -= 14 * dt
        th.pos.addScaledVector(th.vel, dt)
        th.body.rotation.x += dt * 12
        const s = Math.max(0, 1 - th.dying / 0.35)
        th.body.scale.setScalar(th.kind === 'robot' ? 0.2 + 0.8 * s : s)
        th.blob.visible = false
        if (th.stealing) th.body.scale.setScalar(Math.max(0, 1 - th.dying / 0.6))
        if (th.dying > (th.stealing ? 0.6 : 0.35)) this.remove(th)
      } else if (th.kind === 'robot') {
        // March to the chest, steering round it rather than through it.
        const to = new THREE.Vector3(CHEST.x - th.pos.x, 0, CHEST.z + 0.7 - th.pos.z)
        const d = to.length()
        const sp = Math.hypot(th.vel.x, th.vel.z) || 0.8
        to.normalize().multiplyScalar(sp)
        th.vel.x += (to.x - th.vel.x) * (1 - Math.exp(-1.5 * dt))
        th.vel.z += (to.z - th.vel.z) * (1 - Math.exp(-1.5 * dt))
        th.pos.x += th.vel.x * dt
        th.pos.z += th.vel.z * dt
        th.obj.rotation.y = Math.atan2(th.vel.x, th.vel.z)
        // The wind-up waddle.
        th.body.rotation.z = Math.sin(th.phase * 9) * 0.12
        th.body.position.y = Math.abs(Math.sin(th.phase * 9)) * 0.05
        if (d < 0.9) this.steal(th)
      } else if (th.kind === 'balloon' || th.kind === 'gold') {
        const lifeLeft = 9 - th.age
        const goal = lifeLeft > 0 ? th.float! : th.float! + (-lifeLeft) * 2.5
        th.pos.y += (goal + Math.sin(th.phase * 2) * 0.1 - th.pos.y) * (1 - Math.exp(-2 * dt))
        th.pos.x += Math.sin(th.phase * 0.7) * 0.15 * dt
        th.body.rotation.z = Math.sin(th.phase * 1.7) * 0.12
        th.blob.position.y = -th.pos.y + 0.006
        th.blob.scale.setScalar(0.55 / (1 + th.pos.y * 0.3))
        if (th.pos.y > 6) this.remove(th)
        // Jump into one to pop it.
        if (!this.grounded && Math.hypot(th.pos.x - this.pos.x, th.pos.z - this.pos.z) < heroR + th.radius
          && Math.abs(th.pos.y - (this.pos.y + this.hero.height * 0.7)) < 0.8) {
          this.hit(th, new THREE.Vector3(0, 1, 0), 1)
        }
      } else if (th.kind === 'crate') {
        if (th.pos.y > 0) {
          th.vel.y -= 22 * dt
          th.pos.y = Math.max(0, th.pos.y + th.vel.y * dt)
          th.blob.position.y = -th.pos.y + 0.006
          th.blob.scale.setScalar(1.3 * (1 - Math.min(0.7, th.pos.y * 0.1)))
          if (th.pos.y === 0) {
            th.squash = 1
            this.particles.burst(th.pos.clone().setY(0.05), 10, [0xf1e3cc, 0xffffff], 2.5, 1)
            this.ev.shake(0.1)
            this.sfx.crate()
            th.blob.position.y = 0.006
            // Landing on the hero bumps them, but kindly: no damage.
            if (Math.hypot(th.pos.x - this.pos.x, th.pos.z - this.pos.z) < heroR + th.radius) {
              const away = new THREE.Vector3(this.pos.x - th.pos.x, 0, this.pos.z - th.pos.z).normalize()
              this.vel.addScaledVector(away, 4)
            }
          }
        } else {
          th.vel.x *= Math.exp(-4 * dt); th.vel.z *= Math.exp(-4 * dt)
          th.pos.x = THREE.MathUtils.clamp(th.pos.x + th.vel.x * dt, ARENA.minX + 0.5, ARENA.maxX - 0.5)
          th.pos.z = THREE.MathUtils.clamp(th.pos.z + th.vel.z * dt, ARENA.minZ + 0.5, ARENA.maxZ - 0.5)
        }
        th.body.rotation.z = Math.sin(th.phase * 30) * 0.08 * th.squash
      } else if (th.kind === 'ball') {
        th.pos.x += th.vel.x * dt
        const bounce = Math.abs(Math.sin(th.phase * 5.5))
        th.pos.y = 0.4 + bounce * 0.35
        th.body.rotation.z -= (th.vel.x / 0.4) * dt
        th.blob.position.y = -th.pos.y + 0.006
        if (Math.abs(th.pos.x) > ARENA.maxX + 1.5) this.remove(th)
        const dx = th.pos.x - this.pos.x, dz = th.pos.z - this.pos.z
        const near = Math.hypot(dx, dz) < heroR + th.radius
        if (near && this.pos.y < 0.45 && this.time >= this.invulnUntil && this.phase === 'play') this.hurt(th)
        else if (near && this.pos.y >= 0.45 && !th.jumped) {
          th.jumped = true
          const pts = POINTS.ball * this.multiplier
          this.score += pts
          this.ev.popup(this.pos.clone().setY(this.hero.height + 0.4), `Nice jump! +${pts}`, 'bonus')
          this.sfx.bonus()
        }
      }

      // Toys do not overlap the hero; robots are light and get shoved.
      if (!th.dying && th.kind !== 'ball' && th.kind !== 'balloon' && th.kind !== 'gold' && th.pos.y < 0.5) {
        const dx = th.pos.x - this.pos.x, dz = th.pos.z - this.pos.z
        const d = Math.hypot(dx, dz)
        const min = heroR + th.radius
        if (d < min && d > 1e-4) {
          const push = (min - d) / d
          if (th.kind === 'robot') {
            // A robot walks into the hero and stops there, still facing them:
            // a hero standing guard holds the line instead of being slipped past.
            th.pos.x += dx * push; th.pos.z += dz * push
            th.vel.multiplyScalar(Math.exp(-6 * (1 / 60)))
          }
          else { this.pos.x -= dx * push; this.pos.z -= dz * push }
        }
      }

      // Squash and stretch on every hit.
      if (!th.dying) {
        const s = th.squash
        th.body.scale.set(1 + 0.3 * s, 1 - 0.3 * s, 1 + 0.3 * s)
      }
      th.obj.position.set(th.pos.x, th.kind === 'robot' || th.kind === 'crate' ? th.pos.y : 0, th.pos.z)
      if (th.kind === 'balloon' || th.kind === 'gold' || th.kind === 'ball') th.body.position.y = th.pos.y
    }
    // Robots keep out of each other's way.
    const robots = this.things.filter((x) => x.kind === 'robot' && !x.dying && !x.dead)
    for (let i = 0; i < robots.length; i++) for (let j = i + 1; j < robots.length; j++) {
      const a = robots[i], b = robots[j]
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z
      const d = Math.hypot(dx, dz), min = a.radius + b.radius
      if (d < min && d > 1e-4) {
        const p = (min - d) / d / 2
        a.pos.x -= dx * p; a.pos.z -= dz * p; b.pos.x += dx * p; b.pos.z += dz * p
      }
    }
    if (this.things.length > 40) this.things.splice(0, this.things.length, ...this.things.filter((x) => !x.dead))
  }

  private steal(th: Thing) {
    th.dying = 0.001
    th.stealing = true
    th.vel.set((CHEST.x - th.pos.x) * 1.5, 5, (CHEST.z - th.pos.z) * 1.5)
    this.stats.stolen++
    this.world.bumpChest()
    this.sfx.steal()
    this.ev.popup(CHEST.clone().setY(1.5), 'Oh no!', 'bad')
    this.breakCombo()
  }

  private hurt(ball: Thing) {
    this.stats.hurt++
    this.hurtUntil = this.time + HURT_LOCK
    this.invulnUntil = this.time + INVULNERABLE
    this.attack = null
    const away = new THREE.Vector3(Math.sign(ball.vel.x) || 1, 0, (this.pos.z - ball.pos.z) * 2).normalize()
    this.vel.copy(away).multiplyScalar(5)
    this.targetHeading = Math.atan2(-away.x, -away.z)
    this.moves.play('hurt', { mask: 'full', from: 0.0, to: 0.83, speed: 1.4, fadeIn: 0.04, fadeOut: 0.15 })
    this.sfx.hurt()
    this.ev.shake(0.3)
    this.ev.popup(this.pos.clone().setY(this.hero.height + 0.3), 'Bonk!', 'bad')
    navigator.vibrate?.([30, 40, 30])
    this.breakCombo()
  }

  private remove(th: Thing) {
    th.dead = true
    this.root.remove(th.obj)
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))
function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
