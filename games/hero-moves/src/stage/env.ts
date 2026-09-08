/**
 * What a backdrop hands back to the stage.
 *
 * A theme is scenery *and* the light in it — a forest at noon and deep space
 * cannot share a key light and still look like anywhere. But the lights
 * themselves are owned by `Stage`, because `keyLight` is part of its public
 * surface and casts the shadow that keeps the heroes on the ground. So a theme
 * describes the lighting it wants and the stage applies it to lights that
 * outlive every switch.
 */
import type * as THREE from 'three'

export type Quality = 'full' | 'lite'

export interface LightSpec {
  color: string
  intensity: number
  position: [number, number, number]
}

export interface StageEnv {
  /** Ambient wash. Ground colour is the bounce a floor of this theme gives. */
  hemi: { sky: string, ground: string, intensity: number }
  /**
   * The key. It lives in front and slightly above in every theme, because the
   * face is the thing the child drew and it never falls into shadow — only its
   * colour and strength change.
   */
  key: LightSpec
  /** Two rims that pick the silhouette out of the scenery behind it. */
  rims: [LightSpec, LightSpec]
}

export interface Backdrop {
  readonly group: THREE.Group
  readonly env: StageEnv
  /** `phase` is position within the current musical beat, 0..1. */
  update(dt: number, phase: number): void
  dispose(): void
}
