import type { Skeleton } from '../pose/keypoints'
import { bodyConfidence } from '../pose/keypoints'
import { MOVES, gradeFor, scorePose, type Move } from '../pose/moves'

/**
 * Round structure.
 *
 * Each move is coached, then copied. The coach beat exists because a player
 * cannot be scored on a shape nobody has shown them, and because it is the
 * moment the avatar performs on its own — the thing the pipeline is really
 * being shown off by.
 *
 * The player's score for a move is the *best* frame they hit during the copy
 * window, not the average. Dancing is hitting the shape, and averaging would
 * punish the travel time between poses rather than the pose itself.
 */

export type Phase = 'title' | 'countdown' | 'coach' | 'copy' | 'grade' | 'results'

export const TIMING = {
  bpm: 100,
  /** Beats spent demonstrating, then copying. */
  coachBeats: 4,
  copyBeats: 4,
  gradeBeats: 2,
  countdownBeats: 4,
} as const

export const beatSeconds = 60 / TIMING.bpm

export interface RoundResult {
  move: Move
  score: number
  grade: string
}

export interface GameState {
  phase: Phase
  moveIndex: number
  totalMoves: number
  move: Move
  /** 0..1 through the current phase. */
  phaseProgress: number
  /** Live match for the current frame, only meaningful during `copy`. */
  liveScore: number
  bestThisMove: number
  score: number
  combo: number
  bestCombo: number
  results: RoundResult[]
  /** False when the tracker cannot see anybody. */
  seesPlayer: boolean
}

export class Game {
  private phaseEnds = 0
  private phaseStarted = 0
  private order: Move[] = []

  state: GameState = {
    phase: 'title', moveIndex: 0, totalMoves: 0, move: MOVES[0],
    phaseProgress: 0, liveScore: 0, bestThisMove: 0,
    score: 0, combo: 0, bestCombo: 0, results: [], seesPlayer: false,
  }

  onPhase: ((p: Phase) => void) | null = null
  onGrade: ((r: RoundResult) => void) | null = null

  /** `rounds` of 0 means every move once, in order. */
  start(now: number, rounds = 0) {
    this.order = rounds > 0 ? MOVES.slice(0, rounds) : MOVES.slice()
    this.state = {
      phase: 'title', moveIndex: 0, totalMoves: this.order.length, move: this.order[0],
      phaseProgress: 0, liveScore: 0, bestThisMove: 0,
      score: 0, combo: 0, bestCombo: 0, results: [], seesPlayer: false,
    }
    this.enter('countdown', now, TIMING.countdownBeats)
  }

  private enter(phase: Phase, now: number, beats: number) {
    this.state.phase = phase
    this.phaseStarted = now
    this.phaseEnds = now + beats * beatSeconds
    this.onPhase?.(phase)
  }

  /** Feed one frame of tracking; `skeleton` may be null when there is none. */
  update(now: number, skeleton: Skeleton | null) {
    const s = this.state
    const span = Math.max(0.001, this.phaseEnds - this.phaseStarted)
    s.phaseProgress = Math.min(1, (now - this.phaseStarted) / span)
    s.seesPlayer = !!skeleton && bodyConfidence(skeleton) > 0.25

    if (s.phase === 'copy' && skeleton) {
      s.liveScore = scorePose(skeleton, s.move.skeleton, s.move)
      if (s.liveScore > s.bestThisMove) s.bestThisMove = s.liveScore
    }

    if (now < this.phaseEnds) return

    switch (s.phase) {
      case 'countdown':
        this.enter('coach', now, TIMING.coachBeats)
        break
      case 'coach':
        s.bestThisMove = 0
        s.liveScore = 0
        this.enter('copy', now, TIMING.copyBeats)
        break
      case 'copy': {
        const grade = gradeFor(s.bestThisMove)
        const result: RoundResult = { move: s.move, score: s.bestThisMove, grade }
        s.results.push(result)
        // 1000 points for a perfect hit, and a combo for anything decent.
        s.score += Math.round(s.bestThisMove * 1000) * (1 + Math.min(4, s.combo) * 0.25)
        if (s.bestThisMove >= 0.55) {
          s.combo += 1
          s.bestCombo = Math.max(s.bestCombo, s.combo)
        } else {
          s.combo = 0
        }
        this.onGrade?.(result)
        this.enter('grade', now, TIMING.gradeBeats)
        break
      }
      case 'grade':
        if (s.moveIndex + 1 >= this.order.length) {
          this.enter('results', now, 0)
        } else {
          s.moveIndex += 1
          s.move = this.order[s.moveIndex]
          this.enter('coach', now, TIMING.coachBeats)
        }
        break
      default:
        break
    }
  }

  /** Average match across the run, which is what the results screen reports. */
  get accuracy() {
    const r = this.state.results
    return r.length ? r.reduce((a, b) => a + b.score, 0) / r.length : 0
  }
}
