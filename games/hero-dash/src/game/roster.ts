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

const files = import.meta.glob('../../public/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const META: Array<Omit<RosterEntry, 'url'>> = [
  { id: 'Crayon_Kid', name: 'Crayon Kid', creation: '237b837e-ffb9-4d93-87bf-80c6158d35d2', blurb: 'Caped, masked, unstoppable' },
  { id: 'Yummy_Bear', name: 'Yummy Bear', creation: '224d8e49-68ec-4271-9216-9ff6073e1792', blurb: 'A bear with a lightning bolt' },
  { id: 'Superstar', name: 'Superstar', creation: '6e66db98-0c51-4d81-ad1c-205f5ba0281e', blurb: 'Five points, two legs' },
  { id: 'Gingerella', name: 'Gingerella', creation: '069dfe61-ff1f-4c16-b334-1a0d7c7c7cd4', blurb: 'Purple cape, pink boots' },
  { id: 'Skelly', name: 'Skelly', creation: '8edf51dc-9cd1-4b2f-aad4-235b110b0231', blurb: 'All bones, no fear' },
  { id: 'Cloudy', name: 'Cloudy', creation: '731db45a-5119-465a-bab1-84cbc9e76ea3', blurb: 'A cloud that learned to run' },
]

export const ROSTER: RosterEntry[] = META.flatMap((m) => {
  const key = Object.keys(files).find((k) => k.endsWith(`/${m.id}.opt.vrm`))
  return key ? [{ ...m, url: files[key] }] : []
})

export const thumbUrl = (id: string) =>
  (import.meta.glob('../../public/avatars/*.thumb.webp', {
    eager: true, query: '?url', import: 'default',
  }) as Record<string, string>)[`../../public/avatars/${id}.thumb.webp`]
