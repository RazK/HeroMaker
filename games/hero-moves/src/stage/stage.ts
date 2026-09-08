import * as THREE from 'three'
import { BACKDROPS, createBackdrop, DEFAULT_BACKDROP, isBackdropId } from './backdrops'
import type { Backdrop, Quality, StageEnv } from './env'

/**
 * The set the heroes perform on.
 *
 * Framing is the whole point of this game: a HeroMaker avatar is drawn from the
 * front by a child, so the camera lives in front of the hero and stays there.
 * The stage owns the *lights* and the scenery slot; what fills that slot is a
 * backdrop chosen by the player (see `backdrops.ts`).
 *
 * The lights outlive every switch. `keyLight` is public, it carries the shadow
 * that keeps the heroes on the ground, and re-creating it per theme would mean
 * re-allocating a shadow map every time somebody flicks through the menu — so a
 * theme *describes* the light it wants and the stage tunes these three to match.
 * The key stays front-and-slightly-above in every theme, because the face is the
 * thing the child drew and it never falls into shadow.
 */

export const STAGE = {
  /** Radius of the performance disc. Themes may go a little wider. */
  floorRadius: 3.2,
  backdropRadius: 16,
} as const

export { BACKDROPS }
export type { BackdropSpec } from './backdrops'

export class Stage {
  readonly group = new THREE.Group()
  readonly keyLight: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly rims: [THREE.DirectionalLight, THREE.DirectionalLight]
  private backdrop!: Backdrop
  private id = DEFAULT_BACKDROP
  private quality: Quality = 'full'

  constructor(id: string = DEFAULT_BACKDROP) {
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2b4d, 0.85)
    this.group.add(this.hemi)

    this.keyLight = new THREE.DirectionalLight(0xfff3e0, 2.5)
    this.keyLight.position.set(0.9, 3.4, 4.2)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.set(1024, 1024)
    this.keyLight.shadow.camera.near = 1
    this.keyLight.shadow.camera.far = 14
    const sc = this.keyLight.shadow.camera as THREE.OrthographicCamera
    sc.left = -3; sc.right = 3; sc.top = 4; sc.bottom = -1
    sc.updateProjectionMatrix()
    this.keyLight.shadow.bias = -0.0015
    this.group.add(this.keyLight)

    // Rims pick the silhouette out of whatever is behind it.
    this.rims = [
      new THREE.DirectionalLight(0x7ad7ff, 1.5),
      new THREE.DirectionalLight(0xff8fc7, 1.5),
    ]
    this.rims[0].position.set(-4, 2.6, -2.4)
    this.rims[1].position.set(4, 2.6, -2.4)
    this.group.add(this.rims[0], this.rims[1])

    this.setBackdrop(id)
  }

  /** Which theme is showing. */
  get backdropId(): string { return this.id }

  get backdropQuality(): Quality { return this.quality }

  /**
   * Switch themes, disposing the old one.
   *
   * Every geometry, material and texture a backdrop made is freed here, because
   * a menu invites a player to try all six and a leak per switch would be a leak
   * per curiosity.
   */
  setBackdrop(id: string): void {
    const next = isBackdropId(id) ? id : DEFAULT_BACKDROP
    if (this.backdrop && next === this.id) return
    if (this.backdrop) {
      this.group.remove(this.backdrop.group)
      this.backdrop.dispose()
    }
    this.backdrop = createBackdrop(next, this.quality)
    this.group.add(this.backdrop.group)
    this.applyEnv(this.backdrop.env)
    this.id = next
  }

  /**
   * `lite` is the cheap path: fewer particles, no extra lights, smaller
   * textures. The theme is rebuilt because texture sizes are chosen when it is
   * painted — and a rebuild happens at most once, when the game gives up on
   * a device that cannot keep up.
   */
  setQuality(q: Quality): void {
    if (q === this.quality) return
    this.quality = q
    const id = this.id
    if (this.backdrop) {
      this.group.remove(this.backdrop.group)
      this.backdrop.dispose()
      this.backdrop = createBackdrop(id, q)
      this.group.add(this.backdrop.group)
      this.applyEnv(this.backdrop.env)
    }
    this.keyLight.castShadow = q === 'full'
    this.keyLight.shadow.mapSize.set(q === 'full' ? 1024 : 512, q === 'full' ? 1024 : 512)
    this.keyLight.shadow.map?.dispose()
    this.keyLight.shadow.map = null
  }

  private applyEnv(env: StageEnv) {
    const lite = this.quality === 'lite'
    this.hemi.color.set(env.hemi.sky)
    this.hemi.groundColor.set(env.hemi.ground)
    // With the rims off, the ambient carries a little of what they were doing.
    this.hemi.intensity = env.hemi.intensity * (lite ? 1.25 : 1)
    this.keyLight.color.set(env.key.color)
    this.keyLight.intensity = env.key.intensity * (lite ? 1.1 : 1)
    this.keyLight.position.set(...env.key.position)
    for (let i = 0; i < 2; i++) {
      const spec = env.rims[i]
      this.rims[i].color.set(spec.color)
      this.rims[i].intensity = spec.intensity
      this.rims[i].position.set(...spec.position)
      this.rims[i].visible = !lite
    }
  }

  /** Called every frame. `phase` is position within the current beat, 0..1. */
  update(dt: number, phase: number) {
    this.backdrop.update(dt, phase)
  }
}
