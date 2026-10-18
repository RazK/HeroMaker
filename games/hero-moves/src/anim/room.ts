import * as THREE from 'three'
import type { Hero } from '../avatar/loader'

/**
 * The room a pose needs, in the hero's own space: lowest and highest point,
 * and the widest either side of centre.
 */
export interface Room { lo: number; hi: number; half: number }
export const union = (a: Room, b: Room): Room => ({ lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), half: Math.max(a.half, b.half) })

/**
 * Measures the room a clip needs on this hero by sampling it: where the head,
 * hands, feet and hips go. Solved against the clip, not the rest pose, so the
 * camera is already back when a backflip leaves the ground — and it holds for
 * any hero, whatever its proportions: the head is a sphere as big as the
 * hero's own head, so one that is a third of its height still fits upside down.
 */
const MEASURED = ['head', 'hips', 'chest', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm',
  'leftFoot', 'rightFoot', 'leftLowerLeg', 'rightLowerLeg'] as const
export function roomMeter(hero: Hero) {
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

