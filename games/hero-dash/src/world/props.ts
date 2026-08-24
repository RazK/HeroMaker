import * as THREE from 'three'
import { CRAYON, paperTexture } from './materials'
import { makeRng } from '../core/math'

/** Slightly irregular geometry — a perfect box looks CG, a wonky one looks drawn. */
function wobble(geo: THREE.BufferGeometry, amount: number, seed: number) {
  const rng = makeRng(seed)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rng() - 0.5) * amount,
      pos.getY(i) + (rng() - 0.5) * amount,
      pos.getZ(i) + (rng() - 0.5) * amount,
    )
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

let paper: THREE.Texture | null = null
const getPaper = () => (paper ??= paperTexture('#ffffff', 30, 2))

export function crayonMaterial(color: string, opts: { flat?: boolean } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: getPaper(),
    roughness: 0.98,
    metalness: 0,
    flatShading: opts.flat ?? true,
  })
}

export function makeTree(seed: number): THREE.Group {
  const rng = makeRng(seed)
  const g = new THREE.Group()
  const h = 2.4 + rng() * 3.4
  const trunk = new THREE.Mesh(
    wobble(new THREE.CylinderGeometry(0.16, 0.24, h, 6), 0.05, seed),
    crayonMaterial(CRAYON.trunk),
  )
  trunk.position.y = h / 2
  g.add(trunk)
  const blobs = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < blobs; i++) {
    const r = 0.85 + rng() * 0.9
    const leaf = new THREE.Mesh(
      wobble(new THREE.IcosahedronGeometry(r, 0), 0.16, seed + i * 17),
      crayonMaterial(CRAYON.leaf[Math.floor(rng() * CRAYON.leaf.length)]),
    )
    leaf.position.set((rng() - 0.5) * 1.2, h + (rng() - 0.3) * 1.1, (rng() - 0.5) * 1.2)
    g.add(leaf)
  }
  return g
}

export function makeHill(seed: number): THREE.Mesh {
  const rng = makeRng(seed)
  const r = 6 + rng() * 14
  const m = new THREE.Mesh(
    wobble(new THREE.SphereGeometry(r, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), r * 0.06, seed),
    crayonMaterial(CRAYON.hill[Math.floor(rng() * CRAYON.hill.length)]),
  )
  m.scale.set(1, 0.34 + rng() * 0.4, 1)
  return m
}

export function makeCloud(seed: number): THREE.Group {
  const rng = makeRng(seed)
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, metalness: 0, flatShading: true,
    emissive: '#e8f2ff', emissiveIntensity: 0.35,
  })
  const puffs = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < puffs; i++) {
    const r = 1.5 + rng() * 2.2
    const p = new THREE.Mesh(wobble(new THREE.IcosahedronGeometry(r, 1), r * 0.12, seed + i), mat)
    p.position.set((i - puffs / 2) * 2.1 + rng(), (rng() - 0.5) * 1.1, (rng() - 0.5) * 1.6)
    g.add(p)
  }
  return g
}

/** Five-pointed star, extruded — the collectible. */
export function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const outer = 0.42, inner = 0.18
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outer : inner
    const x = Math.cos(a) * r, y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
  }
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 1,
  })
  geo.center()
  return geo
}
