import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'
import {
  VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation'
import { retargetToVRM, UE_RIG, type RigMap } from './retarget'

/**
 * Two ways to get a full-body humanoid clip onto a HeroMaker avatar.
 *
 * `.vrma` (VRM Animation 1.0, glTF extension `VRMC_vrm_animation`) is the
 * format the VRM consortium defines for exactly this. The file names VRM
 * humanoid bones directly, so `@pixiv/three-vrm-animation` binds it to any
 * VRM — including a VRM 0.0 one — with no retargeting on our side at all.
 *
 * Everything else — the enormous CC0 and mocap libraries that exist as plain
 * glTF or FBX — needs its rig mapped onto the VRM humanoid first. That is
 * `retargetToVRM`.
 */
export interface LoadedClip {
  clip: THREE.AnimationClip
  /** Shown on screen so a viewer can tell where the motion came from. */
  format: 'vrma' | 'gltf'
}

const gltfLoader = new GLTFLoader()

const vrmaLoader = new GLTFLoader()
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))

/**
 * A clip file is downloaded and parsed once per page, however many heroes play
 * it: the parsed source is the same for every hero, only the binding differs.
 * A failed load is forgotten so a later attempt can retry it.
 */
type Gltf = Awaited<ReturnType<GLTFLoader['loadAsync']>>
const sources = new Map<string, Promise<Gltf>>()
function loadSource(loader: GLTFLoader, url: string): Promise<Gltf> {
  let p = sources.get(url)
  if (!p) {
    p = loader.loadAsync(url)
    p.catch(() => sources.delete(url))
    sources.set(url, p)
  }
  return p
}

/** `createVRMAnimationClip` wants somewhere to park lookAt tracks; give it one. */
function ensureLookAtProxy(vrm: VRM) {
  if (!vrm.lookAt) return
  if (vrm.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)) return
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
  proxy.name = 'VRMLookAtQuaternionProxy'
  vrm.scene.add(proxy)
}

/**
 * Start downloading and parsing a clip before any hero exists to bind it to.
 * The source is cached, so the later `loadVrma`/`loadRetargeted` for a hero
 * reuses it instead of fetching again.
 */
export function preloadClip(url: string, kind: 'vrma' | 'gltf'): Promise<unknown> {
  return loadSource(kind === 'vrma' ? vrmaLoader : gltfLoader, url).catch(() => undefined)
}

export async function loadVrma(url: string, vrm: VRM): Promise<LoadedClip> {
  ensureLookAtProxy(vrm)
  const gltf = await loadSource(vrmaLoader, url)
  const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined
  if (!animations?.length) throw new Error(`${url} carries no VRMC_vrm_animation`)
  return { clip: createVRMAnimationClip(animations[0], vrm), format: 'vrma' }
}

export async function loadRetargeted(
  url: string, vrm: VRM, rig: RigMap = UE_RIG,
): Promise<LoadedClip> {
  const gltf = await loadSource(gltfLoader, url)
  if (!gltf.animations.length) throw new Error(`${url} carries no animation`)
  return { clip: retargetToVRM(gltf.animations[0], gltf.scene, vrm, rig), format: 'gltf' }
}
