// MediaPipe Pose (33 landmarks) → Meshy-style humanoid rig mapping helpers
// Adapted for the HeroMaker viewer; exported as an ES module.

// ───────────────────────────────────────────────────────────────────────────────
// Vec3 helpers
// ───────────────────────────────────────────────────────────────────────────────

function vAdd(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vSub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vScale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function vLen(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vNorm(v) {
    const len = vLen(v) || 1e-6;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function vLerp(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
    };
}

// ───────────────────────────────────────────────────────────────────────────────
// MediaPipe → Meshy mapping
// ───────────────────────────────────────────────────────────────────────────────

export const MEDIAPIPE_INDEX = {
    NOSE: 0,
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13,
    RIGHT_ELBOW: 14,
    LEFT_WRIST: 15,
    RIGHT_WRIST: 16,
    LEFT_HIP: 23,
    RIGHT_HIP: 24,
    LEFT_KNEE: 25,
    RIGHT_KNEE: 26,
    LEFT_ANKLE: 27,
    RIGHT_ANKLE: 28,
    LEFT_FOOT_INDEX: 31,
    RIGHT_FOOT_INDEX: 32,
};

function mediapipeToMeshyPositions(landmarks) {
    if (!landmarks || landmarks.length < 33) {
        throw new Error('mediapipeToMeshyPositions: need MediaPipe Pose 33 landmarks.');
    }

    const nose = landmarks[MEDIAPIPE_INDEX.NOSE];
    const leftShoulder = landmarks[MEDIAPIPE_INDEX.LEFT_SHOULDER];
    const rightShoulder = landmarks[MEDIAPIPE_INDEX.RIGHT_SHOULDER];
    const leftHip = landmarks[MEDIAPIPE_INDEX.LEFT_HIP];
    const rightHip = landmarks[MEDIAPIPE_INDEX.RIGHT_HIP];

    const hips = vScale(vAdd(leftHip, rightHip), 0.5);
    const chest = vScale(vAdd(leftShoulder, rightShoulder), 0.5);
    const spine = vLerp(hips, chest, 0.33);
    const neck = vLerp(chest, nose, 0.3);
    const head = nose;

    const pose = {
        Hips: hips,
        Spine: spine,
        Chest: chest,
        Neck: neck,
        Head: head,

        LeftShoulder: leftShoulder,
        LeftUpperArm: leftShoulder,
        LeftLowerArm: landmarks[MEDIAPIPE_INDEX.LEFT_ELBOW],
        LeftHand: landmarks[MEDIAPIPE_INDEX.LEFT_WRIST],

        RightShoulder: rightShoulder,
        RightUpperArm: rightShoulder,
        RightLowerArm: landmarks[MEDIAPIPE_INDEX.RIGHT_ELBOW],
        RightHand: landmarks[MEDIAPIPE_INDEX.RIGHT_WRIST],

        LeftUpperLeg: leftHip,
        LeftLowerLeg: landmarks[MEDIAPIPE_INDEX.LEFT_KNEE],
        LeftFoot: landmarks[MEDIAPIPE_INDEX.LEFT_ANKLE],
        LeftToe: landmarks[MEDIAPIPE_INDEX.LEFT_FOOT_INDEX],

        RightUpperLeg: rightHip,
        RightLowerLeg: landmarks[MEDIAPIPE_INDEX.RIGHT_KNEE],
        RightFoot: landmarks[MEDIAPIPE_INDEX.RIGHT_ANKLE],
        RightToe: landmarks[MEDIAPIPE_INDEX.RIGHT_FOOT_INDEX],
    };

    return pose;
}

function computeMeshyBoneDirections(positions) {
    const dirs = {};

    function setDir(bone, fromKey, toKey) {
        const from = positions[fromKey];
        const to = positions[toKey];
        if (!from || !to) return;
        dirs[bone] = vNorm(vSub(to, from));
    }

    setDir('Hips', 'Hips', 'Spine');
    setDir('Spine', 'Spine', 'Chest');
    setDir('Chest', 'Chest', 'Neck');
    setDir('Neck', 'Neck', 'Head');

    setDir('LeftShoulder', 'LeftShoulder', 'LeftLowerArm');
    setDir('LeftUpperArm', 'LeftUpperArm', 'LeftLowerArm');
    setDir('LeftLowerArm', 'LeftLowerArm', 'LeftHand');

    setDir('RightShoulder', 'RightShoulder', 'RightLowerArm');
    setDir('RightUpperArm', 'RightUpperArm', 'RightLowerArm');
    setDir('RightLowerArm', 'RightLowerArm', 'RightHand');

    setDir('LeftUpperLeg', 'LeftUpperLeg', 'LeftLowerLeg');
    setDir('LeftLowerLeg', 'LeftLowerLeg', 'LeftFoot');
    setDir('LeftFoot', 'LeftFoot', 'LeftToe');

    setDir('RightUpperLeg', 'RightUpperLeg', 'RightLowerLeg');
    setDir('RightLowerLeg', 'RightLowerLeg', 'RightFoot');
    setDir('RightFoot', 'RightFoot', 'RightToe');

    return dirs;
}

function mediapipeToMeshy(landmarks) {
    const positions = mediapipeToMeshyPositions(landmarks);
    const directions = computeMeshyBoneDirections(positions);
    return { positions, directions };
}

export {
    mediapipeToMeshy,
    mediapipeToMeshyPositions,
    computeMeshyBoneDirections,
    vAdd,
    vSub,
    vScale,
    vLen,
    vNorm,
    vLerp,
};
