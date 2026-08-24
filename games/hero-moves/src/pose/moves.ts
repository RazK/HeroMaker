import { KEYPOINT_NAMES, type KeypointName, type Skeleton } from './keypoints'

/**
 * The move vocabulary.
 *
 * A move is just a canonical skeleton — the same shape the tracker produces.
 * That single representation does three jobs: the coach avatar is posed by
 * feeding it to the solver, the player's score is the distance between their
 * skeleton and it, and the test dancer performs by interpolating between them.
 * Nothing has to be authored twice, so the coach can never demonstrate a pose
 * the scorer is not actually looking for.
 *
 * Every move is chosen to be legible in silhouette and unambiguous in the
 * frontal plane, because a 2D tracker cannot see depth. There is no move here
 * that depends on telling "arm forward" from "arm back".
 */

/** Limb angles in degrees: 0 points to the viewer's right, 90 straight up. */
export interface MoveAngles {
  leftArm: number       // shoulder -> elbow
  leftForearm: number   // elbow -> wrist
  rightArm: number
  rightForearm: number
  leftLeg?: number      // hip -> knee
  leftShin?: number
  rightLeg?: number
  rightShin?: number
}

export interface Move {
  id: string
  /** Shown to the player. Short enough to read in a beat. */
  name: string
  angles: MoveAngles
  skeleton: Skeleton
}

