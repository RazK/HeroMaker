import * as THREE from 'three'
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

/**
 * Retargets an ordinary glTF/FBX skeletal animation onto a VRM humanoid.
 *
 * This is the arithmetic pixiv publishes as the Mixamo recipe in the three-vrm
 * examples, generalised over the rig-name map so it also takes the UE-style
 * rigs (`pelvis`, `upperarm_l`, …) that most free animation packs ship.
 *
 * Why it works at all: `@pixiv/three-vrm` exposes a *normalized* humanoid
 * whose rest state is a T-pose with identity rotations, +Y up, +Z forward. So
 * for every bone the job is only to express the source's world-space rotation
 * *relative to its own rest* and hand that delta to the normalized bone:
 *
 *     q_out = R_parentRestWorld · q_track · R_restWorld⁻¹
 *
 * At the source's rest pose that collapses to identity, which is the VRM's
 * rest pose — so the two rigs line up as long as the source also rests in a
 * T-pose. It does not care about limb lengths, which is what lets a mocap clip
 * survive being put on a five-year-old's drawing of a star with legs.
 */
export interface RigMap {
  /** source bone name → VRM humanoid bone name */
  readonly bones: Readonly<Record<string, VRMHumanBoneName>>
  /** source bone whose translation carries the body, usually the hips. */
  readonly hips: string
}

/** Quaternius' Universal Animation Library rig, and every UE-style rig like it. */
export const UE_RIG: RigMap = {
  hips: 'pelvis',
  bones: {
    pelvis: 'hips', spine_01: 'spine', spine_02: 'chest', spine_03: 'upperChest',
    neck_01: 'neck', head: 'head',
    clavicle_l: 'leftShoulder', upperarm_l: 'leftUpperArm', lowerarm_l: 'leftLowerArm', hand_l: 'leftHand',
    clavicle_r: 'rightShoulder', upperarm_r: 'rightUpperArm', lowerarm_r: 'rightLowerArm', hand_r: 'rightHand',
    thigh_l: 'leftUpperLeg', calf_l: 'leftLowerLeg', foot_l: 'leftFoot', ball_l: 'leftToes',
    thigh_r: 'rightUpperLeg', calf_r: 'rightLowerLeg', foot_r: 'rightFoot', ball_r: 'rightToes',
  } as Record<string, VRMHumanBoneName>,
}

/** Mixamo's rig, for FBX pulled straight from mixamo.com. Same maths. */
export const MIXAMO_RIG: RigMap = {
  hips: 'mixamorigHips',
  bones: {
    mixamorigHips: 'hips', mixamorigSpine: 'spine', mixamorigSpine1: 'chest', mixamorigSpine2: 'upperChest',
    mixamorigNeck: 'neck', mixamorigHead: 'head',
    mixamorigLeftShoulder: 'leftShoulder', mixamorigLeftArm: 'leftUpperArm',
    mixamorigLeftForeArm: 'leftLowerArm', mixamorigLeftHand: 'leftHand',
    mixamorigRightShoulder: 'rightShoulder', mixamorigRightArm: 'rightUpperArm',
    mixamorigRightForeArm: 'rightLowerArm', mixamorigRightHand: 'rightHand',
    mixamorigLeftUpLeg: 'leftUpperLeg', mixamorigLeftLeg: 'leftLowerLeg',
    mixamorigLeftFoot: 'leftFoot', mixamorigLeftToeBase: 'leftToes',
    mixamorigRightUpLeg: 'rightUpperLeg', mixamorigRightLeg: 'rightLowerLeg',
    mixamorigRightFoot: 'rightFoot', mixamorigRightToeBase: 'rightToes',
  } as Record<string, VRMHumanBoneName>,
}

const _rest = new THREE.Quaternion()
const _parentRest = new THREE.Quaternion()
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

export function retargetToVRM(
  clip: THREE.AnimationClip,
  sourceRoot: THREE.Object3D,
  vrm: VRM,
  rig: RigMap,
): THREE.AnimationClip {
  sourceRoot.updateWorldMatrix(true, true)

  // VRM 0.0 avatars — which is all of HeroMaker's — author the model facing
  // -Z. `VRMUtils.rotateVRM0` spins the scene to face +Z but leaves the
  // normalized rig in the model's own frame, so every rotation still has to be
  // conjugated by that 180° yaw. Negating x and z of the quaternion is exactly
  // that, and negating x and z of a translation is its positional twin. This
  // is the same fix `createVRMAnimationClip` applies to a .vrma.
  const flip = vrm.meta?.metaVersion === '0'

  const hipsNode = sourceRoot.getObjectByName(rig.hips)
  if (!hipsNode) throw new Error(`source rig has no "${rig.hips}"`)
  // The hips translation track is in its *parent's* frame, and that frame is
  // not always the world's: Quaternius' rig hangs off a `root` carrying the
  // Z-up→Y-up quarter turn, so a raw copy sends the avatar's body backwards
  // instead of upwards. Rotate every sample into world space first.
  const hipsParentRest = new THREE.Quaternion()
  hipsNode.parent!.getWorldQuaternion(hipsParentRest)
  hipsNode.getWorldPosition(_v)
  // Heights differ by an order of magnitude between rigs; keep the hips at the
  // same *fraction* of the avatar's own height rather than at absolute metres.
  const hipsScale = vrm.humanoid.normalizedRestPose.hips!.position![1] / _v.y

  const tracks: THREE.KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.')
    const sourceName = track.name.slice(0, dot)
    const property = track.name.slice(dot + 1)

    const humanBone = rig.bones[sourceName]
    if (!humanBone) continue
    const target = vrm.humanoid.getNormalizedBoneNode(humanBone)
    // Some HeroMaker avatars skip optional bones (upperChest, toes) — a clip
    // that drives one of those simply loses that channel.
    if (!target) continue
    const node = sourceRoot.getObjectByName(sourceName)
    if (!node) continue

    if (property === 'quaternion') {
      node.getWorldQuaternion(_rest).invert()
      node.parent!.getWorldQuaternion(_parentRest)
      const values = Float32Array.from(track.values)
      for (let i = 0; i < values.length; i += 4) {
        _q.fromArray(values, i).premultiply(_parentRest).multiply(_rest)
        _q.toArray(values, i)
        if (flip) { values[i] = -values[i]; values[i + 2] = -values[i + 2] }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, Array.from(track.times), Array.from(values)))
    } else if (property === 'position' && humanBone === 'hips') {
      // Only the hips carry translation: every other bone's offset is the
      // avatar's own skeleton, not the animation's.
      const values = Float32Array.from(track.values)
      for (let i = 0; i < values.length; i += 3) {
        _v.fromArray(values, i).applyQuaternion(hipsParentRest).multiplyScalar(hipsScale)
        values[i] = flip ? -_v.x : _v.x
        values[i + 1] = _v.y
        values[i + 2] = flip ? -_v.z : _v.z
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, Array.from(track.times), Array.from(values)))
    }
  }

  if (tracks.length === 0) throw new Error(`retarget produced no tracks for "${clip.name}"`)
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}
