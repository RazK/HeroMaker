import * as THREE from 'three'
import { clamp, damp } from '../core/math'

/**
 * The play camera.
 *
 * It lives in front of the hero and never leaves. That is the entire reason
 * this game exists: the previous game's chase camera spent the run looking at
 * the half of the avatar the pipeline invents, while the half a child actually
 * drew — the face, the emblem, the colours — faced away from the player.
 *
 * Distance is solved from the hero's measured height and the current aspect so
 * the whole body fits (dance is legs as well as arms) while the face still
 * lands in the upper third, where the eye goes first. The camera sits a little
 * below chest height so the hero is seen from slightly below, the angle a stage
 * audience gets, which reads as impressive rather than clinical.
 */

/** Fraction of frame height the hero should occupy. */
const FILL_LANDSCAPE = 0.74
const FILL_PORTRAIT = 0.56

export interface Framing {
  /** Hero height in metres, measured after grounding. */
  heroHeight: number
  aspect: number
  portrait: boolean
  /** Clear screen above any UI card, in px, and the viewport height. */
  headroom?: number
  viewportH?: number
}

export class PlayCamera {
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
  private pos = new THREE.Vector3(0, 1, 4)
  private target = new THREE.Vector3(0, 1, 0)
  /** Small on-beat push-in, added on top of the solved distance. */
  punch = 0

  /** Solve and apply the framing. Called on resize and when the hero changes. */
  frame(f: Framing) {
    const fill = f.portrait ? FILL_PORTRAIT : FILL_LANDSCAPE
    this.camera.aspect = f.aspect
    this.camera.fov = f.portrait ? 42 : 38
    this.camera.updateProjectionMatrix()

    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360)
    const distance = clamp(f.heroHeight / fill / (2 * halfHeight), 2.4, 9)

    // Eye a little below the chest: the hero is seen from the stalls.
    const eyeY = f.heroHeight * 0.46
    const lookY = f.heroHeight * 0.54

    this.pos.set(0, eyeY, distance)
    this.target.set(0, lookY, 0)
    this.apply(1)
  }

  /** `beat` is 0..1 within the current beat; the camera breathes with it. */
  update(dt: number, beat: number) {
    this.punch = damp(this.punch, Math.max(0, Math.cos(beat * Math.PI * 2)) * 0.045, 12, dt)
    this.apply(dt)
  }

  private apply(_dt: number) {
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z - this.punch)
    this.camera.lookAt(this.target)
  }

  /**
   * Angle between the camera and the hero's facing direction, in degrees.
   * 0 means dead-on front. The face-time harness samples this.
   */
  frontAngle(heroFacing: THREE.Vector3): number {
    const toCamera = this.camera.position.clone().sub(this.target).setY(0).normalize()
    const facing = heroFacing.clone().setY(0).normalize()
    return THREE.MathUtils.radToDeg(Math.acos(clamp(toCamera.dot(facing), -1, 1)))
  }
}
