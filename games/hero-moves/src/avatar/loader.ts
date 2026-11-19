import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { Rig } from './rig'
import { finishMaterials } from '../look'

/**
 * A loaded, grounded, front-facing hero. Deliberately knows nothing about
 * animation — whoever poses it owns that.
 */
export interface Hero {
  /** Wrapper the game moves around; the VRM sits grounded inside it. */
  root: THREE.Group
  vrm: VRM
  rig: Rig
  /** Height in metres after grounding — used to frame the camera. */
  height: number
  /** Widest extent in the frontal plane, at rest. Some heroes are wider than tall. */
  width: number
  radius: number
  dispose(): void
}

const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function dataUriToArrayBuffer(uri: string): ArrayBuffer {
  const comma = uri.indexOf(',')
  if (comma < 0) throw new Error('malformed data URI')
  const meta = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  if (meta.includes(';base64')) return base64ToArrayBuffer(payload)
  const text = decodeURIComponent(payload)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes.buffer
}

/**
 * GLTFLoader reaches for ImageBitmapLoader when `createImageBitmap` exists, and
 * that loader pulls textures with `fetch()`. Under a published artifact's CSP
 * that fetch is refused, so hide the global for the duration of the load and
 * let three fall back to TextureLoader, which uses a plain <img>.
 */
async function withImageElementTextures<T>(fn: () => Promise<T>): Promise<T> {
  const globals = globalThis as { createImageBitmap?: unknown }
  const original = globals.createImageBitmap
  if (original === undefined) return fn()
  globals.createImageBitmap = undefined
  try { return await fn() } finally { globals.createImageBitmap = original }
}

/**
 * Load a VRM from a URL or from an inlined `data:` URI.
 *
 * The single-file build inlines every avatar, and a published artifact's CSP
 * blocks `fetch()` to `data:` — so decode it here and hand the bytes straight
 * to the parser rather than letting the loader go near the network.
 */
type Gltf = Awaited<ReturnType<typeof loader.loadAsync>>

function loadGltf(url: string) {
  if (!url.startsWith('data:')) return loader.loadAsync(url)
  return parseGltf(dataUriToArrayBuffer(url))
}

function parseGltf(buffer: ArrayBuffer) {
  return new Promise<Gltf>((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject)
  })
}

/** How far the outline hull sits behind the hero, as a share of its height. */
export const OUTLINE_DEPTH_PUSH = 0.04

/**
 * Normals for the outline only: every vertex at the same spot gets the same
 * normal, the average of the normals there. A model's own normals split at UV
 * and material seams (the hair's strands, the eyes' rims, a collar), and a hull
 * pushed out along split normals cracks open at every seam and draws a line
 * along it. Stored as `outlineNormal` so the model's own shading is untouched.
 */
