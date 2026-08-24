import * as THREE from 'three'
import { clamp } from '../core/math'
import type { KeypointName, Skeleton } from './keypoints'
import type { Rig } from '../avatar/rig'

/**
 * Turns 2D keypoints into VRM bone rotations — the job Kalidokit does for
 * Kalidoface, but for a 2D landmark model rather than a 3D one.
 *
 * ## How it works
 *
 * For each limb, take the image-space direction between its two joints, express
 * it in the rig's own space, and rotate the bone from its rest direction onto
 * it. Rotating rest-onto-target with `setFromUnitVectors` means there are no
 * Euler axis conventions to get backwards, which is where the previous game
 * lost an afternoon.
 *
 * A bone's rotation has to be expressed relative to its parent, so the chain is
 * solved root-first and each parent's accumulated rotation is carried down
 * explicitly. That is cheaper and more predictable than reading world matrices
 * back out of three.js mid-frame, when they are still stale.
 *
 * ## Coordinate mapping
 *
 * Keypoints are normalised image space: x right, y *down*. The loader turns the
 * VRM 0.0 model to face +Z, which maps rig-local x to world -x, so
 *
 *     rig-local direction = normalize(-dx, -dy, 0)
 *
 * Depth is always zero: the model cannot measure it. Everything therefore lives
 * in the frontal plane — which is where the choreography is written to live.
 */

const MIN_SCORE = 0.3
/** Below this, treat the frame as "nobody there" rather than guessing. */
const IDENTITY = new THREE.Quaternion()

type DrivenBone =
  | 'leftUpperArm' | 'leftLowerArm' | 'rightUpperArm' | 'rightLowerArm'
  | 'leftUpperLeg' | 'leftLowerLeg' | 'rightUpperLeg' | 'rightLowerLeg'

/** Rest direction of each driven bone, in rig-local space. */
const REST: Record<DrivenBone, THREE.Vector3> = {
  leftUpperArm: new THREE.Vector3(-1, 0, 0),
  leftLowerArm: new THREE.Vector3(-1, 0, 0),
  rightUpperArm: new THREE.Vector3(1, 0, 0),
  rightLowerArm: new THREE.Vector3(1, 0, 0),
  leftUpperLeg: new THREE.Vector3(0, -1, 0),
  leftLowerLeg: new THREE.Vector3(0, -1, 0),
  rightUpperLeg: new THREE.Vector3(0, -1, 0),
  rightLowerLeg: new THREE.Vector3(0, -1, 0),
}

interface Segment {
  bone: DrivenBone
  from: KeypointName
  to: KeypointName
  /** Whose accumulated rotation this bone hangs off. */
  parent: 'spine' | 'root' | DrivenBone
}

/**
 * Root-first. Bones between these and the root (chest, upperChest, shoulders)
 * are left at rest, so they contribute identity and can be skipped.
 */
const CHAIN: Segment[] = [
  { bone: 'leftUpperArm', from: 'leftShoulder', to: 'leftElbow', parent: 'spine' },
  { bone: 'leftLowerArm', from: 'leftElbow', to: 'leftWrist', parent: 'leftUpperArm' },
  { bone: 'rightUpperArm', from: 'rightShoulder', to: 'rightElbow', parent: 'spine' },
  { bone: 'rightLowerArm', from: 'rightElbow', to: 'rightWrist', parent: 'rightUpperArm' },
  { bone: 'leftUpperLeg', from: 'leftHip', to: 'leftKnee', parent: 'root' },
  { bone: 'leftLowerLeg', from: 'leftKnee', to: 'leftAnkle', parent: 'leftUpperLeg' },
  { bone: 'rightUpperLeg', from: 'rightHip', to: 'rightKnee', parent: 'root' },
  { bone: 'rightLowerLeg', from: 'rightKnee', to: 'rightAnkle', parent: 'rightUpperLeg' },
]

export class PoseSolver {
  /** Smoothed local rotation per bone. Tracking is noisy; the rig must not be. */
  private local = new Map<string, THREE.Quaternion>()
  /** Accumulated rotation from the rig root down to and including each bone. */
  private accumulated = new Map<string, THREE.Quaternion>()

