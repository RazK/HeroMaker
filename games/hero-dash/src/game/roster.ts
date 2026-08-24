/**
 * Heroes baked into the build, all real creations pulled from the live
 * HeroMaker gallery and run through tools/optimize_vrm.py.
 */
export interface RosterEntry {
  id: string
  name: string
  /** Creation id in the HeroMaker production gallery, for provenance. */
  creation: string
  blurb: string
  url: string
}

/*
 * Dev and multi-file builds serve avatars as ordinary asset URLs. The
 * single-file build strips this glob out entirely (see the `dom-avatars`
 * plugin in vite.config.ts) and supplies the bytes through DOM blocks instead,
 * so the same megabytes are not also baked into the JS bundle.
 */
const files = /* @dom-avatars:start */ import.meta.glob('../../public/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) /* @dom-avatars:end */ as Record<string, string>

const META: Array<Omit<RosterEntry, 'url'>> = [
  { id: 'Crayon_Kid', name: 'Crayon Kid', creation: '237b837e-ffb9-4d93-87bf-80c6158d35d2', blurb: 'Caped, masked, unstoppable' },
  { id: 'Yummy_Bear', name: 'Yummy Bear', creation: '224d8e49-68ec-4271-9216-9ff6073e1792', blurb: 'A bear with a lightning bolt' },
  { id: 'Superstar', name: 'Superstar', creation: '6e66db98-0c51-4d81-ad1c-205f5ba0281e', blurb: 'Five points, two legs' },
  { id: 'Gingerella', name: 'Gingerella', creation: '069dfe61-ff1f-4c16-b334-1a0d7c7c7cd4', blurb: 'Purple cape, pink boots' },
  { id: 'Skelly', name: 'Skelly', creation: '8edf51dc-9cd1-4b2f-aad4-235b110b0231', blurb: 'All bones, no fear' },
  { id: 'Cloudy', name: 'Cloudy', creation: '731db45a-5119-465a-bab1-84cbc9e76ea3', blurb: 'A cloud that learned to run' },
]

// The roster is the META list, not whatever the glob happened to resolve: in
// the single-file build the glob is stripped and the bytes arrive as blocks.
export const ROSTER: RosterEntry[] = META.map((m) => ({
  ...m,
  url: Object.entries(files).find(([k]) => k.endsWith(`/${m.id}.opt.vrm`))?.[1] ?? '',
}))

/**
 * Where a hero's bytes actually come from.
 *
 * In the published single-file build, tools/pack-artifact.mjs parks each
 * avatar's base64 in its own `<script type="text/plain">` block so the download
 * can be measured and reported. Read it once, then drop the node: the string is
 * over a megabyte and there is no reason to hold two copies of it.
 */
interface BootGlobals { __hdTotal?: number; __hdReady?: string[] }
const boot = () => window as unknown as BootGlobals

/** True when the page is delivering avatars as blocks rather than as URLs. */
const usingBlocks = () => (boot().__hdTotal ?? 0) > 0

/**
 * A block's element appears the moment the parser opens its tag, while its text
 * is still arriving — reading it then yields a truncated payload. The marker
 * script after each block is what declares it complete.
 */
const blockComplete = (id: string) => boot().__hdReady?.includes(id) ?? false

function readBlock(id: string): string | null {
  if (!blockComplete(id)) return null
  const node = document.getElementById(`hd-avatar-${id}`)
  const inline = node?.textContent?.trim()
  if (!node || !inline) return null
  node.remove()
  return `data:model/gltf-binary;base64,${inline}`
}

/** Has this hero's payload arrived yet? Drives the picker's pending state. */
export function avatarReady(entry: RosterEntry): boolean {
  return !usingBlocks() ? !!entry.url : blockComplete(entry.id) || cached.has(entry.id)
}

const cached = new Set<string>()

export async function avatarSource(entry: RosterEntry): Promise<string> {
  const immediate = readBlock(entry.id)
  if (immediate) { cached.add(entry.id); return immediate }
  if (!usingBlocks()) {
    if (!entry.url) throw new Error(`${entry.name} is missing from this build`)
    return entry.url
  }

  // The engine runs mid-parse, so a hero further down the document may not have
  // arrived yet. Wait for it rather than failing the load.
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const poll = () => {
      const found = readBlock(entry.id)
      if (found) { cached.add(entry.id); return resolve(found) }
      if (document.readyState === 'complete') return reject(new Error(`${entry.name} is missing from this build`))
      if (performance.now() - started > 120000) return reject(new Error(`${entry.name} took too long to arrive`))
      requestAnimationFrame(poll)
    }
    poll()
  })
}

export const thumbUrl = (id: string) =>
  (import.meta.glob('../../public/avatars/*.thumb.webp', {
    eager: true, query: '?url', import: 'default',
  }) as Record<string, string>)[`../../public/avatars/${id}.thumb.webp`]
