import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { Rig } from './rig'
import { Animator } from './animator'

export interface Hero {
  /** Wrapper the game moves around; the VRM sits grounded inside it. */
  root: THREE.Group
  vrm: VRM
  rig: Rig
  animator: Animator
  /** Height in metres after grounding — used to frame the camera. */
  height: number
  radius: number
  dispose(): void
}

const loader = new GLTFLoader()
loader.register((parser) => new VRMLoaderPlugin(parser))

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
  const gltf = await loader.loadAsync(url)
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

  const animator = new Animator(rig)
  animator.update(0.016, 0)
  animator.reset()

  return {
    root, vrm, rig, animator,
    height: size.y,
    radius: Math.max(0.25, Math.max(size.x, size.z) * 0.22),
    dispose() {
      root.removeFromParent()
      VRMUtils.deepDispose(vrm.scene)
    },
  }
}