  private want = new THREE.Quaternion()
  private tmp = new THREE.Quaternion()
  private dir = new THREE.Vector3()
  private euler = new THREE.Euler(0, 0, 0, 'XYZ')

  constructor(private rig: Rig, private smoothing = 0.35) {
    for (const name of [...CHAIN.map((c) => c.bone), 'spine', 'neck']) {
      this.local.set(name, new THREE.Quaternion())
      this.accumulated.set(name, new THREE.Quaternion())
    }
    this.accumulated.set('root', new THREE.Quaternion())
  }

  private direction(s: Skeleton, from: KeypointName, to: KeypointName): THREE.Vector3 | null {
    const a = s[from], b = s[to]
    if (a.score < MIN_SCORE || b.score < MIN_SCORE) return null
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.hypot(dx, dy) < 0.012) return null   // joints on top of each other
    return this.dir.set(-dx, -dy, 0).normalize()
  }

  /** Drive the rig from one frame of tracking. */
  apply(skeleton: Skeleton, dt: number) {
    // Frame-rate independent smoothing, so the rig behaves the same at 15 and
    // 60 fps rather than snapping on fast devices and lagging on slow ones.
    const blend = 1 - Math.pow(1 - this.smoothing, Math.max(1, dt * 60))

    this.solveTorso(skeleton, blend)

    for (const seg of CHAIN) {
      const node = this.rig.nodes.get(seg.bone)
      if (!node) continue
      const local = this.local.get(seg.bone)!
      const target = this.direction(skeleton, seg.from, seg.to)

      if (target) {
        // Rotation needed in rig space, then expressed relative to the parent.
        this.want.setFromUnitVectors(REST[seg.bone], target)
        this.tmp.copy(this.accumulated.get(seg.parent)!).invert().multiply(this.want)
        local.slerp(this.tmp, blend)
      } else {
        local.slerp(IDENTITY, blend * 0.5)   // ease home when a joint drops out
      }

      node.quaternion.copy(local)
      this.accumulated.get(seg.bone)!.copy(this.accumulated.get(seg.parent)!).multiply(local)
    }
  }

  /** Shoulder line against hip line gives lean; nose against shoulders, the head. */
  private solveTorso(s: Skeleton, blend: number) {
    const spineAccum = this.accumulated.get('spine')!
    const spineLocal = this.local.get('spine')!
    const ls = s.leftShoulder, rs = s.rightShoulder, lh = s.leftHip, rh = s.rightHip

    if (Math.min(ls.score, rs.score, lh.score, rh.score) >= MIN_SCORE) {
      const shoulderMidX = (ls.x + rs.x) / 2
      const shoulderMidY = (ls.y + rs.y) / 2
      const hipMidX = (lh.x + rh.x) / 2
      const lean = clamp((shoulderMidX - hipMidX) * 3.2, -0.5, 0.5)
      const tilt = clamp(Math.atan2(ls.y - rs.y, ls.x - rs.x) * 0.6, -0.5, 0.5)
      this.euler.set(0, 0, lean + tilt * 0.5)
      spineLocal.slerp(this.tmp.setFromEuler(this.euler), blend)

      const neck = this.rig.nodes.get('neck')
      if (neck && s.nose.score >= MIN_SCORE) {
        const neckLocal = this.local.get('neck')!
        this.euler.set(
          clamp((s.nose.y - shoulderMidY + 0.13) * 2.2, -0.4, 0.4),
          0,
          clamp((s.nose.x - shoulderMidX) * 3.0, -0.45, 0.45),
        )
        neckLocal.slerp(this.tmp.setFromEuler(this.euler), blend)
        neck.quaternion.copy(neckLocal)
      }
    } else {
      spineLocal.slerp(IDENTITY, blend * 0.5)
    }

    const spine = this.rig.nodes.get('spine')
    if (spine) spine.quaternion.copy(spineLocal)
    spineAccum.copy(spineLocal)
  }
}
