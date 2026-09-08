import { bodyConfidence, type Skeleton } from '../pose/keypoints'
import { gradeFor, scorePose, type Move } from '../pose/moves'
import { buildSong, slotAt, secondsPerBeat, upcoming, type Song, type Upcoming } from './song'
import { VOCAB, classify, type Pose } from '../pose/vocab'

/**
 * The party game: one to three players, one lane each, one routine.
 *
 * Every player dances the same timeline and is scored separately, so nobody is
 * ever sitting out watching — which matters more than tension when the players
 * are six. There is no coach and no demonstrator on stage: the strip alone says
 * what is coming and when, and each hero mirrors its own player and nothing
 * else, so no character on screen is ever ambiguous about whose it is.
 *
 * The clock is wall-clock and pausable. Pausing is not a nicety here: a
 * three-player game in a living room gets interrupted, and a rhythm game with
 * no way to stop is a rhythm game people quit out of rather than pause.
 */

export type PartyPhase = 'menu' | 'countdown' | 'dancing' | 'paused' | 'results'

/** Round lengths offered in the menu. Beats, at the routine's tempo. */
export const LENGTHS = [
  { id: 'short', label: 'Short', moves: 8, blurb: '~30 sec' },
  { id: 'normal', label: 'Normal', moves: 16, blurb: '~1 min' },
  { id: 'long', label: 'Long', moves: 32, blurb: '~2 min' },
] as const
export type LengthId = (typeof LENGTHS)[number]['id']

/**
 * The calls, and the pool a routine is drawn from.
 *
 * These are the classifier's vocabulary, not the old scorer's move list, and
 * that is the whole scoring model: asking "which of eight deliberately
 * separated poses is this" reads correctly on every frame, while asking "how
 * close are these two poses" tops out well below a perfect performance on 17
 * noisy 2D keypoints. Measured at 100% across five camera angles in
 * `tools/posegate.mjs`.
 *
 * ARMS DOWN is in the vocabulary but never in the pool: standing still must
 * never be a move, or the winner is whoever does nothing.
 */
const asMove = (p: Pose): Move =>
  ({ id: p.id, name: p.name, angles: p.angles, skeleton: p.skeleton, weights: null })

export const CALLS = new Map(VOCAB.map((p) => [p.id, asMove(p)]))
const POOL = VOCAB.filter((p) => p.id !== 'down').map((p) => p.id)

/** How long a lane stays "occupied" after its last confident look. */
const SEEN_GRACE_BEATS = 3

export interface PlayerResult {
  move: Move
  score: number
  grade: string
}

export interface Player {
  /** Lane index, 0 = leftmost on screen. */
  lane: number
  heroIndex: number
  score: number
  combo: number
  bestCombo: number
  /** Best match seen so far in the current slot. */
  best: number
  bestAtBeat: number
  liveScore: number
  results: PlayerResult[]
  /** False when this lane has nobody in it. */
  seen: boolean
  /** Beat this lane was last confidently occupied, for the grace period. */
  seenAt: number
  /** Grade to pop over this player's hero, consumed by the HUD. */
  flash: string | null
  flashAt: number
}

export interface PartyState {
  phase: PartyPhase
  players: Player[]
  songTime: number
  beat: number
  beatPhase: number
  slotIndex: number
  move: Move | null
  next: Upcoming[]
  totalMoves: number
}

const newPlayer = (lane: number, heroIndex: number): Player => ({
  lane, heroIndex,
  score: 0, combo: 0, bestCombo: 0,
  best: 0, bestAtBeat: 0, liveScore: 0,
  results: [], seen: false, seenAt: -99, flash: null, flashAt: 0,
})

