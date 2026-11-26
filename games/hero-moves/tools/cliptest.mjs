/**
 * The committed clips carry exactly what src/anim/retarget.ts reads, and
 * nothing it needs is missing (tools/fetch-animations.mjs slims them).
 *
 *  1. The bones fetch-animations keeps are UE_RIG's bones in retarget.ts. If
 *     someone maps a new bone there, this fails until the clips are re-slimmed
 *     with it, rather than the hero silently not moving that bone.
 *  2. Every clip has a rotation channel for each of those bones and the
 *     pelvis's translation, and no other channel.
 *
 * Usage: node tools/cliptest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseGlb, retargetReads, UE_BONES, UE_HIPS } from './fetch-animations.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const fail = []

// 1. The same bones as UE_RIG in retarget.ts.
const src = fs.readFileSync(path.join(here, '../src/anim/retarget.ts'), 'utf8')
const block = src.slice(src.indexOf('export const UE_RIG'), src.indexOf('export const MIXAMO_RIG'))
const rigBones = [...block.matchAll(/(\w+):\s*'\w+'/g)].map((m) => m[1]).filter((k) => k !== 'hips')
const rigHips = block.match(/hips:\s*'(\w+)'/)[1]
if ([...rigBones].sort().join() !== [...UE_BONES].sort().join()) fail.push(`UE_BONES (${UE_BONES}) is not UE_RIG.bones (${rigBones})`)
if (rigHips !== UE_HIPS) fail.push(`UE_HIPS ${UE_HIPS} is not UE_RIG.hips ${rigHips}`)

// 2. Each clip: exactly the channels the retargeter reads, all of them.
const dir = path.join(here, '../assets/animations')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.glb'))
for (const f of files) {
  const { json } = parseGlb(fs.readFileSync(path.join(dir, f)))
  const channels = json.animations.flatMap((a) => a.channels)
  const extra = channels.filter((c) => !retargetReads(json.nodes, c))
  if (extra.length) fail.push(`${f}: ${extra.length} channels the retargeter never reads (run: node tools/fetch-animations.mjs --slim)`)
  const has = (name, p) => channels.some((c) => json.nodes[c.target.node]?.name === name && c.target.path === p)
  const missing = UE_BONES.filter((b) => !has(b, 'rotation')).concat(has(UE_HIPS, 'translation') ? [] : [`${UE_HIPS} translation`])
  if (missing.length) fail.push(`${f}: no channel for ${missing.join(', ')}`)
}

if (fail.length) { console.error(fail.join('\n')); process.exit(1) }
console.log(`cliptest: ${files.length} clips, each exactly the ${UE_BONES.length} rotations + ${UE_HIPS} translation the retargeter reads`)
