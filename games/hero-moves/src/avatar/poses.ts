import { mirror, type Pose } from './rig'

/**
 * ## Rig-local axis conventions
 *
 * three-vrm's normalized humanoid rig keeps the source model's axes, and the
 * HeroMaker pipeline emits VRM 0.0, so in *bone-local* space:
 *
 *   +Y  up            −Z  forward           −X  the avatar's left
 *
 * Rest is a T-pose with identity rotations on every bone, which gives:
 *
 * | bone points | rotation | effect                                  |
 * |-------------|----------|-----------------------------------------|
 * | +Y (torso)  | X < 0    | tilt forward   (X > 0 tilts back)       |
 * | +Y (torso)  | Y > 0    | turn toward the avatar's left           |
 * | +Y (torso)  | Z > 0    | lean toward the avatar's left           |
 * | −X (L arm)  | Z > 0    | arm swings DOWN from the T-pose         |
 * | −X (L arm)  | Y < 0    | arm swings forward (once still at side)  |
 * | −X (L arm)  | X > 0    | arm swings forward (once brought down)  |
 * | −Y (leg)    | X > 0    | leg swings forward                      |
 * | −Y (leg)    | Z < 0    | left leg abducts outward                |
 *
 * Euler order is XYZ, i.e. R = Rx·Ry·Rz, so the Z term lands first — which is
 * why "bring the arm down, then swing it" reads as (swing, _, down).
 *
 * Every pose here is rotation-only. That is the whole trick: it looks
 * deliberate on a hero with a head 30% of their height, on a five-pointed star
 * with two legs, and on a cloud, without a single per-avatar tweak.
 */

/** Rest is a T-pose, so every grounded state starts by lowering the arms. */
export const ARM_DOWN = 1.33

/** Idle: breathing, a slow weight shift, arms hanging with a soft bend. */
export function idlePose(t: number): Pose {
  const breath = Math.sin(t * 1.9)
  const sway = Math.sin(t * 0.85)
  const armL = [0.06 * breath, -0.12, ARM_DOWN - 0.10 - 0.04 * breath] as const
  return {
    hips: [0, 0.04 * sway, -0.02 * sway],
    spine: [-0.02 - 0.015 * breath, -0.03 * sway, 0],
    chest: [-0.015 * breath, 0, 0],
    neck: [0.03 + 0.02 * breath, 0.05 * sway, 0],
    head: [0.02, 0.08 * sway, 0],
    leftShoulder: [0, 0, 0.06 + 0.03 * breath],
    rightShoulder: mirror([0, 0, 0.06 + 0.03 * breath]),
    leftUpperArm: armL,
    rightUpperArm: mirror(armL),
    leftLowerArm: [0, -0.34, 0.10],
    rightLowerArm: mirror([0, -0.34, 0.10]),
    leftUpperLeg: [0.02, 0, -0.04],
    rightUpperLeg: mirror([0.02, 0, -0.04]),
    leftLowerLeg: [0.06, 0, 0],
    rightLowerLeg: [0.06, 0, 0],
  }
}

/**
 * Run cycle. `p` is the stride phase; legs swing in antiphase, arms
 * counter-swing against the same-side leg, and the torso pitches into it.
 */
export function runPose(p: number, intensity: number): Pose {
  const a = p * Math.PI * 2
  const swing = 0.70 + 0.34 * intensity
  const armSwing = 0.60 + 0.34 * intensity
  const lean = 0.16 + 0.22 * intensity

  const thighL = -swing * Math.sin(a)
  const thighR = -swing * Math.sin(a + Math.PI)
  const kneeL = 0.35 + 1.35 * Math.max(0, Math.sin(a - 0.9))
  const kneeR = 0.35 + 1.35 * Math.max(0, Math.sin(a + Math.PI - 0.9))
  const footL = 0.30 - 0.45 * Math.sin(a + 0.6)
  const footR = 0.30 - 0.45 * Math.sin(a + Math.PI + 0.6)

  const armL = armSwing * Math.sin(a + Math.PI)   // opposes the left leg
  const armR = armSwing * Math.sin(a)
  const elbow = 1.05 + 0.35 * intensity
  const twist = 0.16 * Math.sin(a)

  return {
    hips: [-0.05, twist, 0],
    spine: [-lean * 0.55, -twist * 0.6, 0],
    chest: [-lean * 0.30, -twist * 0.5, 0],
    upperChest: [-lean * 0.20, -twist * 0.4, 0],
    neck: [lean * 0.62, twist * 0.5, 0],
    head: [lean * 0.50, twist * 0.4, 0],
    leftShoulder: [0, 0, 0.10 + 0.05 * Math.sin(a + Math.PI)],
    rightShoulder: mirror([0, 0, 0.10 + 0.05 * Math.sin(a)]),
    leftUpperArm: [armL, -0.16, ARM_DOWN - 0.14],
    rightUpperArm: [armR, 0.16, -(ARM_DOWN - 0.14)],
    leftLowerArm: [0, -elbow, 0.10],
    rightLowerArm: mirror([0, -elbow, 0.10]),
    leftUpperLeg: [thighL, 0, -0.03],
    rightUpperLeg: [thighR, 0, 0.03],
    leftLowerLeg: [kneeL, 0, 0],
    rightLowerLeg: [kneeR, 0, 0],
    leftFoot: [footL, 0, 0],
    rightFoot: [footR, 0, 0],
    leftToes: [0.25, 0, 0],
    rightToes: [0.25, 0, 0],
  }
}

