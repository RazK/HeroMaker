/**
 * Fetches the animation clips the anim lab plays, and trims each one down to
 * something worth committing.
 *
 * Two kinds of source, both reachable from a sandbox with no login:
 *
 *  - `.vrma` — VRM Animation 1.0, the format the VRM consortium defines for
 *    humanoid motion (glTF + the `VRMC_vrm_animation` extension). Nothing to
 *    convert: the clip already speaks in VRM humanoid bone names.
 *
 *  - Quaternius' CC0 Universal Animation Library, as redistributed by the
 *    mesh2motion project. These are ordinary glTF skeletal animations on a
 *    UE-style rig (`pelvis`, `upperarm_l`, …), so they need retargeting —
 *    see src/anim/retarget.ts.
 *
 * The Quaternius files ship ~85 clips in one 5 MB glb. We want three of them,
 * so this strips each pick down to its own glb holding the skeleton and that
 * one animation: ~60 KB instead of 5 MB, with the rest pose intact so the
 * retargeter can still read it.
 *
 * Each clip also keeps only the channels the retargeter reads: the rotation
 * of the 22 bones UE_RIG maps (src/anim/retarget.ts) and the pelvis's
 * translation. The source animates 66 bones in 198 channels (fingers, twist
 * bones, every bone's scale and offset); src/anim/retarget.ts throws all of
 * that away after it has been downloaded and decoded. Keeping 23 channels
 * makes the clips 58% smaller (1.8 MB -> 756 KB for the 20) with identical
 * motion on a hero.
 *
 * Usage: node tools/fetch-animations.mjs [outDir]
 *        node tools/fetch-animations.mjs --slim [dir]   re-slim the committed clips, no network
 */
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] ?? new URL('../assets/animations/', import.meta.url).pathname

/** Everything is fetched over plain HTTPS from a public CDN — no account, no key. */
const CDN = 'https://cdn.jsdelivr.net/gh'

const VRMA = [
  // MIT-licensed sample set shipped with tk256ailab/vrm-viewer.
  { name: 'Jump.vrma', url: `${CDN}/tk256ailab/vrm-viewer@main/VRMA/Jump.vrma` },
]

const PACKS = [
  {
    url: `${CDN}/scottpetrovic/mesh2motion-app@main/static/animations/human-addon-animations.glb`,
    clips: [
      'Dance Charleston', 'Backflip', 'Dance Body Roll',
      // A superhero deck from the same CC0 library: the three-point landing
      // and the flying pose are the two motions this asset was drawn for.
      'Land_Three_Point', 'Flying Forward Super', 'Victory Fist Pump',
      // Robot Rumble (arena.html): a fighter's stance, a two-hand jab combo,
      // an anime run, a jump with a crouch in it and the ground pound.
      'Fighting Idle', 'Fighting Left Jab', 'Fighting Right Jab', 'Run_Anime',
      'Jump_2', 'Attack_Ground_Pound', 'Victory',
      // Dizzy and Greeting were Robot Rumble's rival heroes; Greeting is now
      // one of the crowd's cheers (a big wave), Jumping Jacks another.
      'Dizzy', 'Greeting', 'Jumping Jacks',
    ],
  },
  {
    url: `${CDN}/scottpetrovic/mesh2motion-app@main/static/animations/human-base-animations.glb`,
    clips: ['Punch_Cross',
      // Robot Rumble: being bumped by a bouncy ball.
      'Hit_Knockback',
      'Walk',
      // Robot Rumble's cheering crowd: a little side-to-side dance.
      'Dance_Simple'],
  },
]

const pad4 = (n) => (4 - (n % 4)) % 4

/**
 * The source bones the retargeter maps: keys of UE_RIG.bones in
 * src/anim/retarget.ts (tools/cliptest.mjs checks the two agree). Only their
 * rotation is read, and only the hips' translation.
 */
export const UE_BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l',
  'thigh_r', 'calf_r', 'foot_r', 'ball_r',
]
export const UE_HIPS = 'pelvis'

/** Is this channel one src/anim/retarget.ts turns into a track? */
export function retargetReads(nodes, channel) {
  const name = nodes[channel.target.node]?.name
  if (channel.target.path === 'rotation') return UE_BONES.includes(name)
  return channel.target.path === 'translation' && name === UE_HIPS
}

export function parseGlb(buf) {
  const total = buf.readUInt32LE(8)
  let off = 12, json = null, bin = null
  while (off < total) {
    const len = buf.readUInt32LE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'))
    else if (type.startsWith('BIN')) bin = data
    off += 8 + len + pad4(len)
  }
  return { json, bin }
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20)
  const binPad = Buffer.alloc(pad4(bin.length), 0)
  const jsonLen = jsonBuf.length + jsonPad.length
  const binLen = bin.length + binPad.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonLen + 8 + binLen, 8)
  const jsonHdr = Buffer.alloc(8); jsonHdr.writeUInt32LE(jsonLen, 0); jsonHdr.write('JSON', 4, 'ascii')
  const binHdr = Buffer.alloc(8); binHdr.writeUInt32LE(binLen, 0); binHdr.write('BIN\0', 4, 'ascii')
  return Buffer.concat([header, jsonHdr, jsonBuf, jsonPad, binHdr, bin, binPad])
}

