/**
 * The backdrops the player can choose between.
 *
 * Six sets, all generated at runtime from code — see `kit.ts` for why nothing
 * here is a downloaded bitmap. Every one of them obeys the same two rules,
 * because the heroes are the point and a backdrop that competes with a
 * crayon-drawn character has failed:
 *
 * 1. **Something dark sits behind the bodies.** The heroes occupy the middle
 *    ~70% of the frame standing on the floor; whatever the sky is doing, that
 *    band of world is a dark tree line, a dark skyline, a dark house or open
 *    space, plus a soft scrim over it.
 * 2. **The floor is themed but never missing.** An avatar with no ground plane
 *    and nothing under its feet floats, so each theme brings its own disc, its
 *    own pool of light and a painted contact shade that survives the game
 *    dropping shadows on a slow device.
 */
import type { Backdrop, Quality, StageEnv } from './env'
import { create as theatre } from './themes/theatre'
import { create as space } from './themes/space'
import { create as nature } from './themes/nature'
import { create as circus } from './themes/circus'
import { create as reef } from './themes/reef'
import { create as sunset } from './themes/sunset'

export type { Backdrop, Quality, StageEnv }

export interface BackdropSpec {
  id: string
  /** Shown in the menu. Keep it short. */
  name: string
  /** One line for a tooltip. */
  blurb: string
}

/** Theatre first: it is the default. */
export const BACKDROPS: BackdropSpec[] = [
  { id: 'theatre', name: 'Theatre', blurb: 'Velvet curtains, footlights and a warm spot on the boards.' },
  { id: 'space', name: 'Deep Space', blurb: 'A nebula, a ringed planet and a glass dance floor among the stars.' },
  { id: 'nature', name: 'Forest Glade', blurb: 'A sunlit clearing with pollen in the beams and leaves on the breeze.' },
  { id: 'circus', name: 'Big Top', blurb: 'Under the striped canvas, bunting overhead and confetti on the beat.' },
  { id: 'reef', name: 'Coral Reef', blurb: 'Caustics on the sand, kelp swaying and bubbles rising to the surface.' },
  { id: 'sunset', name: 'Rooftop Sunset', blurb: 'Golden hour over the skyline, with festoon lights strung round the roof.' },
]

type Factory = (q: Quality) => Backdrop

const FACTORIES: Record<string, Factory> = {
  theatre, space, nature, circus, reef, sunset,
}

export const DEFAULT_BACKDROP = BACKDROPS[0].id

export const isBackdropId = (id: string): boolean => id in FACTORIES

/** Build one. An unknown id falls back to the default rather than throwing. */
export function createBackdrop(id: string, quality: Quality = 'full'): Backdrop {
  const make = FACTORIES[id] ?? FACTORIES[DEFAULT_BACKDROP]
  return make(quality)
}
