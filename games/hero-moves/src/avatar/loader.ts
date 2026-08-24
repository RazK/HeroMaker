import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { Rig } from './rig'

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
function loadGltf(url: string) {
  if (!url.startsWith('data:')) return loader.loadAsync(url)
  const buffer = dataUriToArrayBuffer(url)
  return new Promise<Awaited<ReturnType<typeof loader.loadAsync>>>((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject)
  })
}

/** Adds a fat, drawn-looking outline so the hero reads against the paper world. */
function addOutline(scene: THREE.Object3D, thickness: number) {
  const additions: Array<{ parent: THREE.Object3D; mesh: THREE.Object3D }> = []
  scene.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh
    if (!(mesh as any).isSkinnedMesh || !mesh.geometry.getAttribute('normal')) return
    const mat = new THREE.MeshBasicMaterial({ color: 0x241c2e, side: THREE.BackSide, fog: true })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uThickness = { value: thickness }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uThickness;')
        .replace(
          '#include <skinning_vertex>',
          '#include <skinning_vertex>\ntransformed += objectNormal * uThickness;',
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
  const gltf = await withImageElementTextures(() => loadGltf(url))
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
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (std.isMeshStandardMaterial) { std.roughness = 0.92; std.metalness = 0 }
      // Kid drawings often have thin flat bits (capes, wings) with no back face.
      m.side = THREE.DoubleSide
    }
  })

  const rig = new Rig(vrm)

  // Several production avatars sit above or below y=0 — measure and ground them.
  const box = new THREE.Box3().setFromObject(vrm.scene)
  const size = new THREE.Vector3(); box.getSize(size)
  vrm.scene.position.y -= box.min.y

  if (opts.outline !== false) {
    try { addOutline(vrm.scene, Math.max(0.006, size.y * 0.006)) } catch { /* cosmetic only */ }
  }

  const root = new THREE.Group()
  root.add(vrm.scene)

  return {
    root, vrm, rig,
    height: size.y,
    radius: Math.max(0.25, Math.max(size.x, size.z) * 0.22),
    dispose() {
      root.removeFromParent()
      VRMUtils.deepDispose(vrm.scene)
    },
  }
}
