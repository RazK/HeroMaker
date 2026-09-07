import type { KeypointName, Skeleton } from './keypoints'
import { skeletonFromAngles, type MoveAngles } from './moves'

/**
 * A pose *vocabulary*, and a classifier over it.
 *
 * This is a different question from the one `scorePose` answers, and a much
 * easier one. Scoring asks "how close is this pose to that pose?" — a
 * continuous judgement, and the regime 17 noisy 2D keypoints are worst in.
 * Classifying asks "which of eight deliberately-separated poses is this?" A
 * label survives jitter that a percentage does not, and its ceiling can be
 * proved with a one-frame harness instead of hoped for.
 *
 * ## What the features deliberately avoid
 *
 * Measured on production avatars with `tools/posecheck.mjs`: MoveNet reports
 * shoulders, hips, wrists, knees and ankles at 0.6-0.8 confidence, but
 * **elbows at 0.25-0.66** and places them far too close to the shoulder —
 * these heroes have smooth sausage arms with no crease to find. A hand held
 * against a big head or a mass of hair is lost outright.
 *
 * So no feature here touches an elbow, and no pose in the vocabulary puts a
 * hand near the head. Every feature is built from the joints the tracker
 * actually sees, and every one is scale- and position-invariant, because a
 * child stands wherever they like.
 */

export interface Pose {
  id: string
  /** Said out loud by the hero. Short enough to hear in a beat. */
  name: string
  angles: MoveAngles
  skeleton: Skeleton
  features: number[]
}

/**
 * Feature vector. Angles are in turns (0..1 of a full circle) rather than
 * radians so every component lands in a comparable range and one plain
 * Euclidean distance is meaningful without per-axis weights.
 */
export const FEATURE_NAMES = [
  'leftArmDir', 'rightArmDir', 'armSpread', 'stanceWidth', 'hipDrop', 'lean',
] as const

const TAU = Math.PI * 2

/** Unit-normalised direction from `a` to `b`, or null if either is unreliable. */
function dir(s: Skeleton, a: KeypointName, b: KeypointName, min = 0.25) {
  const p = s[a], q = s[b]
  if (p.score < min || q.score < min) return null
  const dx = q.x - p.x, dy = q.y - p.y
  const n = Math.hypot(dx, dy)
  if (n < 0.01) return null
  return { x: dx / n, y: dy / n, len: n }
}

const mid = (s: Skeleton, a: KeypointName, b: KeypointName) => ({
  x: (s[a].x + s[b].x) / 2,
  y: (s[a].y + s[b].y) / 2,
  score: Math.min(s[a].score, s[b].score),
})

/**
 * Turn a skeleton into the six numbers the classifier compares.
 *
 * Returns null when too little of the body is visible to judge — an honest
 * "I cannot see you" rather than a confident wrong label.
 */
