/**
 * Fail on any claim the product cannot back up.
 *
 * A landing page written by an agent will happily promise that drawings never
 * train a model, that there are no ads, that you own what your child makes and
 * that credits never expire. Every one of those was invented here, none was
 * authorised, and the training one is probably false - the drawings are
 * processed by OpenAI and Meshy under THEIR terms, so it was never ours to
 * promise.
 *
 * Marketing copy is not like a contrast ratio: it cannot be measured, only
 * checked against what somebody has actually agreed to. So this does the one
 * thing a machine can do honestly - it refuses the specific sentences we know
 * we cannot stand behind, and says why.
 *
 *   node marketing/concepts/claims.mjs
 *
 * Exit code is the number of files with banned claims. Adding a claim here is
 * how you ban it; removing one requires a person deciding the product really
 * does what it says.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname

// Each rule: what to look for, and why it is not ours to say.
const BANNED = [
  {
    re: /\b(never|not|don'?t|do not)\s+(be\s+)?(used\s+to\s+)?train\w*|training\s+(set|data)|train\s+(a\s+)?model/i,
    why: 'Drawings are processed by OpenAI and Meshy under their terms. A no-training promise is not ours to make.',
  },
  {
    re: /\bnot\s+(sold|shared)\b|\bnothing is sold about\b/i,
    why: 'Unverified claim about data handling.',
  },
  {
    re: /\byou own\b|\bis (yours|theirs) to keep\b|\bthe (drawing|hero) is theirs\b/i,
    why: 'Ownership is a legal claim nobody has checked.',
  },
  {
    re: /\bno ads?\b|\bnever\s+advertis|\bno advertising\b|\bnothing is sold to your child\b/i,
    why: 'A promise about the future business model.',
  },
  {
    re: /\bcredits? never expire\b|\bno subscription\b|\bnothing to cancel\b|\bno monthly\b/i,
    why: 'A pricing decision for the owner, not for the page.',
  },
  {
    re: /\bdelete (it )?(all|everything)\b|\bone (button|click) removes\b|\bwipe the whole account\b/i,
    why: 'Account deletion has not been verified to exist.',
  },
  {
    re: /\b(GDPR|COPPA|compliant|certified|encrypted at rest)\b/i,
    why: 'A compliance claim nobody has audited.',
  },
]

// Sentences we CAN stand behind, because they are checkable in the code.
// Listed so the exemption is explicit rather than an accident of phrasing.
const ALLOWED = [
  // MoveNet runs in the browser via tfjs; no frame is ever uploaded.
  /webcam (video|footage)?[^.]*\b(in|stays in) (the )?browser[^.]*never (uploaded|leaves)/i,
  /webcam[^.]*processed on (your|the) device[^.]*never (uploaded|leaves)/i,
]

// Strip tags, scripts and styles so only the words a visitor reads are tested.
const visibleText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&mdash;/g, '—')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')

const files = readdirSync(DIR).filter(f => f.endsWith('.html')).sort()
let bad = 0

for (const file of files) {
  const text = visibleText(readFileSync(`${DIR}${file}`, 'utf8'))
  // Test sentence by sentence so the report names the offending sentence,
  // not the whole page.
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 3)
  const hits = []

  for (const sentence of sentences) {
    if (ALLOWED.some(ok => ok.test(sentence))) continue
    for (const rule of BANNED) {
      if (rule.re.test(sentence)) {
        hits.push({ sentence: sentence.trim().slice(0, 110), why: rule.why })
        break
      }
    }
  }

  if (hits.length === 0) {
    console.log(`PASS  ${basename(file, '.html')}`)
  } else {
    bad++
    console.log(`FAIL  ${basename(file, '.html')}  (${hits.length})`)
    for (const h of hits) {
      console.log(`        "${h.sentence}"`)
      console.log(`         ^ ${h.why}`)
    }
  }
}

console.log()
console.log(bad === 0
  ? `No unbacked claims in ${files.length} concept(s).`
  : `${bad} of ${files.length} concept(s) make claims the product cannot back up.`)
process.exit(bad)
