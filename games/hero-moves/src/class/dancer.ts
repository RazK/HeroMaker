import * as THREE from 'three'
import type { Hero } from '../avatar/loader'
import { loadRetargeted, loadVrma } from '../anim/clips'
import { CLIPS } from '../anim/performer'
import type { Sample } from './program'

/**
 * One hero on the class stage, posed by being *told* where each clip is.
 *
 * Every hero gets its own binding of each clip (a retarget keeps the hips at
 * the same fraction of that hero's own height), but the clip files themselves
 * are downloaded and parsed once for the whole class — anim/clips.ts caches the
 * source — so twelve heroes cost twelve cheap bindings, not twelve downloads.
 *
 * All actions run all the time with their mixer clock frozen; `pose` sets each
 * one's time and weight and evaluates once. Weights of a pose always sum to 1,
 * so the rig never blends toward its rest T-pose.
 */
export class Dancer {
  readonly mixer: THREE.AnimationMixer
  private actions = new Map<string, THREE.AnimationAction>()
  /** Widest the hero reaches either side of centre, and highest, in its own units, over the group clips. */
  half = 0.5
  top = 1.7
  /** Highest a hero reaches during any clip (for framing a backflip). */
  reach = 1.9
  /** Highest point per clip. */
  tops: Record<string, number> = {}

  constructor(readonly hero: Hero) {
    this.mixer = new THREE.AnimationMixer(hero.vrm.scene)
  }

  /** Bind every shipped clip. Resolves to the number bound. */
  async bind(resolve: (file: string) => string): Promise<number> {
    const results = await Promise.all(CLIPS.map(async (spec) => {
      try {
        const url = resolve(spec.url)
        const loaded = spec.kind === 'vrma'
          ? await loadVrma(url, this.hero.vrm)
          : await loadRetargeted(url, this.hero.vrm)
        const action = this.mixer.clipAction(loaded.clip)
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.enabled = true
        action.weight = 0
        action.play()
        this.actions.set(spec.id, action)
        return true
      } catch (err) {
        console.warn(`clip ${spec.id} unavailable for a hero:`, (err as Error).message)
        return false
      }
    }))
    return results.filter(Boolean).length
  }

  has(id: string) { return this.actions.has(id) }
  duration(id: string) { return this.actions.get(id)?.getClip().duration ?? 1 }

  pose(samples: Sample[]) {
    for (const a of this.actions.values()) a.weight = 0
    let total = 0
    for (const s of samples) {
      const a = this.actions.get(s.clip) ?? this.actions.get('dance')
      if (!a) continue
      a.time = s.time * a.getClip().duration
      a.weight += s.weight
      total += s.weight
    }
    if (total <= 0) return
    this.mixer.update(0)
  }

  /**
   * How much room the hero needs: sampled through the clips rather than read
   * off the rest pose, because a T-pose is far wider than any dance and a
   * backflip far taller.
   */
  measure(group: string[], all: string[]) {
    const { vrm, root } = this.hero
    const v = new THREE.Vector3()
    const names = ['head', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftFoot', 'rightFoot', 'hips'] as const
    const h = this.hero.height
    // A head reaches past its bone by what sits above it at rest; hands likewise sideways.
    root.updateMatrixWorld(true)
    const headBone = vrm.humanoid.getRawBoneNode('head')
    const headY = headBone ? root.worldToLocal(headBone.getWorldPosition(v)).y : h * 0.8
    const headR = Math.max(h * 0.08, h - headY)
    const handR = h * 0.07
    const sample = (ids: string[]) => {
      let half = 0, top = 0
      for (const id of ids) {
        const a = this.actions.get(id)
        if (!a) continue
        for (let i = 0; i <= 20; i++) {
          this.pose([{ clip: id, time: i / 20.5, weight: 1 }])
          vrm.humanoid.update()
          root.updateMatrixWorld(true)
          for (const n of names) {
            const node = vrm.humanoid.getRawBoneNode(n)
            if (!node) continue
            root.worldToLocal(node.getWorldPosition(v))
            const r = n === 'head' ? headR : handR
            half = Math.max(half, Math.abs(v.x) + r * (n === 'head' ? 0.9 : 1))
            top = Math.max(top, v.y + (n === 'head' ? headR : r))
          }
        }
      }
      return { half, top }
    }
    const g = sample(group)
    this.half = Math.max(g.half, this.hero.width * 0.2)
    this.top = Math.max(g.top, h)
    for (const id of all) this.tops[id] = sample([id]).top
    this.reach = Math.max(this.top, ...all.map((id) => this.tops[id]))
  }
}
