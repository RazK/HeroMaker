import { KEYPOINT_NAMES, type KeypointName, type Skeleton } from './keypoints'

/**
 * The screen is a mirror. One rule, three places.
 *
 * The tracker reports the body as the camera sees it: the player's own right
 * arm, raised, lands on the *left* of the camera image, and every skeleton in
 * this game (the vocabulary's templates, the tracker's lanes, the classifier's
 * features) uses that camera space with anatomical names. That is right for
 * judging — "RIGHT ARM UP" passes when the player's right arm is up — and wrong
 * for anything drawn on screen, because a player copies the screen the way they
 * copy a mirror: they raise the arm on the same side as the one they see.
 *
 * The camera preview was already mirrored. The hero and the move pictograms
 * were not: the hero was a direct puppet (the player's right arm drove the
 * hero's right arm, which a hero facing you shows on the screen's left), and the
 * pictogram drew the template in camera space. So a raised right arm showed on
 * the right of the preview and on the left of the hero, and a player who copied
 * a pictogram the natural way made the opposite pose and scored nothing.
 *
 * Fixed at the boundary rather than in the data: judging stays in camera space,
 * and everything the player *sees* goes through `onScreen`, which is the same
 * flip the preview applies to the video. tools/mirrortest.mjs pins it.
 */

const PAIRS: Array<[KeypointName, KeypointName]> = [
  ['leftEye', 'rightEye'], ['leftEar', 'rightEar'],
  ['leftShoulder', 'rightShoulder'], ['leftElbow', 'rightElbow'], ['leftWrist', 'rightWrist'],
  ['leftHip', 'rightHip'], ['leftKnee', 'rightKnee'], ['leftAnkle', 'rightAnkle'],
]
const OTHER = new Map<KeypointName, KeypointName>()
for (const [a, b] of PAIRS) { OTHER.set(a, b); OTHER.set(b, a) }

/**
 * The mirror image of a skeleton: x flipped across the middle of its frame and
 * every left/right pair swapped, so it is still a correctly-labelled body —
 * the body a person standing where the mirror is would have to make.
 */
export function mirrorSkeleton(s: Skeleton): Skeleton {
  const out = {} as Skeleton
  for (const name of KEYPOINT_NAMES) {
    const src = s[OTHER.get(name) ?? name]
    out[name] = { x: 1 - src.x, y: src.y, score: src.score }
  }
  return out
}

/**
 * Camera space to what the player sees. The preview flips the video with this
 * rule, the hero is posed from it, and the pictograms are drawn from it.
 */
export const onScreen = mirrorSkeleton