export function weldedNormals(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const pos = geometry.getAttribute('position')
  const nor = geometry.getAttribute('normal')
  const n = pos.count
  // Quantise positions to a grid well below any visible detail: 1/2000 of the
  // mesh's size. Vertices that land in one cell are the same point.
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  const extent = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1
  const q = 2000 / extent
  const group = new Int32Array(n)
  const seen = new Map<string, number>()
  const sums: number[] = []
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`
    let g = seen.get(key)
    if (g === undefined) { g = seen.size; seen.set(key, g); sums.push(0, 0, 0) }
    group[i] = g
    sums[g * 3] += nor.getX(i); sums[g * 3 + 1] += nor.getY(i); sums[g * 3 + 2] += nor.getZ(i)
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const g = group[i]
    let x = sums[g * 3], y = sums[g * 3 + 1], z = sums[g * 3 + 2]
    let len = Math.hypot(x, y, z)
    // Opposite normals at one point (a thin double-sided cape) cancel out:
    // fall back to the vertex's own normal there.
    if (len < 1e-4) { x = nor.getX(i); y = nor.getY(i); z = nor.getZ(i); len = Math.hypot(x, y, z) || 1 }
    out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len
  }
  return new THREE.BufferAttribute(out, 3)
}

/**
 * Adds a fat, drawn-looking outline so the hero reads against the paper world.
 *
 * It is an inverted hull: a back-face copy of each skinned mesh pushed out
 * along its (welded) normals. Only the hero's silhouette should be inked, so
 * the hull's depth is also pushed `depthPush` away from the camera (its depth
 * only: where it lands on screen is unchanged): where
 * the model's own surface is anywhere near it (an eye socket, under the
 * fringe, between hair strands, a sleeve against the body) the model wins the
 * depth test and no line shows; around the outside there is nothing in front
 * of the hull but the background, so the ring stays.
 */
function addOutline(scene: THREE.Object3D, thickness: number, depthPush: number) {
  const additions: Array<{ parent: THREE.Object3D; mesh: THREE.Object3D }> = []
  scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!(mesh as any).isSkinnedMesh || !mesh.geometry.getAttribute('normal')) return
    if (!mesh.geometry.getAttribute('outlineNormal')) mesh.geometry.setAttribute('outlineNormal', weldedNormals(mesh.geometry))
    const mat = new THREE.MeshBasicMaterial({ color: 0x241c2e, side: THREE.BackSide, fog: true })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uThickness = { value: thickness }
      shader.uniforms.uDepthPush = { value: depthPush }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uThickness;\nuniform float uDepthPush;\nattribute vec3 outlineNormal;')
        // Skin the welded normal, not the model's own (split) one.
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = outlineNormal;')
        .replace(
          '#include <skinning_vertex>',
          '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * uThickness;',
        )
        // Push only the depth: x and y stay where they were, so perspective
        // does not shrink the hull back into the hero and thin the ring.
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n'
          + 'vec4 outlinePushed = projectionMatrix * vec4(mvPosition.xy, mvPosition.z - uDepthPush, 1.0);\n'
          + 'gl_Position.z = outlinePushed.z / outlinePushed.w * gl_Position.w;',
        )
    }
    const outline = new THREE.SkinnedMesh(mesh.geometry, mat)
    outline.bindMode = mesh.bindMode
    outline.bind(mesh.skeleton, mesh.bindMatrix)
    outline.frustumCulled = false
    outline.renderOrder = -1
    additions.push({ parent: mesh.parent ?? scene, mesh: outline })
  })
  additions.forEach(({ parent, mesh }) => parent.add(mesh))
}

export async function loadHero(url: string, opts: { outline?: boolean } = {}): Promise<Hero> {
  return heroFromGltf(await withImageElementTextures(() => loadGltf(url)), opts)
}

/** The same, from a VRM already downloaded — for a caller that fetched it itself to show progress. */
export async function parseHero(buffer: ArrayBuffer, opts: { outline?: boolean } = {}): Promise<Hero> {
  return heroFromGltf(await withImageElementTextures(() => parseGltf(buffer)), opts)
}

function heroFromGltf(gltf: Gltf, opts: { outline?: boolean }): Hero {
  const vrm = gltf.userData.vrm as VRM
  if (!vrm) throw new Error('not a VRM file')

  // VRM 0.x models face -Z; rotate so +Z is forward like everything else here.
  VRMUtils.rotateVRM0(vrm)
  VRMUtils.removeUnnecessaryVertices(gltf.scene)
  VRMUtils.combineSkeletons(gltf.scene)

  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
  })
  // The hero's finish: matte, never metal, both sides drawn (look.ts).
  finishMaterials({ THREE }, vrm.scene)

  const rig = new Rig(vrm)

  // Several production avatars sit above or below y=0 — measure and ground them.
  const box = new THREE.Box3().setFromObject(vrm.scene)
  const size = new THREE.Vector3(); box.getSize(size)
  vrm.scene.position.y -= box.min.y

  if (opts.outline !== false) {
    // The push is a share of the hero's height: deeper than an eye socket or a
    // fringe over a forehead, far shallower than the hero's distance to anything behind it.
    try { addOutline(vrm.scene, Math.max(0.006, size.y * 0.006), size.y * OUTLINE_DEPTH_PUSH) } catch { /* cosmetic only */ }
  }

  const root = new THREE.Group()
  root.add(vrm.scene)

  return {
    root, vrm, rig,
    height: size.y,
    width: size.x,
    radius: Math.max(0.25, Math.max(size.x, size.z) * 0.22),
    dispose() {
      root.removeFromParent()
      VRMUtils.deepDispose(vrm.scene)
    },
  }
}
