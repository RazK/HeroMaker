/**
 * The shipped animation clips, by file name, as the URLs the bundler emitted.
 *
 * Every page of this build resolves a clip through the same hashed URL, so the
 * HeroMaker app's hero page (herostage.ts) and the Dance party page share one
 * HTTP-cached copy of each clip.
 */
const animFiles = import.meta.glob('../../assets/animations/*', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

export function animUrl(file: string): string {
  const stem = file.replace(/\.[^.]+$/, '')
  return Object.entries(animFiles).find(([k]) => k.includes(`/${stem}`))?.[1] ?? file
}