export function features(s: Skeleton): number[] | null {
  const shoulders = mid(s, 'leftShoulder', 'rightShoulder')
  const hips = mid(s, 'leftHip', 'rightHip')
  if (shoulders.score < 0.25 || hips.score < 0.25) return null

  // Torso length is the scale for everything else: it is the most reliably
  // tracked distance on the body and it does not change when you move a limb.
  const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y)
  if (torso < 0.02) return null
  const shoulderWidth = Math.max(0.02, Math.abs(s.leftShoulder.x - s.rightShoulder.x))

  // Arm direction, shoulder to wrist. Screen y grows downward, so it is
  // negated to make "up" positive and the angle read the way a person would
  // describe it.
  const la = dir(s, 'leftShoulder', 'leftWrist')
  const ra = dir(s, 'rightShoulder', 'rightWrist')
  if (!la || !ra) return null
  const leftArmDir = Math.atan2(-la.y, la.x) / TAU
  const rightArmDir = Math.atan2(-ra.y, ra.x) / TAU

  // How far the hands are from each other, in torsos. Separates a wide T from
  // hands together without caring which way either arm points.
  const armSpread = Math.hypot(s.leftWrist.x - s.rightWrist.x, s.leftWrist.y - s.rightWrist.y) / torso

  // Feet apart, in shoulder widths. The one leg feature that survives a
  // tracker that puts knees in roughly the right place but not exactly.
  const ankles = Math.min(s.leftAnkle.score, s.rightAnkle.score) > 0.25
    ? Math.abs(s.leftAnkle.x - s.rightAnkle.x) / shoulderWidth
    : 1
  const stanceWidth = ankles

  // Crouch: how far the hips have dropped toward the ankles, as a fraction of
  // standing height. Uses only hips and ankles, never knees.
  const ankleY = Math.min(s.leftAnkle.score, s.rightAnkle.score) > 0.25
    ? (s.leftAnkle.y + s.rightAnkle.y) / 2
    : hips.y + torso
  const legSpan = Math.max(0.02, ankleY - hips.y)
  const hipDrop = 1 - legSpan / (torso * 1.35)

  // Lean: how far the shoulders sit sideways of the hips, in torsos.
  const lean = (shoulders.x - hips.x) / torso

  return [leftArmDir, rightArmDir, armSpread, stanceWidth, hipDrop, lean]
}

/**
 * How much each feature counts. Arm direction carries the vocabulary; stance
 * and crouch separate the two poses that arms alone cannot.
 */
const WEIGHTS = [1.0, 1.0, 0.35, 0.7, 1.0, 0.4]

function distance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    let d = a[i] - b[i]
    // The two arm-direction components are angles in turns and wrap around.
    if (i < 2) { d = ((d % 1) + 1.5) % 1 - 0.5 }
    sum += (d * WEIGHTS[i]) ** 2
  }
  return Math.sqrt(sum)
}

const pose = (id: string, name: string, angles: MoveAngles): Pose => {
  const skeleton = skeletonFromAngles(angles)
  return { id, name, angles, skeleton, features: features(skeleton)! }
}

/**
 * The eight calls.
 *
 * Chosen to be maximally separated in the feature space above, and every one
 * legible in silhouette. Note what is *not* here: nothing with a hand beside
 * the head, nothing that depends on an elbow bend, and nothing asymmetric in
 * depth — a 2D tracker cannot tell an arm forward from an arm back.
 *
 * The vocabulary is built from *arm configuration first*, because the two
 * shoulder-to-wrist directions are the only features the tracker delivers
 * reliably on every subject. Each arm takes one of three states — down, out,
 * up — and six of the eight calls are distinct pairs of those. Legs are a
 * confirming cue, never the deciding one.
 *
 * HANDS ON HIPS used to be here and was measured at 13% in the confusion
 * matrix: a wrist resting on a hip and a wrist hanging beside one are the same
 * point to within the tracker's error, so the pose is not separable from ARMS
 * DOWN however the classifier is tuned.
 *
 * Its first replacement, LEFT ARM OUT, measured 0% — every frame read as ARMS
 * OUT, because an arm hanging beside the torso and an arm held horizontally are
 * separated by less than the tracker's error once the wrist is near the body.
 * The lesson generalises: **out-versus-down on the same arm is not a usable
 * distinction; up-versus-anything is.** So every asymmetric call in this
 * vocabulary raises one arm rather than lowering one. The two leg poses differ
 * from their nearest arm-twin on *two* independent leg cues, stance width and
 * hip drop, rather than one.
 */
