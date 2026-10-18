import type { CueKind, Mood, ScorePlan } from './music'
import birthday from './stories/birthday.json'
import superhero from './stories/superhero.json'
import show from './stories/show.json'
import greetings from './stories/greetings.json'

/**
 * A film is a script: a title and a list of beats, each one a backdrop, what
 * the hero does, where the camera goes, a line of storybook text, and a mood
 * for the music. Scripts are plain JSON (src/film/stories/) with `{hero}`,
 * `{artist}`, `{to}` and `{from}` filled in at play time, so a new story is a
 * new file — or, later, the output of an LLM asked for exactly this shape.
 */

/** One move. `at` is seconds into the beat; a one-shot hands back to `idle` when done. */
export interface Act {
  at: number
  clip: string
  loop?: boolean
  speed?: number
  /** Start this far into the clip, in seconds. */
  offset?: number
}

/** Where the hero stands at `t` seconds into the beat. Metres and degrees; yaw 0 faces the camera. */
/** `pitch` tips the hero towards (negative) or away from the camera, about the feet — for flying. */
export interface Key { t: number; x?: number; y?: number; z?: number; yaw?: number; pitch?: number }

export type ShotKind = 'wide' | 'medium' | 'close' | 'low' | 'top'
/**
 * A camera position, relative to the hero. `az` swings round in degrees (never
 * past ±40: the front of a hero is the part a child drew; the back is
 * extrapolated). `push` scales the solved distance.
 */
export interface Shot { shot: ShotKind; az?: number; push?: number }

export type FxKind = 'confetti' | 'sparkle' | 'stars' | 'hearts' | 'snow'
export interface Fx { kind: FxKind; at?: number; palette?: string; dur?: number }

export type Card = 'title' | 'end' | 'greeting-end'
export type Transition = 'iris' | 'cut' | 'flash' | 'wipe'

export interface Beat {
  dur: number
  backdrop: string
  /** Storybook line along the bottom. */
  text?: string
  /** Big headline along the top (the greeting's occasion). */
  title?: string
  /** A small line under the headline, or a signature on the plate. */
  sub?: string
  card?: Card
  acts: Act[]
  path?: Key[]
  camera: { from: Shot; to?: Shot }
  fx?: Fx[]
  mood: Mood
  /** How this beat begins. */
  transition?: Transition
  sfx?: Array<{ at: number; kind: CueKind; dur?: number }>
}

export interface Script {
  id: string
  /** The menu name for the story. */
  label: string
  title: string
  bpm: number
  /** Seconds in which the free teaser freezes and the paywall shows. */
  paywallAt?: number
  beats: Beat[]
}

export interface Names { hero: string; artist: string; age?: string; to?: string; from?: string }

export const STORIES: Script[] = [birthday as Script, superhero as Script, show as Script]

interface Occasion { id: string; label: string; to: string; script: Script }
export const OCCASIONS: Occasion[] = greetings as Occasion[]

export function fill(s: string | undefined, n: Names): string {
  if (!s) return ''
  return s
    .replace(/\{hero\}/g, n.hero)
    .replace(/\{artist\}/g, n.artist)
    .replace(/\{to\}/g, n.to ?? '')
    .replace(/\{from\}/g, n.from ?? n.artist)
    .replace(/\s+([!?.,])/g, '$1')
    .trim()
}

/** A beat placed on the film's clock. */
export interface Placed extends Beat { index: number; start: number; end: number }

export function place(script: Script): { beats: Placed[]; duration: number } {
  let t = 0
  const beats = script.beats.map((b, index) => {
    const p = { ...b, index, start: t, end: t + b.dur }
    t += b.dur
    return p
  })
  return { beats, duration: t }
}

/** The music and sound effects for a placed script. */
export function scoreFor(script: Script, beats: Placed[], duration: number): ScorePlan {
  const sections = beats.map((b) => ({ start: b.start, end: b.end, mood: b.mood }))
  // Merge neighbours in the same mood so the tune runs on across a cut.
  const merged = sections.reduce<typeof sections>((acc, s) => {
    const last = acc[acc.length - 1]
    if (last && last.mood === s.mood && s.mood !== 'hbd') last.end = s.end
    else acc.push({ ...s })
    return acc
  }, [])
  const cues = beats.flatMap((b) => [
    ...(b.index > 0 && (b.transition ?? 'iris') !== 'cut' && b.transition !== 'flash' ? [{ at: Math.max(0, b.start - 0.3), kind: 'whoosh' as const }] : []),
    ...(b.sfx ?? []).map((c) => ({ ...c, at: b.start + c.at })),
  ])
  return { duration, bpm: script.bpm, sections: merged, cues }
}
