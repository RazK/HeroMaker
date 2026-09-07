import * as THREE from 'three'
import type { Hero } from '../avatar/loader'
import { loadRetargeted, loadVrma } from './clips'

/**
 * Plays full-body animation clips on a hero, alongside the procedural poser.
 *
 * Both write to the same bones, so they cannot run at once — whichever ran
 * last in the frame would silently win. `active` is the contract: while a clip
 * is playing the caller must not pose this hero itself, and `update` returns
 * to a neutral rig as soon as the clip ends so the poser can take back over
 * without a visible jump.
 *
 * Clips are optional by design. They arrive over the network after the hero
 * does, and a hero with none loaded is simply a hero that never celebrates —
 * never a broken one.
 */

export type ClipKind = 'gltf' | 'vrma'

export interface ClipSpec {
  id: string
  url: string
  kind: ClipKind
  /** Where it came from, for the credits screen. CC0 and MIT both need it. */
  credit: string
}

/** The clips shipped with the game. Everything here is CC0 or MIT. */
export const CLIPS: ClipSpec[] = [
  { id: 'dance', url: 'Dance_Charleston.glb', kind: 'gltf', credit: 'Quaternius UAL (CC0)' },
  { id: 'backflip', url: 'Backflip.glb', kind: 'gltf', credit: 'Quaternius UAL (CC0)' },
  { id: 'punch', url: 'Punch_Cross.glb', kind: 'gltf', credit: 'Quaternius UAL (CC0)' },
  { id: 'jump', url: 'Jump.vrma', kind: 'vrma', credit: 'tk256ailab/vrm-viewer (MIT)' },
]

export class Performer {
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private currentId: string | null = null
  /** Set for a one-shot; cleared when it finishes and the rig is handed back. */
  private oneShotEnds = 0

  constructor(private hero: Hero) {
    this.mixer = new THREE.AnimationMixer(hero.vrm.scene)
  }

  /** True while a clip owns the rig. The caller must not pose the hero then. */
  get active() { return this.current !== null }
  get playing() { return this.currentId }
  get ready() { return this.actions.size > 0 }
  has(id: string) { return this.actions.has(id) }

  /**
   * Load one clip. Failures are swallowed to a warning on purpose: a missing
   * animation should cost the hero a flourish, not cost the player the game.
   */
  async load(spec: ClipSpec, resolve: (file: string) => string): Promise<boolean> {
    if (!this.mixer) return false
    try {
      const url = resolve(spec.url)
      const loaded = spec.kind === 'vrma'
        ? await loadVrma(url, this.hero.vrm)
        : await loadRetargeted(url, this.hero.vrm)
      const action = this.mixer.clipAction(loaded.clip)
      this.actions.set(spec.id, action)
      return true
    } catch (err) {
      console.warn(`clip ${spec.id} unavailable:`, (err as Error).message)
      return false
    }
  }

  /**
   * Start a clip. `loop` keeps it running until something else is played or
   * `stop` is called; otherwise it plays once and hands the rig back.
   */
  play(id: string, { loop = false, fade = 0.25 } = {}) {
    const next = this.actions.get(id)
    if (!next || next === this.current) return
    next.reset()
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    next.clampWhenFinished = !loop
    next.enabled = true
    next.setEffectiveWeight(1)
    if (this.current) next.crossFadeFrom(this.current, fade, false)
    next.play()
    this.current = next
    this.currentId = id
    // Tracked here rather than trusting the mixer's finished event, which does
    // not fire if the mixer is stopped mid-clip.
    this.oneShotEnds = loop ? 0 : next.getClip().duration
  }

  /** Hand the rig back to the procedural poser. */
  stop(fade = 0.2) {
    if (!this.current) return
    this.current.fadeOut(fade)
    this.current = null
    this.currentId = null
    this.oneShotEnds = 0
  }

  update(dt: number) {
    if (!this.mixer) return
    this.mixer.update(dt)
    if (this.current && this.oneShotEnds > 0 && this.current.time >= this.oneShotEnds - 0.02) {
      this.stop()
    }
  }

  dispose() {
    this.mixer?.stopAllAction()
    this.actions.clear()
    this.mixer = null
    this.current = null
  }
}

/**
 * Load every clip for a hero in the background. `resolve` turns a shipped
 * filename into the hashed URL the bundler actually emitted.
 *
 * Deliberately not awaited by anything on the boot path: the title screen must
 * appear whether or not the animations arrive, and on a slow connection they
 * will land after the player has already chosen.
 */
export async function loadAllClips(
  performer: Performer, resolve: (file: string) => string,
): Promise<number> {
  const results = await Promise.all(CLIPS.map((c) => performer.load(c, resolve)))
  return results.filter(Boolean).length
}