export const VOCAB: Pose[] = [
  pose('down', 'ARMS DOWN', {
    leftArm: -62, leftForearm: -72, rightArm: 242, rightForearm: 252,
  }),
  pose('out', 'ARMS OUT', { leftArm: 0, leftForearm: 0, rightArm: 180, rightForearm: 180 }),
  pose('up', 'ARMS UP', { leftArm: 62, leftForearm: 62, rightArm: 118, rightForearm: 118 }),
  pose('leftUp', 'LEFT ARM UP', {
    leftArm: 62, leftForearm: 62, rightArm: 242, rightForearm: 252,
  }),
  pose('rightUp', 'RIGHT ARM UP', {
    leftArm: -62, leftForearm: -72, rightArm: 118, rightForearm: 118,
  }),
  pose('lshape', 'L SHAPE', {
    leftArm: 62, leftForearm: 62, rightArm: 180, rightForearm: 180,
  }),
  pose('star', 'STAR', {
    leftArm: 45, leftForearm: 45, rightArm: 135, rightForearm: 135,
    leftLeg: -58, leftShin: -60, rightLeg: -122, rightShin: -120,
  }),
  pose('crouch', 'CROUCH', {
    leftArm: 0, leftForearm: 0, rightArm: 180, rightForearm: 180,
    leftLeg: -48, leftShin: -118, rightLeg: -132, rightShin: -62,
  }),
]

export const POSE_BY_ID = new Map(VOCAB.map((p) => [p.id, p]))

export interface Classification {
  pose: Pose | null
  /** Distance to the winner. Smaller is better; 0 is exact. */
  distance: number
  /** How much further away the runner-up is. Low margin means "not sure". */
  margin: number
  runnerUp: Pose | null
}

/**
 * Name the pose, or return null.
 *
 * Two guards, both there to make the classifier say "I don't know" rather than
 * guess: the winner has to be within `maxDistance`, and it has to beat the
 * runner-up by `minMargin`. A player halfway between two calls is not
 * arbitrarily assigned to one of them.
 *
 * The defaults are measured, not guessed. Over 40 correct frames of a posed
 * avatar at five camera distances and angles (`tools/posegate.mjs`), the
 * distance to the winning pose ran median 0.301 / p90 0.414 / p99 0.494, and
 * the margin over the runner-up ran median 0.089 with a p10 of 0.036. The
 * first pass at these thresholds was guessed at 0.19 and 0.035 and threw away
 * 90% of frames the classifier had got right — a system that is perfectly
 * accurate and permanently unsure is just as broken as an inaccurate one.
 *
 * Caveat worth keeping: those frames are a *rendered avatar* standing in for a
 * player. A real body in a real room is an easier subject for MoveNet, but the
 * numbers should be re-measured from webcam frames before they are trusted in
 * anger.
 */
export function classify(s: Skeleton, maxDistance = 0.52, minMargin = 0.015): Classification {
  const f = features(s)
  if (!f) return { pose: null, distance: Infinity, margin: 0, runnerUp: null }

  const ranked = VOCAB
    .map((p) => ({ p, d: distance(f, p.features) }))
    .sort((a, b) => a.d - b.d)

  const [best, second] = ranked
  const margin = second ? second.d - best.d : Infinity
  const ok = best.d <= maxDistance && margin >= minMargin
  return {
    pose: ok ? best.p : null,
    distance: best.d,
    margin,
    runnerUp: second?.p ?? null,
  }
}

/** Nearest label regardless of the guards. Used by the gate to build a matrix. */
export function nearest(s: Skeleton): Pose | null {
  const f = features(s)
  if (!f) return null
  let bestPose = VOCAB[0]
  let bestD = Infinity
  for (const p of VOCAB) {
    const d = distance(f, p.features)
    if (d < bestD) { bestD = d; bestPose = p }
  }
  return bestPose
}

/** Pairwise separation of the vocabulary itself, before any tracking noise. */
export function vocabularySeparation(): Array<{ a: string; b: string; d: number }> {
  const out: Array<{ a: string; b: string; d: number }> = []
  for (let i = 0; i < VOCAB.length; i++) {
    for (let j = i + 1; j < VOCAB.length; j++) {
      out.push({ a: VOCAB[i].id, b: VOCAB[j].id, d: distance(VOCAB[i].features, VOCAB[j].features) })
    }
  }
  return out.sort((x, y) => x.d - y.d)
}
