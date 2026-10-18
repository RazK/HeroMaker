/**
 * Serves heroes to a Robot Rumble page the way the app does, from local
 * files: the player's hero at /api/files/local/<file>, and a featured gallery
 * at /api/creations/?featured_only=true whose heroes are local .vrm files
 * served at /api/files/local/<name>/opt_avatar.vrm. Shared by the harnesses.
 */
import fs from 'node:fs'
import path from 'node:path'

export async function routeHeroes(page, heroFile, rivalFiles = []) {
  const byStem = new Map(rivalFiles.map((f) => [path.basename(f).replace(/\.(opt\.)?vrm$/, ''), f]))
  await page.route('**/api/creations/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([...byStem.keys()].map((stem) => ({
      id: stem, user_id: 'local', character_name: stem.replace(/_/g, ' '),
      steps: [{ step_name: 'convert_vrm', status: 'completed' }],
    }))),
  }))
  await page.route('**/api/files/local/**', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/')
    const file = parts.at(-1) === 'opt_avatar.vrm' ? byStem.get(parts.at(-2)) : heroFile
    if (!file) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/octet-stream' })
  })
}

export const heroQuery = (heroFile, name) =>
  `vrm=${encodeURIComponent('/api/files/local/' + path.basename(heroFile))}&name=${encodeURIComponent(name)}`