/** Jump: `k` runs 0 (launch) → 1 (apex, knees tucked) → 2 (legs reaching down). */
export function jumpPose(k: number): Pose {
  const tuck = k < 1 ? k : Math.max(0, 2 - k)
  const reach = k > 1 ? k - 1 : 0
  // Arms punch up as the knees come up.
  const armZ = ARM_DOWN - 0.55 - 0.75 * tuck
  const arm = [0.35 + 0.30 * tuck, -0.22, armZ] as const
  return {
    hips: [-0.10 - 0.14 * tuck + 0.16 * reach, 0, 0],
    spine: [-0.18 * tuck + 0.10 * reach, 0, 0],
    chest: [-0.10 * tuck, 0, 0],
    neck: [0.16 + 0.12 * tuck, 0, 0],
    head: [0.14, 0, 0],
    leftShoulder: [0, 0, 0.18 + 0.14 * tuck],
    rightShoulder: mirror([0, 0, 0.18 + 0.14 * tuck]),
    leftUpperArm: arm,
    rightUpperArm: mirror(arm),
    leftLowerArm: [0, -0.60 - 0.30 * tuck, 0.12],
    rightLowerArm: mirror([0, -0.60 - 0.30 * tuck, 0.12]),
    leftUpperLeg: [0.55 + 0.95 * tuck - 0.80 * reach, 0, -0.10],
    rightUpperLeg: [0.40 + 0.95 * tuck - 0.75 * reach, 0, 0.10],
    leftLowerLeg: [0.75 + 1.10 * tuck - 0.60 * reach, 0, 0],
    rightLowerLeg: [0.60 + 1.10 * tuck - 0.55 * reach, 0, 0],
    leftFoot: [-0.20 + 0.30 * reach, 0, 0],
    rightFoot: [-0.20 + 0.30 * reach, 0, 0],
    leftToes: [0.35, 0, 0],
    rightToes: [0.35, 0, 0],
  }
}

/** Baseball slide: reclined, lead leg straight out, trailing leg folded under. */
export function slidePose(t: number): Pose {
  const wobble = 0.05 * Math.sin(t * 22)
  return {
    hips: [0.98 + wobble, -0.22, 0],
    spine: [0.16, 0.14, 0],
    chest: [0.10, 0.10, 0],
    neck: [-0.55, -0.14, 0],
    head: [-0.42, -0.16, 0],
    leftShoulder: [0, 0, 0.30],
    rightShoulder: mirror([0, 0, 0.05]),
    leftUpperArm: [0.30, -0.30, ARM_DOWN - 0.30],
    rightUpperArm: [-0.95, 0.20, -(ARM_DOWN - 0.10)],
    leftLowerArm: [0, -0.95, 0.20],
    rightLowerArm: mirror([0, -0.30, 0.10]),
    leftUpperLeg: [0.55, 0.10, -0.22],
    rightUpperLeg: [0.10, -0.22, 0.18],
    leftLowerLeg: [0.20, 0, 0],
    rightLowerLeg: [1.95, 0, 0],
    leftFoot: [-0.35, 0, 0],
    rightFoot: [0.30, 0, 0],
    leftToes: [0.20, 0, 0],
    rightToes: [0.20, 0, 0],
  }
}

/** Star pose: arms and legs thrown wide — the shape the pose gates cut out. */
export function starPose(t: number): Pose {
  const pulse = 0.06 * Math.sin(t * 14)
  const arm = [0, 0, -0.44 - pulse] as const
  return {
    hips: [0, 0, 0],
    spine: [0.08, 0, 0],
    chest: [0.06, 0, 0],
    neck: [-0.06, 0, 0],
    head: [-0.10, 0, 0],
    leftShoulder: [0, 0, -0.18 - pulse],
    rightShoulder: mirror([0, 0, -0.18 - pulse]),
    leftUpperArm: arm,
    rightUpperArm: mirror(arm),
    leftLowerArm: [0, 0, -0.10],
    rightLowerArm: mirror([0, 0, -0.10]),
    leftUpperLeg: [0, 0, -0.46 - pulse],
    rightUpperLeg: mirror([0, 0, -0.46 - pulse]),
    leftLowerLeg: [0.08, 0, 0],
    rightLowerLeg: [0.08, 0, 0],
    leftFoot: [0.12, 0, 0],
    rightFoot: [0.12, 0, 0],
  }
}

