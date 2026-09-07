import { MOVES, MOVE_BY_ID, type Move } from '../pose/moves'

/**
 * The routine, as a timeline.
 *
 * The first version of this game alternated: the hero demonstrated, then it
 * mirrored you. One body doing two jobs, and no way to tell which job it was
 * doing except by reading the screen — so it read as a race condition. Here the
 * routine is one continuous thing a leader dances from start to finish, and the
 * player is mirrored the whole way through by a *second* body. Nobody ever
 * swaps roles, so nothing has to be explained.
 *
 * A timeline also gives the player the one thing call-and-response could not:
 * sight of what is coming. `upcoming` feeds the strip of pictograms that slides
 * toward the beat marker.
 */

export interface Slot {
  move: Move
  /** Beat this move starts on, counted from the first beat of the routine. */
  startBeat: number
  beats: number
}

export interface Song {
  bpm: number
  slots: Slot[]
  totalBeats: number
  /** Beats of music before the first move, so the player can find the pulse. */
  leadInBeats: number
}

/** Seconds per beat at a given tempo. */
export const secondsPerBeat = (bpm: number) => 60 / bpm

/**
 * Builds a routine from a list of move ids and how many beats each is held.
 * Anything unknown is skipped rather than throwing: a routine is content, and
 * content should not be able to break the game.
 */
export function buildSong(
  steps: Array<[string, number]>,
  { bpm = 100, leadInBeats = 8 } = {},
): Song {
  const slots: Slot[] = []
  let beat = 0
  for (const [id, beats] of steps) {
    const move = MOVE_BY_ID.get(id)
    if (!move) continue
    slots.push({ move, startBeat: beat, beats })
    beat += beats
  }
  return { bpm, slots, totalBeats: beat, leadInBeats }
}

/**
 * The routine everyone dances.
 *
 * It opens wide and slow so the shapes are easy to read, tightens in the middle
 * where the player knows the vocabulary, and finishes on the two biggest
 * silhouettes. Four beats is the default hold: long enough to see the leader
 * take the shape, react, and be caught in it.
 */
export const ROUTINE = buildSong([
  ['t', 4], ['y', 4], ['t', 4], ['y', 4],
  ['up', 4], ['hips', 4], ['up', 4], ['hips', 4],
  ['leftUp', 4], ['rightUp', 4], ['leftUp', 2], ['rightUp', 2], ['up', 4],
  ['disco', 4], ['hips', 2], ['disco', 2], ['star', 4],
  ['squat', 4], ['star', 4], ['y', 4], ['star', 4],
])

/** Index of the slot live at `beat`, or -1 before the first / after the last. */
export function slotAt(song: Song, beat: number): number {
  if (beat < 0) return -1
  for (let i = 0; i < song.slots.length; i++) {
    const s = song.slots[i]
    if (beat >= s.startBeat && beat < s.startBeat + s.beats) return i
  }
  return -1
}

export interface Upcoming {
  move: Move
  /** Beats until this move starts. Negative once it has passed the line. */
  beatsAway: number
  /** Which slot this is, so the strip can track one tile across frames. */
  startBeat: number
}

/**
 * What the strip shows.
 *
 * Every slot from a couple of beats *past* the line to `count` ahead of it, so
 * a tile can travel all the way through the line and off the left edge instead
 * of piling up on it. The strip used to hold a move for its whole duration and
 * clamp it at the marker, which meant a four-beat move sat on the marker while
 * the next one slid in beside it — two poses in the box at once, and no moment
 * that read as "now".
 */
export function upcoming(song: Song, beat: number, count = 5, tail = 1.6): Upcoming[] {
  const out: Upcoming[] = []
  for (const s of song.slots) {
    const away = s.startBeat - beat
    if (away < -tail) continue
    out.push({ move: s.move, beatsAway: away, startBeat: s.startBeat })
    if (out.length >= count) break
  }
  return out
}

/** Every distinct move the routine uses, for pre-rendering pictograms. */
export const routineMoves = (song: Song): Move[] => {
  const seen = new Set<string>()
  return song.slots.map((s) => s.move).filter((m) => !seen.has(m.id) && seen.add(m.id))
}

export { MOVES }
