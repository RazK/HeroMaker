/** The 17 COCO keypoints MoveNet returns, in the order it returns them. */
export const KEYPOINT_NAMES = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
] as const

export type KeypointName = (typeof KEYPOINT_NAMES)[number]

export interface Keypoint {
  /** Normalised 0..1 across the frame, origin top-left. */
  x: number
  y: number
  score: number
}

export type Skeleton = Record<KeypointName, Keypoint>

/** Left/right are the *subject's* own, so a mirrored view still maps correctly. */
export const LIMBS: Array<[KeypointName, KeypointName]> = [
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
]

export const emptySkeleton = (): Skeleton =>
  Object.fromEntries(KEYPOINT_NAMES.map((n) => [n, { x: 0.5, y: 0.5, score: 0 }])) as Skeleton

/** Mean confidence over the joints that actually matter for dancing. */
export function bodyConfidence(s: Skeleton): number {
  const core: KeypointName[] = [
    'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
    'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  ]
  return core.reduce((sum, n) => sum + s[n].score, 0) / core.length
}
