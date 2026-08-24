import * as THREE from 'three'
import { CFG, laneX, roadWidth } from './config'
import { Track, type Entity } from '../world/track'
import { roadTexture, skyTexture } from '../world/materials'
import { Bursts, SpeedLines } from './effects'
import { clamp, damp, lerp, smoothstep } from '../core/math'
import { Input, type Action } from '../core/input'
import { Audio } from '../core/audio'
import type { Hero } from '../avatar/loader'

export type Phase = 'menu' | 'countdown' | 'running' | 'over'

/** Fixed simulation step. */
const STEP = 1 / 60

export interface Stats {
  score: number
  distance: number
  stars: number
  gates: number
  bestCombo: number
  hearts: number
  combo: number
  power: number
  heroTime: boolean
  speed: number
}

export interface GameEvents {
  onStats?: (s: Stats) => void
  onPhase?: (p: Phase) => void
  onToast?: (text: string, kind: 'good' | 'bad') => void
}

type PlayerState = 'run' | 'jump' | 'slide' | 'pose' | 'stumble' | 'fly'

export class Game {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private track: Track
  private bursts = new Bursts()
  private speedLines = new SpeedLines()
  private sun: THREE.DirectionalLight
  private shadowTarget = new THREE.Object3D()
  private heroShadow: THREE.Mesh

  phase: Phase = 'menu'
  hero: Hero | null = null
  /** Debug/testing knob: run the simulation faster than wall clock. */
  timeScale = 1
  /** Called after every fixed step — the automated play harness drives on this. */
  onStep: ((dt: number) => void) | null = null

  // Player
  private lane = 1
  private laneFrom = 1
  private laneT = 1
  private z = 0
  private y = 0
  private vy = 0
  private state: PlayerState = 'run'
  private stateTime = 0
  private invuln = 0
  private speed = CFG.speedStart
  private elapsed = 0

