import * as THREE from 'three'
import { damp, setEuler, clamp } from '../core/math'
import { BONES, type BoneName, type Pose, Rig } from './rig'
import {
  idlePose, runPose, jumpPose, slidePose, starPose, flyPose, stumblePose, victoryPose,
} from './poses'

export type AnimState = 'idle' | 'run' | 'jump' | 'slide' | 'pose' | 'fly' | 'stumble' | 'victory'

/** How fast each state snaps in. Reads as weight: reactions are fast, idle drifts. */
const BLEND_RATE: Record<AnimState, number> = {
  idle: 6, run: 15, jump: 22, slide: 20, pose: 24, fly: 9, stumble: 20, victory: 7,
}

/**
 * Drives the normalized humanoid rig from procedural poses. Everything is
 * rotation-only, which is what keeps a 30%-head crayon superhero and a
 * five-pointed star both looking deliberate rather than broken.
 */
export class Animator {
  state: AnimState = 'idle'
  /** Stride phase, advanced by distance travelled rather than by time. */
  phase = 0
  private stateTime = 0
  private target = new Map<BoneName, THREE.Quaternion>()
  private current = new Map<BoneName, THREE.Quaternion>()
  private tmp = new THREE.Quaternion()
  private hipsOffset = 0
  private hipsOffsetTarget = 0

  /** Extra state the poses need but don't own. */
  jumpProgress = 0     // 0 launch → 1 apex → 2 landing
  intensity = 0        // 0..1, scales stride amplitude with game speed
  lean = 0             // -1..1 lane-change bank, applied additively

  constructor(private rig: Rig) {
    for (const b of BONES) {
      this.target.set(b, new THREE.Quaternion())
      this.current.set(b, new THREE.Quaternion())
    }
  }

  setState(s: AnimState) {
    if (this.state === s) return
    this.state = s
    this.stateTime = 0
  }

  /** Advance the stride by distance so footfalls stay locked to ground speed. */
  advanceStride(metres: number) {
    const strideLength = 2.05 + 1.5 * this.intensity
    this.phase = (this.phase + metres / strideLength) % 1
  }

  private buildPose(t: number): Pose {
    switch (this.state) {
      case 'run': return runPose(this.phase, this.intensity)
      case 'jump': return jumpPose(this.jumpProgress)
      case 'slide': return slidePose(t)
      case 'pose': return starPose(t)
      case 'fly': return flyPose(t)
      case 'stumble': return stumblePose(t)
      case 'victory': return victoryPose(t)
      default: return idlePose(t)
    }
  }

  private hipsDrop(): number {
    switch (this.state) {
      case 'slide': return -0.42
      case 'pose': return 0.04
      case 'fly': return 0.10
      case 'victory': return -0.02
      case 'run': return -0.05 - 0.06 * Math.abs(Math.sin(this.phase * Math.PI * 2))
      default: return 0
    }
  }

  update(dt: number, elapsed: number) {
    this.stateTime += dt
    const pose = this.buildPose(this.state === 'run' ? elapsed : this.stateTime)
    const rate = BLEND_RATE[this.state]
    const leanZ = -this.lean * 0.30

    for (const b of BONES) {
      const node = this.rig.nodes.get(b)
      if (!node) continue
      const e = pose[b]
      const tq = this.target.get(b)!
      if (e) {
        // Bank the torso into a lane change on top of whatever the state wants.
        const extraZ = b === 'hips' ? leanZ : b === 'spine' ? leanZ * 0.55 : b === 'chest' ? leanZ * 0.35 : 0
        const extraY = b === 'hips' ? -this.lean * 0.10 : 0
        setEuler(tq, e[0], e[1] + extraY, e[2] + extraZ)
      } else {
        tq.identity()
      }
      const cq = this.current.get(b)!
      cq.slerp(this.tmp.copy(tq), 1 - Math.exp(-rate * dt))
      node.quaternion.copy(cq)
    }

    this.hipsOffsetTarget = this.hipsDrop()
    this.hipsOffset = damp(this.hipsOffset, this.hipsOffsetTarget, rate, dt)
    const hips = this.rig.nodes.get('hips')
    if (hips) hips.position.y = this.rig.hipsRestY + this.hipsOffset

    this.lean = damp(this.lean, 0, 7, dt)
  }

  /** Snap the whole rig to its current target — used when swapping avatars. */
  reset() {
    for (const b of BONES) this.current.get(b)!.copy(this.target.get(b)!)
    this.hipsOffset = this.hipsOffsetTarget
  }

  setIntensity(v: number) { this.intensity = clamp(v, 0, 1) }
}
