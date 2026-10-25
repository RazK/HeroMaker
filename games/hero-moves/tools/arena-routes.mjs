/**
 * Serves heroes to a Robot Rumble page the way the app does, from local
 * files: the player's hero at /api/files/local/<file>, and a featured gallery
 * at /api/v1/gallery?view=featured whose heroes are local .vrm files
 * served at /api/files/local/<name>/opt_avatar.vrm. Shared by the harnesses.
 *
 * Each gallery hero also gets a drawing (`thumb_original.jpg`, which the
 * game pins to the wall), taken in turn from the real children's drawings in
 * marketing/concepts/assets/pairs/, and a made-up first name and age.
 */
import fs from 'node:fs'
import path from 'node:path'

const PAIRS = new URL('../../../marketing/concepts/assets/pairs/', import.meta.url).pathname
const DRAWINGS = fs.existsSync(PAIRS) ? fs.readdirSync(PAIRS).filter((f) => f.endsWith('-drawing.jpg')).sort().map((f) => path.join(PAIRS, f)) : []
const KIDS = [['Maya', 6], ['Noam', 7], ['Lia', 5], ['Ari', 8], ['Yael', 6], ['Tom', 9]]

export async function routeHeroes(page, heroFile, rivalFiles = []) {
  const byStem = new Map(rivalFiles.map((f) => [path.basename(f).replace(/\.(opt\.)?vrm$/, ''), f]))
  const stems = [...byStem.keys()]
  await page.route('**/api/v1/gallery**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      object: 'list', view: 'featured',
      data: stems.map((stem, i) => ({
        id: stem, object: 'hero', owner_id: 'local', status: 'completed', in_class: false,
        name: stem.replace(/_/g, ' '), artist: { name: KIDS[i % KIDS.length][0], age: KIDS[i % KIDS.length][1] },
      })),
    }),
  }))
  await page.route('**/api/files/local/**', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/')
    if (parts.at(-1) === 'thumb_original.jpg') {
      const i = stems.indexOf(parts.at(-2))
      if (i < 0 || !DRAWINGS.length) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ body: fs.readFileSync(DRAWINGS[i % DRAWINGS.length]), contentType: 'image/jpeg' })
    }
    const file = parts.at(-1) === 'opt_avatar.vrm' ? byStem.get(parts.at(-2)) : heroFile
    if (!file) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/octet-stream' })
  })
}

export const heroQuery = (heroFile, name) =>
  `vrm=${encodeURIComponent('/api/files/local/' + path.basename(heroFile))}&name=${encodeURIComponent(name)}`