/** Flying hero: pitched forward into a dive, lead fist out, legs trailing. */
export function flyPose(t: number): Pose {
  const bank = 0.15 * Math.sin(t * 1.6)
  const kick = 0.20 * Math.sin(t * 3.1)
  return {
    // X < 0 pitches forward, so the head leads and the legs trail.
    hips: [-0.98, bank * 0.5, 0],
    spine: [0.16, -bank * 0.4, bank],
    chest: [0.10, -bank * 0.3, bank * 0.6],
    neck: [0.72, bank * 0.4, 0],          // head back up, to look where we're going
    head: [0.44, bank * 0.5, 0],
    leftShoulder: [0, 0, -0.14],
    rightShoulder: mirror([0, 0, 0.20]),
    leftUpperArm: [0.15, -1.48, 0.05],    // punched forward
    rightUpperArm: [-0.25, 0.35, -(ARM_DOWN - 0.08)],
    leftLowerArm: [0, -0.10, 0],
    rightLowerArm: mirror([0, -0.30, 0.10]),
    leftUpperLeg: [0.10 + kick, 0, -0.10],
    rightUpperLeg: [0.10 - kick, 0, 0.10],
    leftLowerLeg: [0.26 - kick * 0.8, 0, 0],
    rightLowerLeg: [0.26 + kick * 0.8, 0, 0],
    leftFoot: [-0.45, 0, 0],
    rightFoot: [-0.45, 0, 0],
    leftToes: [0.45, 0, 0],
    rightToes: [0.45, 0, 0],
  }
}

/** Stumble: windmilling arms and a jackknifed torso. Deliberately floppy. */
export function stumblePose(t: number): Pose {
  const w = t * 15
  return {
    hips: [-0.34, 0.20 * Math.sin(w * 0.7), 0.14 * Math.sin(w * 0.5)],
    spine: [-0.42, -0.20 * Math.sin(w * 0.7), 0.10 * Math.sin(w)],
    chest: [-0.20, 0, 0],
    neck: [0.50, 0, 0],
    head: [0.34, 0.25 * Math.sin(w * 1.3), 0],
    leftShoulder: [0, 0, 0.26],
    rightShoulder: mirror([0, 0, 0.26]),
    leftUpperArm: [0.9 * Math.sin(w), -0.35, 0.35 + 0.30 * Math.sin(w * 0.9)],
    rightUpperArm: mirror([0.9 * Math.sin(w + 2.1), -0.35, 0.35 + 0.30 * Math.sin(w * 0.9 + 1)]),
    leftLowerArm: [0, -1.25 - 0.4 * Math.sin(w * 1.7), 0.18],
    rightLowerArm: mirror([0, -1.25 - 0.4 * Math.sin(w * 1.7 + 1), 0.18]),
    leftUpperLeg: [0.70, 0, -0.12],
    rightUpperLeg: [-0.28, 0, 0.12],
    leftLowerLeg: [0.95, 0, 0],
    rightLowerLeg: [0.30, 0, 0],
    leftFoot: [-0.20, 0, 0],
    rightFoot: [0.20, 0, 0],
  }
}

/** End of run: land on one knee, then rise into a fists-up victory. */
export function victoryPose(t: number): Pose {
  const rise = Math.min(1, Math.max(0, (t - 0.25) / 0.9))
  const breath = 0.05 * Math.sin(t * 2.2)
  const blend = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
    [a[0] + (b[0] - a[0]) * rise, a[1] + (b[1] - a[1]) * rise, a[2] + (b[2] - a[2]) * rise] as const

  const kneelArm = [0.60, -0.30, ARM_DOWN - 0.35] as const
  const cheerArm = [0.30, -0.25, -0.62 - breath] as const

  return {
    hips: blend([-0.50, 0, 0], [0, 0, 0]),
    spine: blend([-0.24, 0.20, 0], [0.10 + breath, 0, 0]),
    chest: blend([-0.12, 0.15, 0], [0.08, 0, 0]),
    neck: blend([0.30, -0.20, 0], [-0.10, 0, 0]),
    head: blend([0.22, -0.25, 0], [-0.12, 0, 0]),
    leftShoulder: blend([0, 0, 0.12], [0, 0, -0.22]),
    rightShoulder: mirror(blend([0, 0, 0.12], [0, 0, -0.22])),
    leftUpperArm: blend(kneelArm, cheerArm),
    rightUpperArm: mirror(blend(kneelArm, cheerArm)),
    leftLowerArm: blend([0, -1.40, 0.18], [0, -0.30, -0.10]),
    rightLowerArm: mirror(blend([0, -1.40, 0.18], [0, -0.30, -0.10])),
    leftUpperLeg: blend([1.70, 0.15, -0.20], [0.04, 0, -0.10]),
    rightUpperLeg: blend([-0.35, -0.15, 0.28], [0.04, 0, 0.10]),
    leftLowerLeg: blend([1.85, 0, 0], [0.10, 0, 0]),
    rightLowerLeg: blend([1.95, 0, 0], [0.10, 0, 0]),
    leftFoot: [0.15, 0, 0],
    rightFoot: [0.15, 0, 0],
  }
}
