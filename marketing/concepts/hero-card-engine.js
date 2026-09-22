/* GENERATED — do not edit.
 * Built from games/hero-moves/src/{avatar/loader,anim/clips,anim/retarget}.ts
 * by marketing/concepts/build-engine.mjs. Re-run that script to refresh it.
 */

// games/hero-moves/src/avatar/loader.ts
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

// games/hero-moves/src/avatar/rig.ts
var BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes"
];
var Rig = class {
  constructor(vrm) {
    this.vrm = vrm;
    this.nodes = /* @__PURE__ */ new Map();
    for (const b of BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(b);
      if (node) this.nodes.set(b, node);
    }
    this.hipsRestY = this.nodes.get("hips")?.position.y ?? 0;
  }
  has(b) {
    return this.nodes.has(b);
  }
};

// games/hero-moves/src/avatar/loader.ts
var loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function dataUriToArrayBuffer(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("malformed data URI");
  const meta = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  if (meta.includes(";base64")) return base64ToArrayBuffer(payload);
  const text = decodeURIComponent(payload);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
async function withImageElementTextures(fn) {
  const globals = globalThis;
  const original = globals.createImageBitmap;
  if (original === void 0) return fn();
  globals.createImageBitmap = void 0;
  try {
    return await fn();
  } finally {
    globals.createImageBitmap = original;
  }
}
function loadGltf(url) {
  if (!url.startsWith("data:")) return loader.loadAsync(url);
  const buffer = dataUriToArrayBuffer(url);
  return new Promise((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
}
function addOutline(scene, thickness) {
  const additions = [];
  scene.traverse((obj) => {
    const mesh = obj;
    if (!mesh.isSkinnedMesh || !mesh.geometry.getAttribute("normal")) return;
    const mat = new THREE.MeshBasicMaterial({ color: 2366510, side: THREE.BackSide, fog: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uThickness = { value: thickness };
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uThickness;").replace(
        "#include <skinning_vertex>",
        "#include <skinning_vertex>\ntransformed += objectNormal * uThickness;"
      );
    };
    const outline = new THREE.SkinnedMesh(mesh.geometry, mat);
    outline.bindMode = mesh.bindMode;
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.frustumCulled = false;
    outline.renderOrder = -1;
    additions.push({ parent: mesh.parent ?? scene, mesh: outline });
  });
  additions.forEach(({ parent, mesh }) => parent.add(mesh));
}
async function loadHero(url, opts = {}) {
  const gltf = await withImageElementTextures(() => loadGltf(url));
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("not a VRM file");
  VRMUtils.rotateVRM0(vrm);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    const mesh = obj;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m;
      if (std.isMeshStandardMaterial) {
        std.roughness = 0.92;
        std.metalness = 0;
      }
      m.side = THREE.DoubleSide;
    }
  });
  const rig = new Rig(vrm);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  vrm.scene.position.y -= box.min.y;
  if (opts.outline !== false) {
    try {
      addOutline(vrm.scene, Math.max(6e-3, size.y * 6e-3));
    } catch {
    }
  }
  const root = new THREE.Group();
  root.add(vrm.scene);
  return {
    root,
    vrm,
    rig,
    height: size.y,
    width: size.x,
    radius: Math.max(0.25, Math.max(size.x, size.z) * 0.22),
    dispose() {
      root.removeFromParent();
      VRMUtils.deepDispose(vrm.scene);
    }
  };
}

// games/hero-moves/src/anim/clips.ts
import { GLTFLoader as GLTFLoader2 } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip
} from "@pixiv/three-vrm-animation";

