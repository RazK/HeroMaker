/**
 * The screen is a mirror: pinned. Run with `npm test` (tools/mirrortest.mjs).
 *
 * A player copies what they see the way they copy a mirror. So for every
 * asymmetric call:
 *
 *  - the pictogram, the hero and the camera preview all show the raised arm on
 *    the same side of the screen;
 *  - that side is the side the named arm is on in a mirror ("RIGHT ARM UP" is
 *    raised on the screen's right, where your right hand is in a mirror);
 *  - a player who copies the pictogram like a mirror scores PERFECT, and one who
 *    copies it the other way round does not.
 *
 * The chain it walks is the game's own: the vocabulary's camera-space
 * templates, `onScreen` (the flip the preview, the hero and the pictograms
 * share), and `shapeScore`, the function that grades a round. The one link it
 * cannot run in Node — that the solver poses a hero so a camera sees the
 * skeleton it was given — is what tools/posecheck.mjs and posegate measure on
 * rendered heroes.
 */
import { CALLS, shapeScore } from '../src/game/party'
import { gradeFor } from '../src/pose/moves'
import { classify } from '../src/pose/vocab'
import { onScreen, mirrorSkeleton } from '../src/pose/mirror'
import { pictogramSkeleton } from '../src/ui/pictogram'
import type { Skeleton } from '../src/pose/keypoints'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed++
}

/** Which side of the screen the higher wrist is on, in a skeleton's own frame. */
const raisedSide = (s: Skeleton) => {
  const w = s.leftWrist.y < s.rightWrist.y ? s.leftWrist : s.rightWrist
  return w.x > 0.5 ? 'right' : 'left'
}

// A mirror flip is an involution and keeps a well-labelled body.
const t = CALLS.get('lshape')!.skeleton
const twice = mirrorSkeleton(mirrorSkeleton(t))
check(Object.keys(t).every((k) => Math.abs(twice[k as keyof Skeleton].x - t[k as keyof Skeleton].x) < 1e-9),
  'mirroring twice is the identity')

const CASES: Array<[string, 'left' | 'right']> = [
  // The named arm is the one raised; in a mirror your right hand is on your right.
  ['rightUp', 'right'],
  ['leftUp', 'left'],
  // L SHAPE raises the left arm and holds the right one out.
  ['lshape', 'left'],
]

for (const [id, side] of CASES) {
  const move = CALLS.get(id)!
  // What the player sees: the strip's icon, exactly as pictogram.ts draws it.
  const shown = pictogramSkeleton(move)
  check(raisedSide(shown) === side, `${id}: pictogram and hero raise the arm on the screen's ${side}`)

  // A player who copies it like a mirror makes a body whose mirrored preview
  // looks like what they copied — so the camera, which is not mirrored, sees
  // the flip of it.
  const mirrorCopy = mirrorSkeleton(shown)
  // The preview shows mirrorCopy flipped back, on the same side as the pictogram.
  check(raisedSide(onScreen(mirrorCopy)) === side, `${id}: the preview shows the player's arm on the same side`)
  // The hero is posed from onScreen(camera skeleton), on the same side too.
  check(raisedSide(onScreen(mirrorCopy)) === raisedSide(shown), `${id}: the hero copies the player on the same side`)
  const good = gradeFor(shapeScore(mirrorCopy, move))
  check(good === 'PERFECT', `${id}: copying it like a mirror scores ${good}`)
  check(classify(mirrorCopy).pose?.id === id, `${id}: the classifier names the mirror copy ${classify(mirrorCopy).pose?.id}`)

  // Copying it the other way round (raising the arm on the opposite side of
  // the screen) is the wrong pose and must not pass.
  const backwards = shown
  const bad = gradeFor(shapeScore(backwards, move))
  check(bad !== 'PERFECT' && bad !== 'GREAT', `${id}: copying it un-mirrored scores ${bad}`)
}

// The hero is posed in main.ts, which needs a browser; check it hands the
// solver the mirrored skeleton rather than the camera's.
declare const __GAME_ROOT__: string
const main = readFileSync(`${__GAME_ROOT__}/src/main.ts`, 'utf8')
check(/const sk = raw \? onScreen\(raw\) : null/.test(main) && /lane\.solver\.apply\(sk, dt\)/.test(main),
  'main.ts poses the hero from onScreen(camera skeleton)')

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nthe screen is a mirror')