// Body proportions of the canonical performer, in normalised image space.
const LAYOUT = {
  shoulderY: 0.30, hipY: 0.55,
  shoulderHalf: 0.075, hipHalf: 0.048,
  upperArm: 0.115, foreArm: 0.105,
  upperLeg: 0.155, shin: 0.150,
  noseY: 0.205, centreX: 0.5,
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Walk out from a joint along an angle. Screen y grows downward, so sin flips. */
function step(x: number, y: number, deg: number, len: number) {
  return { x: x + Math.cos(rad(deg)) * len, y: y - Math.sin(rad(deg)) * len }
}

/**
 * Build a full skeleton from limb angles. Legs default to a relaxed stance so a
 * move only has to describe what it actually cares about.
 */
export function skeletonFromAngles(a: MoveAngles): Skeleton {
  const s = Object.fromEntries(
    KEYPOINT_NAMES.map((n) => [n, { x: LAYOUT.centreX, y: LAYOUT.shoulderY, score: 1 }]),
  ) as Skeleton

  // The subject's left appears on the viewer's right.
  const lsx = LAYOUT.centreX + LAYOUT.shoulderHalf
  const rsx = LAYOUT.centreX - LAYOUT.shoulderHalf
  const lhx = LAYOUT.centreX + LAYOUT.hipHalf
  const rhx = LAYOUT.centreX - LAYOUT.hipHalf

  s.leftShoulder = { x: lsx, y: LAYOUT.shoulderY, score: 1 }
  s.rightShoulder = { x: rsx, y: LAYOUT.shoulderY, score: 1 }
  s.leftHip = { x: lhx, y: LAYOUT.hipY, score: 1 }
  s.rightHip = { x: rhx, y: LAYOUT.hipY, score: 1 }

  const le = step(lsx, LAYOUT.shoulderY, a.leftArm, LAYOUT.upperArm)
  const re = step(rsx, LAYOUT.shoulderY, a.rightArm, LAYOUT.upperArm)
  s.leftElbow = { ...le, score: 1 }
  s.rightElbow = { ...re, score: 1 }
  s.leftWrist = { ...step(le.x, le.y, a.leftForearm, LAYOUT.foreArm), score: 1 }
  s.rightWrist = { ...step(re.x, re.y, a.rightForearm, LAYOUT.foreArm), score: 1 }

  const lk = step(lhx, LAYOUT.hipY, a.leftLeg ?? -80, LAYOUT.upperLeg)
  const rk = step(rhx, LAYOUT.hipY, a.rightLeg ?? -100, LAYOUT.upperLeg)
  s.leftKnee = { ...lk, score: 1 }
  s.rightKnee = { ...rk, score: 1 }
  s.leftAnkle = { ...step(lk.x, lk.y, a.leftShin ?? -85, LAYOUT.shin), score: 1 }
  s.rightAnkle = { ...step(rk.x, rk.y, a.rightShin ?? -95, LAYOUT.shin), score: 1 }

  s.nose = { x: LAYOUT.centreX, y: LAYOUT.noseY, score: 1 }
  s.leftEye = { x: LAYOUT.centreX + 0.018, y: LAYOUT.noseY - 0.012, score: 1 }
  s.rightEye = { x: LAYOUT.centreX - 0.018, y: LAYOUT.noseY - 0.012, score: 1 }
  s.leftEar = { x: LAYOUT.centreX + 0.035, y: LAYOUT.noseY - 0.008, score: 1 }
  s.rightEar = { x: LAYOUT.centreX - 0.035, y: LAYOUT.noseY - 0.008, score: 1 }
  return s
}

const move = (id: string, name: string, angles: MoveAngles): Move =>
  ({ id, name, angles, skeleton: skeletonFromAngles(angles) })

export const MOVES: Move[] = [
  move('t', 'T-POSE', { leftArm: 0, leftForearm: 0, rightArm: 180, rightForearm: 180 }),
  move('y', 'Y-POSE', { leftArm: 45, leftForearm: 45, rightArm: 135, rightForearm: 135 }),
  move('up', 'HANDS UP', { leftArm: 75, leftForearm: 85, rightArm: 105, rightForearm: 95 }),
  move('leftUp', 'LEFT HAND UP', { leftArm: 80, leftForearm: 88, rightArm: 180, rightForearm: 180 }),
  move('rightUp', 'RIGHT HAND UP', { leftArm: 0, leftForearm: 0, rightArm: 100, rightForearm: 92 }),
  move('star', 'STAR JUMP', {
    leftArm: 50, leftForearm: 50, rightArm: 130, rightForearm: 130,
    leftLeg: -60, leftShin: -62, rightLeg: -120, rightShin: -118,
  }),
  move('hips', 'HANDS ON HIPS', { leftArm: -35, leftForearm: -125, rightArm: 215, rightForearm: 305 }),
  move('disco', 'DISCO POINT', { leftArm: 55, leftForearm: 55, rightArm: 240, rightForearm: 240 }),
  move('squat', 'SUPER SQUAT', {
    leftArm: 10, leftForearm: 10, rightArm: 170, rightForearm: 170,
    leftLeg: -55, leftShin: -110, rightLeg: -125, rightShin: -70,
  }),
]

export const MOVE_BY_ID = new Map(MOVES.map((m) => [m.id, m]))

/** Limbs the score is computed over, and how much each one counts. */
export const SCORED_LIMBS: Array<{ from: KeypointName; to: KeypointName; weight: number }> = [
  { from: 'leftShoulder', to: 'leftElbow', weight: 1.0 },
  { from: 'leftElbow', to: 'leftWrist', weight: 0.8 },
  { from: 'rightShoulder', to: 'rightElbow', weight: 1.0 },
  { from: 'rightElbow', to: 'rightWrist', weight: 0.8 },
  { from: 'leftHip', to: 'leftKnee', weight: 0.5 },
  { from: 'rightHip', to: 'rightKnee', weight: 0.5 },
]

function limbAngle(s: Skeleton, from: KeypointName, to: KeypointName): number | null {
  const a = s[from], b = s[to]
  if (a.score < 0.3 || b.score < 0.3) return null
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.hypot(dx, dy) < 0.012) return null
  return Math.atan2(-dy, dx)
}

/**
 * How well a tracked skeleton matches a move, 0..1.
 *
 * Compares limb *directions*, not joint positions, so it does not care where
 * the player stands, how tall they are, or how far from the camera — only what
 * shape they are making. Which is what a dance move is.
 */
export function scorePose(live: Skeleton, target: Skeleton): number {
  let total = 0
  let got = 0
  for (const limb of SCORED_LIMBS) {
    const want = limbAngle(target, limb.from, limb.to)
    const have = limbAngle(live, limb.from, limb.to)
    if (want === null) continue
    total += limb.weight
    if (have === null) continue
    let diff = Math.abs(want - have) % (Math.PI * 2)
    if (diff > Math.PI) diff = Math.PI * 2 - diff
    // Full marks within 15 degrees, nothing beyond 75.
    const tol = Math.PI / 12
    const max = (Math.PI * 5) / 12
    const closeness = diff <= tol ? 1 : Math.max(0, 1 - (diff - tol) / (max - tol))
    got += limb.weight * closeness
  }
  return total > 0 ? got / total : 0
}

export const gradeFor = (score: number) =>
  score >= 0.9 ? 'PERFECT' : score >= 0.75 ? 'GREAT' : score >= 0.55 ? 'GOOD' : score >= 0.35 ? 'OK' : 'MISS'