// games/hero-moves/src/anim/retarget.ts
import * as THREE2 from "three";
var UE_RIG = {
  hips: "pelvis",
  bones: {
    pelvis: "hips",
    spine_01: "spine",
    spine_02: "chest",
    spine_03: "upperChest",
    neck_01: "neck",
    head: "head",
    clavicle_l: "leftShoulder",
    upperarm_l: "leftUpperArm",
    lowerarm_l: "leftLowerArm",
    hand_l: "leftHand",
    clavicle_r: "rightShoulder",
    upperarm_r: "rightUpperArm",
    lowerarm_r: "rightLowerArm",
    hand_r: "rightHand",
    thigh_l: "leftUpperLeg",
    calf_l: "leftLowerLeg",
    foot_l: "leftFoot",
    ball_l: "leftToes",
    thigh_r: "rightUpperLeg",
    calf_r: "rightLowerLeg",
    foot_r: "rightFoot",
    ball_r: "rightToes"
  }
};
var MIXAMO_RIG = {
  hips: "mixamorigHips",
  bones: {
    mixamorigHips: "hips",
    mixamorigSpine: "spine",
    mixamorigSpine1: "chest",
    mixamorigSpine2: "upperChest",
    mixamorigNeck: "neck",
    mixamorigHead: "head",
    mixamorigLeftShoulder: "leftShoulder",
    mixamorigLeftArm: "leftUpperArm",
    mixamorigLeftForeArm: "leftLowerArm",
    mixamorigLeftHand: "leftHand",
    mixamorigRightShoulder: "rightShoulder",
    mixamorigRightArm: "rightUpperArm",
    mixamorigRightForeArm: "rightLowerArm",
    mixamorigRightHand: "rightHand",
    mixamorigLeftUpLeg: "leftUpperLeg",
    mixamorigLeftLeg: "leftLowerLeg",
    mixamorigLeftFoot: "leftFoot",
    mixamorigLeftToeBase: "leftToes",
    mixamorigRightUpLeg: "rightUpperLeg",
    mixamorigRightLeg: "rightLowerLeg",
    mixamorigRightFoot: "rightFoot",
    mixamorigRightToeBase: "rightToes"
  }
};
var _rest = new THREE2.Quaternion();
var _parentRest = new THREE2.Quaternion();
var _q = new THREE2.Quaternion();
var _v = new THREE2.Vector3();
function retargetToVRM(clip, sourceRoot, vrm, rig) {
  sourceRoot.updateWorldMatrix(true, true);
  const flip = vrm.meta?.metaVersion === "0";
  const hipsNode = sourceRoot.getObjectByName(rig.hips);
  if (!hipsNode) throw new Error(`source rig has no "${rig.hips}"`);
  const hipsParentRest = new THREE2.Quaternion();
  hipsNode.parent.getWorldQuaternion(hipsParentRest);
  hipsNode.getWorldPosition(_v);
  const hipsScale = vrm.humanoid.normalizedRestPose.hips.position[1] / _v.y;
  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    const sourceName = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    const humanBone = rig.bones[sourceName];
    if (!humanBone) continue;
    const target = vrm.humanoid.getNormalizedBoneNode(humanBone);
    if (!target) continue;
    const node = sourceRoot.getObjectByName(sourceName);
    if (!node) continue;
    if (property === "quaternion") {
      node.getWorldQuaternion(_rest).invert();
      node.parent.getWorldQuaternion(_parentRest);
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _q.fromArray(values, i).premultiply(_parentRest).multiply(_rest);
        _q.toArray(values, i);
        if (flip) {
          values[i] = -values[i];
          values[i + 2] = -values[i + 2];
        }
      }
      tracks.push(new THREE2.QuaternionKeyframeTrack(`${target.name}.quaternion`, Array.from(track.times), Array.from(values)));
    } else if (property === "position" && humanBone === "hips") {
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 3) {
        _v.fromArray(values, i).applyQuaternion(hipsParentRest).multiplyScalar(hipsScale);
        values[i] = flip ? -_v.x : _v.x;
        values[i + 1] = _v.y;
        values[i + 2] = flip ? -_v.z : _v.z;
      }
      tracks.push(new THREE2.VectorKeyframeTrack(`${target.name}.position`, Array.from(track.times), Array.from(values)));
    }
  }
  if (tracks.length === 0) throw new Error(`retarget produced no tracks for "${clip.name}"`);
  return new THREE2.AnimationClip(clip.name, clip.duration, tracks);
}

// games/hero-moves/src/anim/clips.ts
var gltfLoader = new GLTFLoader2();
var vrmaLoader = new GLTFLoader2();
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
function ensureLookAtProxy(vrm) {
  if (!vrm.lookAt) return;
  if (vrm.scene.children.some((o) => o instanceof VRMLookAtQuaternionProxy)) return;
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
  proxy.name = "VRMLookAtQuaternionProxy";
  vrm.scene.add(proxy);
}
async function loadVrma(url, vrm) {
  ensureLookAtProxy(vrm);
  const gltf = await vrmaLoader.loadAsync(url);
  const animations = gltf.userData.vrmAnimations;
  if (!animations?.length) throw new Error(`${url} carries no VRMC_vrm_animation`);
  return { clip: createVRMAnimationClip(animations[0], vrm), format: "vrma" };
}
async function loadRetargeted(url, vrm, rig = UE_RIG) {
  const gltf = await gltfLoader.loadAsync(url);
  if (!gltf.animations.length) throw new Error(`${url} carries no animation`);
  return { clip: retargetToVRM(gltf.animations[0], gltf.scene, vrm, rig), format: "gltf" };
}
export {
  MIXAMO_RIG,
  UE_RIG,
  loadHero,
  loadRetargeted,
  loadVrma
};
