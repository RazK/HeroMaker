import type { ClipSpec } from '../anim/performer'
import { CLIPS } from '../anim/performer'

/**
 * The film's acting vocabulary: every move a story beat can name.
 *
 * The game's eight moves plus what a story needs a hero to *act*: arrive, say
 * hello, wonder, power up, take a bow. All of it is Quaternius' CC0 Universal
 * Animation Library (fetched and trimmed by tools/fetch-animations.mjs) or the
 * MIT jump, played through the same rotation-only retarget the game uses — so
 * it lands on a cactus, a cereal box or a girl in a tutu alike.
 */
const UAL = 'Quaternius UAL (CC0)'
export const FILM_CLIPS: ClipSpec[] = [
  ...CLIPS,
  { id: 'idle', url: 'Idle_A.glb', kind: 'gltf', credit: UAL },
  { id: 'walk', url: 'Walk.glb', kind: 'gltf', credit: UAL },
  { id: 'wave', url: 'Greeting.glb', kind: 'gltf', credit: UAL },
  { id: 'nod', url: 'Head_Nod.glb', kind: 'gltf', credit: UAL },
  { id: 'yes', url: 'Yes.glb', kind: 'gltf', credit: UAL },
  { id: 'confused', url: 'Confused.glb', kind: 'gltf', credit: UAL },
  { id: 'cheer', url: 'Victory.glb', kind: 'gltf', credit: UAL },
  { id: 'jacks', url: 'Jumping_Jacks.glb', kind: 'gltf', credit: UAL },
  { id: 'hipdance', url: 'Dance_Reach_Hip.glb', kind: 'gltf', credit: UAL },
  { id: 'bounce', url: 'Dance_Simple.glb', kind: 'gltf', credit: UAL },
  { id: 'powerup', url: 'Power_Up.glb', kind: 'gltf', credit: UAL },
  { id: 'blast', url: 'Two_hand_Blast.glb', kind: 'gltf', credit: UAL },
  { id: 'bow', url: 'Bow.glb', kind: 'gltf', credit: UAL },
  { id: 'swim', url: 'Swim_Fwd.glb', kind: 'gltf', credit: UAL },
  { id: 'float', url: 'Swim_Idle.glb', kind: 'gltf', credit: UAL },
]

export const clipSpec = (id: string) => FILM_CLIPS.find((c) => c.id === id)
