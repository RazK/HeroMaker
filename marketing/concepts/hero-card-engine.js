/* GENERATED — do not edit.
 * Built from games/hero-moves/src/{avatar/loader,anim/{clips,performer,retarget}}.ts
 * by marketing/concepts/build-engine.mjs. Re-run that script to refresh it.
 * three and @pixiv/three-vrm come from the CDN via the page import map.
 */

// games/hero-moves/engine.ts
import * as THREE4 from "three";

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

// games/hero-moves/src/anim/performer.ts
import * as THREE3 from "three";
var CLIPS = [
  { id: "dance", url: "Dance_Charleston.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "bodyroll", url: "Dance_Body_Roll.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "backflip", url: "Backflip.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "punch", url: "Punch_Cross.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "jump", url: "Jump.vrma", kind: "vrma", credit: "tk256ailab/vrm-viewer (MIT)" },
  { id: "land", url: "Land_Three_Point.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "fly", url: "Flying_Forward_Super.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" },
  { id: "victory", url: "Victory_Fist_Pump.glb", kind: "gltf", credit: "Quaternius UAL (CC0)" }
];
var AIRBORNE = /* @__PURE__ */ new Set(["backflip", "jump", "fly"]);
var Performer = class {
  constructor(hero) {
    this.hero = hero;
    this.mixer = null;
    this.actions = /* @__PURE__ */ new Map();
    this.current = null;
    this.currentId = null;
    /** Set for a one-shot; cleared when it finishes and the rig is handed back. */
    this.oneShotEnds = 0;
    this.mixer = new THREE3.AnimationMixer(hero.vrm.scene);
  }
  /** True while a clip owns the rig. The caller must not pose the hero then. */
  get active() {
    return this.current !== null;
  }
  /**
   * True only for clips that actually leave the ground.
   *
   * The camera eases back while one plays, and a looping idle dance is not one
   * — treating every clip as airborne pulled the whole stage 30% further away
   * for the entire menu, where the heroes are always dancing.
   */
  get airborne() {
    return this.currentId !== null && AIRBORNE.has(this.currentId);
  }
  get playing() {
    return this.currentId;
  }
  get ready() {
    return this.actions.size > 0;
  }
  has(id) {
    return this.actions.has(id);
  }
  /**
   * Load one clip. Failures are swallowed to a warning on purpose: a missing
   * animation should cost the hero a flourish, not cost the player the game.
   */
  async load(spec, resolve) {
    if (!this.mixer) return false;
    try {
      const url = resolve(spec.url);
      const loaded = spec.kind === "vrma" ? await loadVrma(url, this.hero.vrm) : await loadRetargeted(url, this.hero.vrm);
      const action = this.mixer.clipAction(loaded.clip);
      this.actions.set(spec.id, action);
      return true;
    } catch (err) {
      console.warn(`clip ${spec.id} unavailable:`, err.message);
      return false;
    }
  }
  /**
   * Start a clip. `loop` keeps it running until something else is played or
   * `stop` is called; otherwise it plays once and hands the rig back.
   */
  play(id, { loop = false, fade = 0.25 } = {}) {
    const next = this.actions.get(id);
    if (!next || next === this.current) return;
    next.reset();
    next.setLoop(loop ? THREE3.LoopRepeat : THREE3.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    this.currentId = id;
    this.oneShotEnds = loop ? 0 : next.getClip().duration;
  }
  /** Hand the rig back to the procedural poser. */
  stop(fade = 0.2) {
    if (!this.current) return;
    this.current.fadeOut(fade);
    this.current = null;
    this.currentId = null;
    this.oneShotEnds = 0;
  }
  update(dt) {
    if (!this.mixer) return;
    this.mixer.update(dt);
    if (this.current && this.oneShotEnds > 0 && this.current.time >= this.oneShotEnds - 0.02) {
      this.stop();
    }
  }
  dispose() {
    this.mixer?.stopAllAction();
    this.actions.clear();
    this.mixer = null;
    this.current = null;
  }
};
export {
  CLIPS,
  MIXAMO_RIG,
  Performer,
  THREE4 as THREE,
  UE_RIG,
  loadHero,
  loadRetargeted,
  loadVrma
};