/** A routine of `moves` calls, drawn from the pool without immediate repeats. */
export function makeRoutine(moves: number, seed = 1): Song {
  let s = seed >>> 0
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const steps: Array<[string, number]> = []
  let last = ''
  for (let i = 0; i < moves; i++) {
    let id = POOL[Math.floor(rand() * POOL.length)]
    // Never the same call twice running: a repeat reads as the strip being
    // stuck, and it gives away a free hit to anyone who simply held still.
    while (id === last) id = POOL[Math.floor(rand() * POOL.length)]
    last = id
    // Tighten up as the routine goes on, so it builds.
    const beats = i > moves * 0.7 && rand() < 0.4 ? 2 : 4
    if (CALLS.has(id)) steps.push([id, beats])
  }
  return buildSong(steps, { bpm: 100, leadInBeats: 8, lookup: CALLS })
}

export class PartyGame {
  song: Song = makeRoutine(16)
  state: PartyState = {
    phase: 'menu', players: [], songTime: 0, beat: 0, beatPhase: 0,
    slotIndex: -1, move: null, next: [], totalMoves: 0,
  }

  /** Wall-clock at which the routine's beat zero falls. Shifts when paused. */
  private origin = 0
  private pausedAt = 0
  private scoring = -1

  onPhase: ((p: PartyPhase) => void) | null = null
  onGrade: ((p: Player, r: PlayerResult) => void) | null = null

  get beatSeconds() { return secondsPerBeat(this.song.bpm) }

  /**
   * `seed` is exposed so a recording can render its dancers against the exact
   * routine the game will play. Left out, every round is a different one.
   */
  start(now: number, heroes: number[], length: LengthId = 'normal', seed?: number) {
    const spec = LENGTHS.find((l) => l.id === length) ?? LENGTHS[1]
    this.song = makeRoutine(spec.moves, seed ?? (Date.now() & 0xffff))
    this.state = {
      phase: 'countdown',
      players: heroes.map((h, i) => newPlayer(i, h)),
      songTime: -this.song.leadInBeats * this.beatSeconds,
      beat: -this.song.leadInBeats, beatPhase: 0,
      slotIndex: -1, move: null, next: [], totalMoves: this.song.slots.length,
    }
    this.origin = now + this.song.leadInBeats * this.beatSeconds
    this.scoring = -1
    this.onPhase?.('countdown')
  }

  pause(now: number) {
    if (this.state.phase !== 'dancing' && this.state.phase !== 'countdown') return
    this.pausedAt = now
    this.state.phase = 'paused'
    this.onPhase?.('paused')
  }

  resume(now: number) {
    if (this.state.phase !== 'paused') return
    // Slide the origin by however long we were away, so the beat the player
    // comes back to is the beat they left rather than one further on.
    this.origin += now - this.pausedAt
    this.state.phase = this.state.songTime < 0 ? 'countdown' : 'dancing'
    this.onPhase?.(this.state.phase)
  }

  quit() {
    this.state.phase = 'menu'
    this.onPhase?.('menu')
  }

  /** End the run early but keep the scores, so a stopped game still has a winner. */
  finish() {
    if (this.state.phase === 'menu' || this.state.phase === 'results') return
    this.state.phase = 'results'
    this.onPhase?.('results')
  }

