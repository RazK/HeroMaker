import * as THREE from 'three'

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Frame-rate independent exponential approach. `rate` = fraction closed per second. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-rate * dt))

/** Deterministic PRNG so a seed always regenerates the same track. */
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

const _e = new THREE.Euler()
/** Write XYZ euler radians into a quaternion without allocating. */
export function setEuler(q: THREE.Quaternion, x: number, y: number, z: number) {
  return q.setFromEuler(_e.set(x, y, z, 'XYZ'))
}
