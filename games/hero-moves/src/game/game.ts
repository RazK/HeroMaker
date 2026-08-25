import { bodyConfidence, type Skeleton } from '../pose/keypoints'
import { gradeFor, scorePose, type Move } from '../pose/moves'
import { ROUTINE, slotAt, secondsPerBeat, upcoming, type Song, type Upcoming } from './song'

/**
 * The run.
 *
 * There are no turns. The leader dances the routine from the first beat to the
 * last, the player is scored against it continuously, and a slot closes on the
 * beat it ends — banking the best frame the player managed while it was up.
 * Best-of-window rather than average is deliberate: it forgives the reaction
 * time of somebody watching a leader and copying, which is the whole activity.
 */

export type Phase = 'title' | 'countdown' | 'dancing' | 'results'

export interface RoundResult {
  move: Move
  score: number
  grade: string
}

export interface GameState {
  phase: Phase
  /** Seconds since the routine's first beat. Negative during the count-in. */
  songTime: number
  beat: number
  /** 0..1 within the current beat, for anything that pulses. */
  beatPhase: number
  slotIndex: number
  move: Move | null
  totalMoves: number
  /** 0..1 through the current move. */
  moveProgress: number
  liveScore: number
  bestThisMove: number
  score: number
  combo: number
  bestCombo: number
  results: RoundResult[]
  seesPlayer: boolean
  /** What the strip shows: this move and the ones behind it. */
  next: Upcoming[]
}

const blank = (song: Song): GameState => ({
  phase: 'title',
  songTime: -song.leadInBeats * secondsPerBeat(song.bpm),
  beat: -song.leadInBeats,
  beatPhase: 0,
  slotIndex: -1,
  move: null,
  totalMoves: song.slots.length,
  moveProgress: 0,
  liveScore: 0,
  bestThisMove: 0,
  score: 0,
  combo: 0,
  bestCombo: 0,
  results: [],
  seesPlayer: false,
  next: [],
})

export class Game {
  song: Song = ROUTINE
  state: GameState = blank(ROUTINE)

  private startedAt = 0
  /** Slot the player is currently being scored against. */
  private scoring = -1

  onPhase: ((p: Phase) => void) | null = null
  onGrade: ((r: RoundResult) => void) | null = null

  get beatSeconds() { return secondsPerBeat(this.song.bpm) }
  /** Length of the whole run including the count-in, in seconds. */
  get duration() {
    return (this.song.totalBeats + this.song.leadInBeats) * this.beatSeconds
  }

  /** `moves` of 0 dances the whole routine; a smaller number cuts it short. */
  start(now: number, moves = 0) {
    const song = moves > 0 ? cut(ROUTINE, moves) : ROUTINE
    this.song = song
    this.state = blank(song)
    this.startedAt = now
    this.scoring = -1
    this.state.phase = 'countdown'
    this.onPhase?.('countdown')
  }

  /** Feed one frame of tracking; `skeleton` may be null when nobody is seen. */
  update(now: number, skeleton: Skeleton | null) {
    const s = this.state
    if (s.phase === 'title' || s.phase === 'results') return

    const beatSeconds = this.beatSeconds
    s.songTime = now - this.startedAt - this.song.leadInBeats * beatSeconds
    s.beat = s.songTime / beatSeconds
    s.beatPhase = ((s.beat % 1) + 1) % 1
    s.seesPlayer = !!skeleton && bodyConfidence(skeleton) > 0.25

    if (s.phase === 'countdown') {
      if (s.songTime < 0) return
      s.phase = 'dancing'
      this.onPhase?.('dancing')
    }

    const index = slotAt(this.song, s.beat)

    // A slot ending is the only moment anything is banked.
    if (index !== this.scoring && this.scoring >= 0) this.bank()

    if (index !== this.scoring) {
      this.scoring = index
      s.bestThisMove = 0
      s.liveScore = 0
    }

    s.slotIndex = index
    const slot = index >= 0 ? this.song.slots[index] : null
    s.move = slot?.move ?? null
    s.moveProgress = slot ? (s.beat - slot.startBeat) / slot.beats : 0
    s.next = upcoming(this.song, s.beat)

    if (slot && skeleton) {
      s.liveScore = scorePose(skeleton, slot.move.skeleton, slot.move)
      if (s.liveScore > s.bestThisMove) s.bestThisMove = s.liveScore
    } else if (!slot) {
      s.liveScore = 0
    }

    if (s.beat >= this.song.totalBeats) {
      s.phase = 'results'
      this.onPhase?.('results')
    }
  }

  /** Close the slot the player was being scored against. */
  private bank() {
    const s = this.state
    const slot = this.song.slots[this.scoring]
    if (!slot) return
    const grade = gradeFor(s.bestThisMove)
    const result: RoundResult = { move: slot.move, score: s.bestThisMove, grade }
    s.results.push(result)
    // 1000 for a perfect hit, and a combo bonus that tops out rather than
    // running away — an uncapped one reached x42 in testing and made the
    // number meaningless.
    s.score += Math.round(s.bestThisMove * 1000) * (1 + Math.min(4, s.combo) * 0.25)
    if (s.bestThisMove >= 0.55) {
      s.combo += 1
      s.bestCombo = Math.max(s.bestCombo, s.combo)
    } else {
      s.combo = 0
    }
    this.onGrade?.(result)
  }

  /** Average match across the run, which is what the results screen reports. */
  get accuracy() {
    const r = this.state.results
    return r.length ? r.reduce((a, x) => a + x.score, 0) / r.length : 0
  }
}

/** A shorter routine, for recordings and for testing. */
function cut(song: Song, moves: number): Song {
  const slots = song.slots.slice(0, moves)
  const totalBeats = slots.reduce((a, s) => a + s.beats, 0)
  return { ...song, slots, totalBeats }
}

export { ROUTINE, secondsPerBeat }