  private stats: Stats = {
    score: 0, distance: 0, stars: 0, gates: 0, bestCombo: 0,
    hearts: CFG.hearts, combo: 0, power: 0, heroTime: false, speed: 0,
  }
  private heroTimeLeft = 0
  private shake = 0
  private camPos = new THREE.Vector3(0, 3.2, -6)
  private camLook = new THREE.Vector3(0, 1.3, 6)
  private countdown = 0

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly input: Input,
    private audio: Audio,
    private events: GameEvents = {},
  ) {
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.4, 340)

    this.scene.background = new THREE.Color('#bfe4ff')
    this.scene.fog = new THREE.Fog('#dceeff', CFG.fogNear, CFG.fogFar)

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture('#5bb8f5', '#bfe4ff'), side: THREE.BackSide, fog: false }),
    )
    this.scene.add(sky)

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb8a8, 2.0))
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.0)
    this.sun.position.set(6, 14, 6)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 60
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera
    cam.left = -16; cam.right = 16; cam.top = 20; cam.bottom = -14
    cam.updateProjectionMatrix()
    this.sun.shadow.bias = -0.0012
    this.scene.add(this.sun)
    this.scene.add(this.shadowTarget)
    this.sun.target = this.shadowTarget

    this.track = new Track(roadTexture(CFG.lanes, CFG.laneWidth, CFG.shoulder))
    this.scene.add(this.track.group)
    this.scene.add(this.bursts.group)

    // A soft blob under the hero so jumps read clearly even in flat light.
    this.heroShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: '#3a5030', transparent: true, opacity: 0.28, depthWrite: false }),
    )
    this.heroShadow.rotation.x = -Math.PI / 2
    this.heroShadow.position.y = 0.012
    this.scene.add(this.heroShadow)

    this.camera.add(this.speedLines.group)
    this.scene.add(this.camera)
  }

  setHero(hero: Hero) {
    if (this.hero) { this.scene.remove(this.hero.root); this.hero.dispose() }
    this.hero = hero
    this.scene.add(hero.root)
    hero.root.position.set(laneX(this.lane), 0, this.z)
    this.heroShadow.scale.setScalar(Math.max(0.8, hero.radius * 2.4))
    this.applyPresentationPose()
  }

  /** Menu framing: hero idles, camera in a slow orbit in front of them. */
  private applyPresentationPose() {
    if (!this.hero) return
    this.hero.animator.setState('idle')
    this.hero.animator.reset()
  }

  private portrait = false

  /**
   * On the menu and score screens a card covers the middle of the screen, so
   * the hero is framed off to the side (landscape) or high up (portrait).
   */
  private presentationOffset(): [number, number] {
    return this.portrait ? [0, -0.95] : [-1.85, 0]
  }

  resize(w: number, h: number) {
    this.portrait = h > w
    this.camera.aspect = w / h
    // Keep the hero comfortably in frame on tall phone screens.
    this.camera.fov = h > w ? 72 : 58
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  start() {
    this.lane = this.laneFrom = 1
    this.laneT = 1
    this.z = 0; this.y = 0; this.vy = 0
    this.speed = CFG.speedStart
    this.state = 'run'; this.stateTime = 0; this.invuln = 0
    this.heroTimeLeft = 0; this.shake = 0; this.elapsed = 0
    this.stats = {
      score: 0, distance: 0, stars: 0, gates: 0, bestCombo: 0,
      hearts: CFG.hearts, combo: 0, power: 0, heroTime: false, speed: CFG.speedStart,
    }
    this.track.reset((Math.random() * 0xffffffff) >>> 0)
    this.input.clear()
    this.countdown = 3.2
    this.setPhase('countdown')
    if (this.hero) {
      this.hero.root.position.set(laneX(1), 0, 0)
      this.hero.animator.setState('idle')
    }
    this.emitStats()
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.events.onPhase?.(p)
  }

  private emitStats() { this.events.onStats?.({ ...this.stats }) }

  private get difficulty() {
    return clamp(this.stats.distance / CFG.speedRampDistance, 0, 1)
  }

  private handle(action: Action) {
    if (this.state === 'stumble') return
    switch (action) {
      case 'left':
        if (this.lane > 0 && this.laneT > 0.45) this.changeLane(this.lane - 1)
        break
      case 'right':
        if (this.lane < CFG.lanes - 1 && this.laneT > 0.45) this.changeLane(this.lane + 1)
        break
      case 'jump':
        if (this.state === 'fly') break
        if (this.y <= 0.02 || this.state === 'slide') {
          this.state = 'jump'; this.stateTime = 0
          this.vy = (2 * CFG.jumpHeight) / (CFG.jumpTime / 2)
          this.audio.jump()
        }
        break
      case 'slide':
        if (this.state === 'fly') break
        this.state = 'slide'; this.stateTime = 0
        if (this.y > 0.02) this.vy = -14   // slam down out of a jump
        this.audio.slide()
        break
      case 'pose':
        if (this.state === 'fly') break
        if (this.y <= 0.02) { this.state = 'pose'; this.stateTime = 0; this.audio.pose() }
        break
    }
  }

  private changeLane(to: number) {
    this.laneFrom = this.currentLaneX()
    this.lane = to
    this.laneT = 0
    if (this.hero) this.hero.animator.lean = to > this.laneFrom ? 1 : -1
  }

  private currentLaneX(): number {
    return this.laneT >= 1 ? laneX(this.lane) : lerp(this.laneFrom, laneX(this.lane), smoothstep(this.laneT))
  }

  private breakCombo() {
    this.stats.combo = 0
  }

  private addScore(n: number) { this.stats.score += n }

  private triggerHeroTime() {
    this.heroTimeLeft = CFG.powerDuration
    this.stats.power = 0
    this.stats.heroTime = true
    this.state = 'fly'
    this.stateTime = 0
    this.audio.powerUp()
    this.events.onToast?.('HERO TIME!', 'good')
  }

  private crash(e: Entity) {
    if (this.invuln > 0 || this.state === 'fly') return
    this.stats.hearts -= 1
    this.invuln = CFG.invulnTime
    this.state = 'stumble'
    this.stateTime = 0
    this.shake = 1
    this.breakCombo()
    this.audio.crash()
    const p = e.object.position.clone(); p.y = 1
    this.bursts.emit(p, 12, '#ff7a5c', 6, 0.6)
    if (this.stats.hearts <= 0) {
      this.gameOver()
    } else {
      this.events.onToast?.('OUCH!', 'bad')
    }
    this.emitStats()
  }

  private gameOver() {
    this.setPhase('over')
    // invuln only ticks down while running, so leaving it set would blink the
    // hero in and out for the whole score screen.
    this.invuln = 0
    this.shake = 0
    this.y = 0
    this.state = 'run'
    this.audio.gameOver()
    this.audio.setMusic(false)
    if (this.hero) this.hero.animator.setState('victory')
  }

  private collide() {
    if (!this.hero) return
    const px = this.currentLaneX()
    const flying = this.state === 'fly'

    for (const e of this.track.entities) {
      if (e.done) continue
      const dz = e.z - this.z
      if (dz > 2.2 || dz < -2.2) continue

      if (e.kind === 'star') {
        const magnet = flying ? CFG.magnetRadius : 1.25
        const dx = e.object.position.x - px
        const near = Math.abs(dz) < (flying ? magnet : 1.0) && Math.abs(dx) < magnet * (flying ? 1 : 0.9)
        const dy = e.object.position.y - (this.y + 1.0)
        if (near && (flying || (Math.abs(dx) < 1.05 && Math.abs(dy) < 1.5))) {
          e.done = true
          e.object.visible = false
          this.stats.stars += 1
          this.stats.combo += 1
          this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo)
          this.addScore(CFG.scorePerStar * (1 + Math.floor(this.stats.combo / 10)))
          if (!flying) this.stats.power = Math.min(1, this.stats.power + CFG.powerPerStar)
          this.audio.star(this.stats.combo)
          this.bursts.emit(e.object.position, 4, '#ffd23f', 4, 0.4)
          if (this.stats.power >= 1 && !this.stats.heroTime) this.triggerHeroTime()
        }
        continue
      }

      if (Math.abs(dz) > 0.85) continue

      if (e.kind === 'gate') {
        if (this.state === 'pose' || flying) {
          e.done = true
          this.stats.gates += 1
          this.stats.combo += 2
          this.addScore(CFG.scorePerGate)
          if (!flying) this.stats.power = Math.min(1, this.stats.power + CFG.powerPerGate)
          this.audio.gate()
          this.bursts.emit(new THREE.Vector3(px, 1.7, e.z), 14, '#a678e2', 7, 0.7)
          this.events.onToast?.('PERFECT POSE!', 'good')
          if (this.stats.power >= 1 && !this.stats.heroTime) this.triggerHeroTime()
        } else {
          e.done = true
          this.crash(e)
        }
        continue
      }

      // Lane obstacles: only collide if we're actually in that lane.
      if (Math.abs(e.object.position.x - px) > 1.15) continue

      const cleared =
        flying ||
        (e.kind === 'low' && this.y > 0.72) ||
        (e.kind === 'high' && this.state === 'slide')

      if (cleared) {
        if (!e.done) {
          e.done = true
          this.stats.combo += 1
          this.addScore(15)
          this.stats.power = Math.min(1, this.stats.power + 0.02)
        }
      } else {
        e.done = true
        this.crash(e)
      }
    }
  }

  private updatePlayer(dt: number) {
    this.stateTime += dt
    if (this.invuln > 0) this.invuln -= dt

    // Vertical
    if (this.state === 'fly') {
      this.y = damp(this.y, CFG.powerFlightHeight, 4, dt)
      this.vy = 0
    } else {
      const grav = (8 * CFG.jumpHeight) / (CFG.jumpTime * CFG.jumpTime)
      this.vy -= grav * dt
      this.y += this.vy * dt
      if (this.y <= 0) {
        if (this.vy < -3 && this.state === 'jump') this.audio.land()
        this.y = 0
        this.vy = 0
        if (this.state === 'jump') { this.state = 'run'; this.stateTime = 0 }
      }
    }

    // Timed states expire back into the run
    if (this.state === 'slide' && this.stateTime > CFG.slideTime) { this.state = 'run'; this.stateTime = 0 }
    if (this.state === 'pose' && this.stateTime > CFG.poseTime) { this.state = 'run'; this.stateTime = 0 }
    if (this.state === 'stumble' && this.stateTime > CFG.stumbleTime) { this.state = 'run'; this.stateTime = 0 }

    // Lane interpolation
    if (this.laneT < 1) this.laneT = Math.min(1, this.laneT + dt / CFG.laneChangeTime)

    // Hero Time owns the player state outright — nothing else may run while
    // the hero is airborne, or the pose and the camera disagree.
    if (this.heroTimeLeft > 0) {
      this.state = 'fly'
      this.heroTimeLeft -= dt
      if (this.heroTimeLeft <= 0) {
        this.stats.heroTime = false
        this.state = 'run'
        this.stateTime = 0
        this.audio.powerDown()
      }
    }

    // Speed and distance
    const target = lerp(CFG.speedStart, CFG.speedMax, this.difficulty) * (this.stats.heroTime ? 1.45 : 1)
    const slow = this.state === 'stumble' ? 0.55 : 1
    this.speed = damp(this.speed, target * slow, 2.4, dt)
    const advance = this.speed * dt
    this.z += advance
    this.stats.distance += advance
    this.stats.speed = this.speed
    this.addScore(advance * CFG.scorePerMetre)
  }

  private updateHeroVisual(dt: number) {
    const hero = this.hero
    if (!hero) return
    const a = hero.animator
    a.setIntensity(clamp((this.speed - CFG.speedStart) / (CFG.speedMax - CFG.speedStart), 0, 1))

    if (this.phase === 'running') {
      switch (this.state) {
        case 'jump':
          a.setState('jump')
          // 0 at launch, 1 at apex, 2 approaching the ground.
          a.jumpProgress = clamp(1 - this.vy / ((2 * CFG.jumpHeight) / (CFG.jumpTime / 2)), 0, 2)
          break
        case 'slide': a.setState('slide'); break
        case 'pose': a.setState('pose'); break
        case 'stumble': a.setState('stumble'); break
        case 'fly': a.setState('fly'); break
        default: a.setState('run'); a.advanceStride(this.speed * dt)
      }
    } else if (this.phase === 'countdown') {
      a.setState('idle')
    }

    const x = this.currentLaneX()
    hero.root.position.set(x, this.y, this.z)
    // Face slightly into the lane change, and bank when flying.
    const drift = (laneX(this.lane) - x) * 0.6
    hero.root.rotation.y = damp(hero.root.rotation.y, -drift, 12, dt)
    hero.root.rotation.z = damp(hero.root.rotation.z, this.state === 'fly' ? Math.sin(this.elapsed * 1.6) * 0.12 : 0, 4, dt)

    // Blink while invulnerable — off only a third of the time, so the hero
    // still reads during the stumble instead of vanishing.
    const blink = this.invuln > 0 && Math.floor(this.invuln * 15) % 3 === 0
    hero.root.visible = !blink

    this.heroShadow.position.set(x, 0.012, this.z)
    const shadowFade = clamp(1 - this.y / 3.4, 0.06, 1)
    ;(this.heroShadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * shadowFade
    this.heroShadow.scale.setScalar(Math.max(0.8, hero.radius * 2.4) * (0.55 + 0.45 * shadowFade))

    a.update(dt, this.elapsed)
    hero.vrm.update(dt)
  }

  private updateCamera(dt: number) {
    const x = this.currentLaneX()
    let desired: THREE.Vector3
    let look: THREE.Vector3

    if (this.phase === 'menu' || this.phase === 'countdown') {
      // Slow hero-shot orbit in front of the avatar.
      const a = this.elapsed * 0.28
      const [ox, oy] = this.presentationOffset()
      desired = new THREE.Vector3(x + Math.sin(a) * 1.2 + ox, 1.30 + Math.sin(a * 0.7) * 0.18, this.z + 3.3)
      look = new THREE.Vector3(x + ox * 0.95, 0.92 + oy, this.z)
    } else if (this.stats.heroTime) {
      // Swing to a heroic three-quarter front angle so the flight pose reads.
      const a = 0.72 + Math.sin(this.elapsed * 0.6) * 0.22
      desired = new THREE.Vector3(x + Math.sin(a) * 3.9, this.y + 1.5, this.z + 4.1)
      look = new THREE.Vector3(x, this.y + 0.75, this.z + 0.6)
    } else if (this.phase === 'over') {
      const a = this.elapsed * 0.5
      const [ox, oy] = this.presentationOffset()
      desired = new THREE.Vector3(x + Math.sin(a) * 1.5 + ox, 1.45, this.z + 3.5)
      look = new THREE.Vector3(x + ox * 0.95, 0.95 + oy, this.z)
    } else {
      const back = 5.0 + this.speed * 0.09
      const high = 2.80 + this.y * 0.40 + this.speed * 0.018
      desired = new THREE.Vector3(x * 0.72, high, this.z - back)
      look = new THREE.Vector3(x * 0.62, 1.45 + this.y * 0.55, this.z + 12)
    }

    const rate = this.phase === 'running' ? 9 : 3.2
    this.camPos.set(
      damp(this.camPos.x, desired.x, rate, dt),
      damp(this.camPos.y, desired.y, rate, dt),
      damp(this.camPos.z, desired.z, rate * 1.6, dt),
    )
    this.camLook.set(
      damp(this.camLook.x, look.x, rate, dt),
      damp(this.camLook.y, look.y, rate, dt),
      damp(this.camLook.z, look.z, rate * 1.6, dt),
    )

    const speedT = clamp((this.speed - CFG.speedStart) / (CFG.speedMax - CFG.speedStart), 0, 1)
    const baseFov = this.portrait ? 72 : 58
    const wantFov = this.phase === 'running' ? baseFov + speedT * 7 + (this.stats.heroTime ? 5 : 0) : baseFov
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, wantFov, 3, dt)
      this.camera.updateProjectionMatrix()
    }

    this.camera.position.copy(this.camPos)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6)
      const s = this.shake * this.shake * 0.34
      this.camera.position.x += (Math.random() - 0.5) * s
      this.camera.position.y += (Math.random() - 0.5) * s
    }
    this.camera.lookAt(this.camLook)

    this.shadowTarget.position.set(x, 0, this.z + 4)
    this.sun.position.set(x + 8, 18, this.z + 12)
  }

  /**
   * Simulation runs at a fixed 60 Hz regardless of how slow the frame is, so a
   * struggling phone (or a software-rendered test browser) can never let the
   * player tunnel through an obstacle between two frames.
   */
  update(frameDt: number) {
    const scaled = Math.min(0.25, frameDt) * this.timeScale
    const steps = Math.max(1, Math.min(16, Math.ceil(scaled / STEP)))
    const h = scaled / steps
    for (let i = 0; i < steps; i++) this.step(h)
    this.renderer.render(this.scene, this.camera)
  }

  private step(dt: number) {
    this.elapsed += dt

    for (const action of this.input.drain()) {
      if (this.phase === 'running') this.handle(action)
    }

    if (this.phase === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.setPhase('running')
        this.audio.setMusic(true)
      }
    }

    if (this.phase === 'running') {
      this.updatePlayer(dt)
      this.collide()
      this.audio.updateMusic(dt, this.difficulty)
      this.emitStats()
    }

    this.track.update(this.z, this.difficulty, dt)
    this.updateHeroVisual(dt)
    this.bursts.update(dt)
    this.speedLines.update(dt, this.stats.heroTime ? 1 : 0)
    this.updateCamera(dt)
    this.onStep?.(dt)
  }

  get countdownValue() { return Math.ceil(this.countdown) }
  get currentStats(): Stats { return { ...this.stats } }

  /** Steer to an absolute lane — used by Hero Cam, which reads position not taps. */
  requestLane(lane: number) {
    if (this.phase !== 'running' || this.state === 'stumble') return
    const target = clamp(Math.round(lane), 0, CFG.lanes - 1)
    if (target !== this.lane && this.laneT > 0.45) this.changeLane(target)
  }

  /** Read-only view of live gameplay state, for the automated play harness. */
  debugSnapshot() {
    return {
      z: this.z,
      x: this.currentLaneX(),
      lane: this.lane,
      y: this.y,
      state: this.state,
      entities: this.track.entities
        .filter((e) => !e.done && e.z > this.z - 2 && e.z < this.z + 40)
        .map((e) => ({ kind: e.kind, z: e.z, x: e.object.position.x })),
    }
  }
}
