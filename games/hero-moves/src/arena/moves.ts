import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { loadRetargeted } from '../anim/clips'
import { animUrl } from '../anim/files'

/**
 * The hero's moves in Robot Rumble, and the mixer that layers them.
 *
 * Every clip is real CC0 mocap from Quaternius' Universal Animation Library,
 * retargeted rotation-only by `src/anim/retarget.ts` — so a punch lands the
 * same on a tall human, a panda and a penguin made of cubes.
 *
 * The rig is split in two halves, upper and lower body. Running owns the legs
 * while a jab owns the arms, which is what lets a hero punch on the move
 * without its legs freezing mid-stride. Weights are set by hand every frame
 * rather than with the mixer's cross-fades, so the result is deterministic
 * and the same at 20 fps and 120.
 */

export type MoveId = 'idle' | 'run' | 'jabL' | 'jabR' | 'cross' | 'jump' | 'pound' | 'hurt' | 'victory' | 'dance'

export const MOVE_FILES: Record<MoveId, string> = {
  idle: 'Fighting_Idle.glb',
  run: 'Run_Anime.glb',
  jabL: 'Fighting_Left_Jab.glb',
  jabR: 'Fighting_Right_Jab.glb',
  cross: 'Punch_Cross.glb',
  jump: 'Jump_2.glb',
  pound: 'Attack_Ground_Pound.glb',
  hurt: 'Hit_Knockback.glb',
  victory: 'Victory.glb',
  dance: 'Dance_Charleston.glb',
}

const UPPER: VRMHumanBoneName[] = [
  'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
]

type Half = 'upper' | 'lower'
interface Pair { upper: THREE.AnimationAction; lower: THREE.AnimationAction }

export interface ShotOpts {
  /** Upper body only (legs keep running) or the whole body. */
  mask?: 'upper' | 'full'
  /** Playback rate. */
  speed?: number
  /** Start and end, in clip seconds. */
  from?: number
  to?: number
  /** Seconds to blend in and out. */
  fadeIn?: number
  fadeOut?: number
  /** Hold the last frame instead of handing back (the end-of-round pose). */
  hold?: boolean
  loop?: boolean
}

interface Shot {
  id: MoveId
  pair: Pair
  mask: 'upper' | 'full'
  speed: number
  from: number
  to: number
  fadeIn: number
  fadeOut: number
  hold: boolean
  loop: boolean
  /** Clip time now. */
  t: number
  /** Seconds since it started, for the fade in. */
  age: number
}

export class Moves {
  readonly mixer: THREE.AnimationMixer
  private pairs = new Map<MoveId, Pair>()
  private shot: Shot | null = null
  private loco = 0
  private runPhase = 0
  private clock = 0
  ready = false

  constructor(private vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene)
  }

  /**
   * Load and bind every move. A move that fails to load is skipped, never
   * fatal: a hero without a hurt clip still plays the game.
   */
  async load(): Promise<number> {
    const upperNames = new Set(UPPER.map((b) => this.vrm.humanoid.getNormalizedBoneNode(b)?.name).filter(Boolean) as string[])
    const entries = Object.entries(MOVE_FILES) as [MoveId, string][]
    const done = await Promise.all(entries.map(async ([id, file]) => {
      try {
        const { clip } = await loadRetargeted(animUrl(file), this.vrm)
        const isUpper = (t: THREE.KeyframeTrack) => upperNames.has(t.name.slice(0, t.name.lastIndexOf('.')))
        const upper = new THREE.AnimationClip(`${id}:upper`, clip.duration, clip.tracks.filter(isUpper))
        const lower = new THREE.AnimationClip(`${id}:lower`, clip.duration, clip.tracks.filter((t) => !isUpper(t)))
        const pair: Pair = { upper: this.mixer.clipAction(upper), lower: this.mixer.clipAction(lower) }
        for (const a of [pair.upper, pair.lower]) {
          a.play()
          a.setEffectiveWeight(0)
          a.timeScale = 0 // time is driven by hand in update()
        }
        this.pairs.set(id, pair)
        return true
      } catch (err) {
        console.warn(`move ${id} unavailable:`, (err as Error).message)
        return false
      }
    }))
    this.ready = this.pairs.has('idle')
    return done.filter(Boolean).length
  }

  has(id: MoveId) { return this.pairs.has(id) }
  duration(id: MoveId) { return this.pairs.get(id)?.upper.getClip().duration ?? 0 }
  get playing(): MoveId | null { return this.shot?.id ?? null }
  /** Clip time of the move playing now. */
  get time() { return this.shot?.t ?? 0 }

  /** 0 = standing, 1 = full run. Smoothed by the caller. */
  setLocomotion(speed01: number) { this.loco = THREE.MathUtils.clamp(speed01, 0, 1) }

  play(id: MoveId, o: ShotOpts = {}) {
    const pair = this.pairs.get(id)
    if (!pair) return false
    const dur = pair.upper.getClip().duration
    this.shot = {
      id, pair,
      mask: o.mask ?? 'full',
      speed: o.speed ?? 1,
      from: o.from ?? 0,
      to: Math.min(o.to ?? dur, dur),
      fadeIn: o.fadeIn ?? 0.08,
      fadeOut: o.fadeOut ?? 0.15,
      hold: o.hold ?? false,
      loop: o.loop ?? false,
      t: o.from ?? 0,
      age: 0,
    }
    return true
  }

  stop() { this.shot = null }

  update(dt: number) {
    const idle = this.pairs.get('idle')
    const run = this.pairs.get('run')
    // The base layer: idle and run blended by speed, run's cadence by speed.
    const runDur = run?.upper.getClip().duration ?? 1
    this.runPhase = (this.runPhase + dt * (0.55 + 0.75 * this.loco) / runDur) % 1
    const idleDur = idle?.upper.getClip().duration ?? 1
    this.clock += dt
    const idleT = this.clock % idleDur

    let shotW: Record<Half, number> = { upper: 0, lower: 0 }
    const s = this.shot
    if (s) {
      s.age += dt
      s.t += dt * s.speed
      if (s.t >= s.to) {
        if (s.loop) s.t = s.from + ((s.t - s.from) % Math.max(1e-3, s.to - s.from))
        else if (s.hold) s.t = s.to
      }
      const fin = Math.min(1, s.age / Math.max(1e-3, s.fadeIn))
      const left = s.to - s.t
      const fout = s.loop || s.hold ? 1 : Math.min(1, left / Math.max(1e-3, s.fadeOut * s.speed))
      const w = Math.max(0, Math.min(fin, fout))
      shotW = { upper: w, lower: s.mask === 'full' ? w : 0 }
      if (!s.loop && !s.hold && s.t >= s.to) { this.shot = null; shotW = { upper: 0, lower: 0 } }
    }

    for (const half of ['upper', 'lower'] as Half[]) {
      const base = 1 - shotW[half]
      if (idle) { idle[half].time = idleT; idle[half].setEffectiveWeight(base * (1 - this.loco)) }
      if (run) { run[half].time = this.runPhase * runDur; run[half].setEffectiveWeight(base * this.loco) }
    }
    for (const [id, pair] of this.pairs) {
      if (id === 'idle' || id === 'run') continue
      const on = this.shot && this.shot.id === id
      pair.upper.setEffectiveWeight(on ? shotW.upper : 0)
      pair.lower.setEffectiveWeight(on ? shotW.lower : 0)
      if (on) {
        const t = Math.min(this.shot!.t, pair.upper.getClip().duration - 1e-3)
        pair.upper.time = t; pair.lower.time = t
      }
    }
    this.mixer.update(0)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.pairs.clear()
  }
}
