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

/**
 * The hero page's light, a soft three-point studio (Raz, 2026-11-22: the
 * lighting "doesn't look good"): a warm key from the front left, above; a
 * fill from the right, so the far side of the face is never in shadow; a
 * gentle rim from behind, which lifts the hero off the plate; under them a
 * warm sky over a warm floor. Warmer and brighter than before, and soft: no
 * light is much stronger than the others, so nothing falls into a hard shadow.
 */
export const LOOK = {
  sky: { sky: 0xfffaf2, ground: 0xffe2c2, intensity: 1.0 },
  key: { color: 0xffeedb, intensity: 2.2, position: [-2.2, 3.2, 4.2] as const },
  fill: { color: 0xfff4ea, intensity: 0.9, position: [3.2, 1.6, 2.6] as const },
  rim: { color: 0xfff8f0, intensity: 1.1, position: [0.8, 3.2, -4] as const },
  /** Neutral tone mapping, in sRGB. */
  exposure: 1.0,
  /** The room the materials reflect: three's RoomEnvironment, slightly blurred, a third as strong. */
  room: { blur: 0.04, intensity: 0.32 },
  /** Matte and never metal: the models come from image-to-3D, whose "metal" is noise. */
  roughness: 0.92,
  metalness: 0,
  /** How much of a hero's own glow stays (see finishMaterials). */
  selfGlow: 0.12,
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
  // Neutral keeps the hero's own colours (ACES greyed the pinks and paled the
  // skin); a three.js too old for it (before r162) keeps ACES.
  renderer.toneMapping = (THREE as unknown as { NeutralToneMapping?: Three.ToneMapping }).NeutralToneMapping ?? THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = LOOK.exposure

  const lights = new THREE.Group()
  lights.name = 'hero-look'
  lights.add(new THREE.HemisphereLight(LOOK.sky.sky, LOOK.sky.ground, LOOK.sky.intensity))
  for (const { color, intensity, position } of [LOOK.key, LOOK.fill, LOOK.rim]) {
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
        // Most heroes made since 2026-10 arrive lit from within: their own
        // texture as an emissive map at full strength (the image-to-3D
        // export). Drawn that way they were flat and washed out, whatever the
        // lights did (Raz: the lighting "doesn't look good"). A trace of it
        // stays, so a dark corner never goes muddy; the lights do the rest.
        if (std.emissiveMap) std.emissiveIntensity = LOOK.selfGlow
      }
      // Kid drawings often have thin flat bits (capes, wings) with no back face.
      m.side = THREE.DoubleSide
    }
  })
}
