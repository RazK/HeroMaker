import type * as Three from 'three'
import type { RoomEnvironment as Room } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * How a hero is lit and shaded on the hero page: the lights, the room it
 * reflects, the tone mapping and exposure, the colour space and the finish
 * of its materials. ONE place, used by everything that shows a hero in 3D.
 *
 * herostage.ts lights the live hero with it. The HeroMaker app's toy viewer
 * (frontend PartsViewer.tsx) calls the same `applyLook` and `finishMaterials`,
 * exported from /play/herostage.js, so the action figure is lit exactly like
 * the hero it was cut from (Raz: "more similar to the lighting on the 3D
 * animated character").
 *
 * The app has its own copy of three.js, an older one, and the objects in its
 * scene must come from that copy. So nothing here imports three at run time:
 * the caller hands in its own `THREE` and `RoomEnvironment`, and every light
 * and texture is made with them.
 */

/** The hero page's light: a warm key from above and in front, a lilac fill, a soft sky over a warm floor. */
export const LOOK = {
  sky: { sky: 0xffffff, ground: 0xffe9c4, intensity: 0.85 },
  key: { color: 0xfff3e0, intensity: 2.1, position: [1.2, 3.5, 4] as const },
  fill: { color: 0xe9e3ff, intensity: 0.6, position: [-3, 1.5, 2] as const },
  /** ACES filmic, a touch over 1, in sRGB. */
  exposure: 1.05,
  /** The room the materials reflect: three's RoomEnvironment, slightly blurred, a quarter as strong. */
  room: { blur: 0.04, intensity: 0.25 },
  /** Matte and never metal: the models come from image-to-3D, whose "metal" is noise. */
  roughness: 0.92,
  metalness: 0,
} as const

export interface LookParts {
  THREE: typeof Three
  RoomEnvironment: typeof Room
}

/**
 * Light `scene` and set up `renderer` the way the hero page does. Returns a
 * function that takes the lights and the room away again.
 */
export function applyLook({ THREE, RoomEnvironment }: LookParts, renderer: Three.WebGLRenderer, scene: Three.Scene): () => void {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = LOOK.exposure

  const lights = new THREE.Group()
  lights.name = 'hero-look'
  lights.add(new THREE.HemisphereLight(LOOK.sky.sky, LOOK.sky.ground, LOOK.sky.intensity))
  for (const { color, intensity, position } of [LOOK.key, LOOK.fill]) {
    const light = new THREE.DirectionalLight(color, intensity)
    light.position.set(position[0], position[1], position[2])
    lights.add(light)
  }
  scene.add(lights)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = pmrem.fromScene(new RoomEnvironment(), LOOK.room.blur).texture
  pmrem.dispose()
  const before = scene.environment
  scene.environment = room
  // three r163 and later dim the room for the whole scene; before that, each
  // material dims it (finishMaterials).
  if ('environmentIntensity' in scene) scene.environmentIntensity = LOOK.room.intensity

  return () => {
    scene.remove(lights)
    if (scene.environment === room) scene.environment = before
    room.dispose()
  }
}

/** Give every material under `root` the hero's finish. Run it on anything shown with `applyLook`. */
export function finishMaterials({ THREE }: Pick<LookParts, 'THREE'>, root: Three.Object3D, scene?: Three.Scene): void {
  const roomPerMaterial = !!scene && !('environmentIntensity' in scene)
  root.traverse((obj) => {
    const mesh = obj as Three.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as Three.MeshStandardMaterial
      if (std.isMeshStandardMaterial) {
        std.roughness = LOOK.roughness
        std.metalness = LOOK.metalness
        if (roomPerMaterial) std.envMapIntensity = LOOK.room.intensity
      }
      // Kid drawings often have thin flat bits (capes, wings) with no back face.
      m.side = THREE.DoubleSide
    }
  })
}
