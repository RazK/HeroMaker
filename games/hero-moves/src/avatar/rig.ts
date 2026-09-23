import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

/**
 * Bones this game animates. Fingers are deliberately absent: the HeroMaker
 * pipeline maps 22 human bones and stops at the wrist.
 */
export const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const

export type BoneName = (typeof BONES)[number]

/**
 * A pose is euler XYZ radians per bone, in the *normalized* humanoid rig, whose
 * rest state is a T-pose with identity rotations, +Y up, +Z forward and +X
 * toward the avatar's left. Because these are rotations only, the same pose
 * reads correctly on a realistically-proportioned hero and on a star with legs.
 */
export type Pose = Partial<Record<BoneName, readonly [number, number, number]>>

/** Reflect a left-side euler across the sagittal plane to get the right side. */
export const mirror = (e: readonly [number, number, number]) =>
  [e[0], -e[1], -e[2]] as const

export class Rig {
  readonly nodes = new Map<BoneName, THREE.Object3D>()
  readonly hipsRestY: number

  constructor(readonly vrm: VRM) {
    for (const b of BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(b as VRMHumanBoneName)
      if (node) this.nodes.set(b, node)
    }
    this.hipsRestY = this.nodes.get('hips')?.position.y ?? 0
  }

  has(b: BoneName) { return this.nodes.has(b) }
}