  /** `lanes` is one skeleton per player, in lane order. */
  update(now: number, lanes: Array<Skeleton | null>) {
    const s = this.state
    if (s.phase === 'menu' || s.phase === 'results' || s.phase === 'paused') return

    const bs = this.beatSeconds
    s.songTime = now - this.origin
    s.beat = s.songTime / bs
    s.beatPhase = ((s.beat % 1) + 1) % 1

    // The strip runs through the count-in. A rhythm game whose timeline only
    // appears on beat one gives the player nothing to read during the four
    // seconds specifically set aside for reading it.
    s.next = upcoming(this.song, s.beat)

    if (s.phase === 'countdown') {
      if (s.songTime < 0) return
      s.phase = 'dancing'
      this.onPhase?.('dancing')
    }

    const index = slotAt(this.song, s.beat)
    if (index !== this.scoring && this.scoring >= 0) this.bank()
    if (index !== this.scoring) {
      this.scoring = index
      for (const p of s.players) { p.best = 0; p.liveScore = 0; p.bestAtBeat = s.beat }
    }

    s.slotIndex = index
    const slot = index >= 0 ? this.song.slots[index] : null
    s.move = slot?.move ?? null

    for (const p of s.players) {
      const sk = lanes[p.lane] ?? null
      // Lanes are inferred round robin, so a lane is only refreshed every
      // `players` frames — without a grace period the "step in" badge blinks
      // on and off at the tracker's rate rather than saying anything about
      // whether a player is there.
      if (sk && bodyConfidence(sk) > 0.25) p.seenAt = s.beat
      p.seen = s.beat - p.seenAt < SEEN_GRACE_BEATS
      if (!slot || !sk || !p.seen) { p.liveScore = 0; continue }
      p.liveScore = shapeScore(sk, slot.move)
      if (p.liveScore > p.best) { p.best = p.liveScore; p.bestAtBeat = s.beat }
    }

    if (s.beat >= this.song.totalBeats) {
      s.phase = 'results'
      this.onPhase?.('results')
    }
  }

  private bank() {
    const s = this.state
    const slot = this.song.slots[this.scoring]
    if (!slot) return
    for (const p of s.players) {
      // Same shape-times-timing rule the single-player game uses: a hit inside
      // half a beat of the call is on time, and lateness costs up to 40%.
      const late = Math.max(0, p.bestAtBeat - slot.startBeat)
      const timing = clamp01(1 - (late - 0.5) / Math.max(0.5, slot.beats - 0.5))
      // Timing shades a hit; it never turns one into a miss. Making the right
      // shape late is a GOOD, and being early is not a thing you can be.
      const scored = p.best * (0.7 + 0.3 * timing)
      const grade = gradeFor(scored)
      const result: PlayerResult = { move: slot.move, score: scored, grade }
      p.results.push(result)
      p.score += Math.round(scored * 1000) * (1 + Math.min(4, p.combo) * 0.25)
      if (scored >= 0.55) { p.combo += 1; p.bestCombo = Math.max(p.bestCombo, p.combo) }
      else p.combo = 0
      p.flash = grade
      p.flashAt = s.beat
      this.onGrade?.(p, result)
    }
  }

  /** Players sorted best first, for the podium. */
  get ranking(): Player[] {
    return [...this.state.players].sort((a, b) => b.score - a.score)
  }

  accuracy(p: Player): number {
    return p.results.length ? p.results.reduce((a, r) => a + r.score, 0) / p.results.length : 0
  }
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * How well a body is making the called shape, 0..1.
 *
 * A label when the tracker is sure, a shape match when it is not.
 *
 * The label is the primary judgement, because naming one of eight
 * deliberately-separated poses is the question 17 noisy 2D keypoints can
 * actually answer — and because a wrong call then scores nothing, which is what
 * makes a three-player scoreboard worth reading. A continuous scorer on its own
 * hands a player standing perfectly still most of the marks for any pose that
 * happens to sit near neutral.
 *
 * But the classifier is built to say "I don't know" rather than guess, and it
 * says so more often than it is wrong: a hand lost in hair, a body at an angle,
 * a hero whose legs are half the length the vocabulary assumes. Scoring those
 * frames zero would be the classifier's caution charged to the player. So when
 * there is no confident label, the older continuous scorer answers the easier
 * question — how close is this to the shape — and its answer is capped below
 * what a named pose can earn, because it is the weaker instrument.
 */
function shapeScore(sk: Skeleton, move: Move): number {
  const c = classify(sk)
  if (c.pose) return c.pose.id === move.id ? 0.62 + 0.38 * clamp01(1 - c.distance / 0.52) : 0
  return 0.8 * scorePose(sk, move.skeleton, move)
}