/**
 * Keeps one animation and the skeleton it drives. Meshes, skins, materials and
 * images all go: the retargeter only ever reads bone names, rest transforms and
 * keyframes, and dropping the rest is what turns 5 MB into 60 KB.
 */
export function extractClip(src, clipName) {
  const anim = src.json.animations.find((a) => a.name === clipName)
  if (!anim) throw new Error(`no clip named ${clipName}`)

  const out = {
    asset: { version: '2.0', generator: `hero-moves fetch-animations (from ${src.json.asset?.generator ?? '?'})` },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: src.json.nodes.map((n) => {
      const copy = { name: n.name }
      for (const k of ['translation', 'rotation', 'scale', 'children']) if (n[k]) copy[k] = n[k]
      return copy
    }),
    accessors: [],
    bufferViews: [],
    buffers: [],
    animations: [],
  }
  // Root nodes = the ones nobody claims as a child.
  const claimed = new Set(src.json.nodes.flatMap((n) => n.children ?? []))
  out.scenes[0].nodes = src.json.nodes.map((_, i) => i).filter((i) => !claimed.has(i))

  const chunks = []
  let cursor = 0
  const remapped = new Map()
  const copyAccessor = (idx) => {
    if (remapped.has(idx)) return remapped.get(idx)
    const acc = src.json.accessors[idx]
    const bv = src.json.bufferViews[acc.bufferView]
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type]
    const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]
    const stride = bv.byteStride ?? comps * bytes
    const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    // De-interleave into a tight block so the copy needs no byteStride.
    const tight = Buffer.alloc(acc.count * comps * bytes)
    for (let i = 0; i < acc.count; i++) {
      src.bin.copy(tight, i * comps * bytes, start + i * stride, start + i * stride + comps * bytes)
    }
    const pad = pad4(cursor)
    if (pad) { chunks.push(Buffer.alloc(pad, 0)); cursor += pad }
    const bvIndex = out.bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: tight.length }) - 1
    chunks.push(tight); cursor += tight.length
    const newIdx = out.accessors.push({
      bufferView: bvIndex, componentType: acc.componentType, count: acc.count, type: acc.type,
      ...(acc.min ? { min: acc.min } : {}), ...(acc.max ? { max: acc.max } : {}),
    }) - 1
    remapped.set(idx, newIdx)
    return newIdx
  }

  // Only what the retargeter reads; each kept channel gets its own sampler,
  // in order, so the dropped samplers' keyframes are never copied.
  const kept = anim.channels.filter((c) => retargetReads(src.json.nodes, c))
  out.animations.push({
    name: anim.name,
    samplers: kept.map((c) => {
      const s = anim.samplers[c.sampler]
      return { input: copyAccessor(s.input), output: copyAccessor(s.output), interpolation: s.interpolation ?? 'LINEAR' }
    }),
    channels: kept.map((c, i) => ({ sampler: i, target: { node: c.target.node, path: c.target.path } })),
  })

  const bin = Buffer.concat(chunks)
  out.buffers.push({ byteLength: bin.length })
  return writeGlb(out, bin)
}

async function get(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const isMain = import.meta.url === `file://${process.argv[1]}`

if (isMain && process.argv[2] === '--slim') {
  // The committed clips, slimmed in place: each holds one animation already.
  const dir = process.argv[3] ?? new URL('../assets/animations/', import.meta.url).pathname
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
    const before = fs.readFileSync(path.join(dir, file))
    const src = parseGlb(before)
    const after = extractClip(src, src.json.animations[0].name)
    fs.writeFileSync(path.join(dir, file), after)
    console.log(`${file.padEnd(28)} ${(before.length / 1024).toFixed(0).padStart(4)} KB -> ${(after.length / 1024).toFixed(0).padStart(3)} KB`)
  }
} else if (isMain) {
fs.mkdirSync(outDir, { recursive: true })

for (const { name, url } of VRMA) {
  const buf = await get(url)
  fs.writeFileSync(path.join(outDir, name), buf)
  console.log(`${name.padEnd(28)} ${(buf.length / 1024).toFixed(0)} KB  (vrma, no conversion)`)
}

for (const pack of PACKS) {
  const src = parseGlb(await get(pack.url))
  for (const clip of pack.clips) {
    const buf = extractClip(src, clip)
    const file = `${clip.replace(/[^A-Za-z0-9]+/g, '_')}.glb`
    fs.writeFileSync(path.join(outDir, file), buf)
    const dur = Math.max(...src.json.animations.find((a) => a.name === clip).samplers
      .map((s) => src.json.accessors[s.input].max?.[0] ?? 0))
    console.log(`${file.padEnd(28)} ${(buf.length / 1024).toFixed(0)} KB  ${dur.toFixed(2)}s  (glTF, needs retarget)`)
  }
}
}
