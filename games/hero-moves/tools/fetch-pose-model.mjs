/**
 * Packs a TFJS graph model into the single-JSON form the game loads.
 *
 * A published page cannot fetch anything — the artifact CSP refuses it, and a
 * GitHub Pages build wants the weights inlined anyway — so the model ships as
 * one JSON blob that `tf.io.fromMemory` accepts directly: the topology, the
 * weight specs, and every shard concatenated and base64'd.
 *
 * Usage: node tools/fetch-pose-model.mjs <model.json url> <out.json>
 */
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
const out = process.argv[3]
if (!src || !out) { console.error('usage: fetch-pose-model.mjs <url> <out.json>'); process.exit(1) }

const base = src.slice(0, src.lastIndexOf('/') + 1)
console.log(`fetching ${src}`)
const model = await (await fetch(src)).json()

const specs = []
const chunks = []
for (const group of model.weightsManifest ?? []) {
  for (const spec of group.weights) specs.push(spec)
  for (const shard of group.paths) {
    // Shard paths are relative to the model.json, and tfhub hands back a
    // query-string URL, so the query has to survive the join.
    const q = src.includes('?') ? src.slice(src.indexOf('?')) : ''
    const url = `${base}${shard}${q}`
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    console.log(`  ${shard}  ${(buf.length / 1e6).toFixed(2)} MB`)
    chunks.push(buf)
  }
}
const weights = Buffer.concat(chunks)
const spec = {
  modelTopology: model.modelTopology,
  weightSpecs: specs,
  weightDataB64: weights.toString('base64'),
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(spec))
console.log(`\n${out}  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB` +
  `  (${specs.length} tensors, ${(weights.length / 1e6).toFixed(2)} MB of weights)`)
