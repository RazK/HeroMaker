/**
 * Which heroes are in the class, and what each child is called.
 *
 * A class is a title and a list of heroes, each a staging/production creation
 * (`user` + `id`) and the child's first name. Only first names: a class page is
 * passed round a parents' WhatsApp group, so it carries nothing else about a
 * child (see the research report's privacy notes).
 *
 * Three ways in, first match wins:
 *   ?manifest=<same-origin url>                 a JSON file { title, heroes: [{name, user, id}] }
 *   ?heroes=<user>/<id>:<name>,<user>/<id>:...  inline, names URI-encoded
 *   (nothing)                                   class-demo.json beside this page
 *
 * Files are always read through the app's own origin (`/api/files/...`), which
 * nginx proxies to the backend in every environment — the same rule as
 * ownhero.ts, so this page can never be pointed at someone else's server.
 */
export interface ClassHero {
  /** The child's first name, shown under the hero. */
  name: string
  id: string
  user: string
}

export interface ClassManifest {
  title: string
  heroes: ClassHero[]
}

const params = new URLSearchParams(location.search)

function sameOrigin(raw: string): string | null {
  try {
    const u = new URL(raw, location.href)
    return u.origin === location.origin ? u.href : null
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f-]{8,64}$/i

/** The web-optimised VRM the backend serves for any creation (see CLAUDE.md, `opt_`). */
export const heroVrm = (h: ClassHero) => `/api/files/${h.user}/${h.id}/opt_avatar.vrm`
/** The small painted render, shown while the 3D hero is still on its way. */
export const heroThumb = (h: ClassHero) => `/api/files/${h.user}/${h.id}/thumb_rendered.png`

function clean(m: ClassManifest): ClassManifest {
  const heroes = (m.heroes ?? [])
    .filter((h) => h && UUID.test(h.id) && UUID.test(h.user))
    .map((h) => ({ id: h.id, user: h.user, name: String(h.name || '').slice(0, 24) }))
  const n = Number(params.get('n'))
  return {
    title: String(params.get('title') ?? m.title ?? '').slice(0, 40),
    heroes: n > 0 ? heroes.slice(0, n) : heroes,
  }
}

export async function loadManifest(): Promise<ClassManifest> {
  const inline = params.get('heroes')
  if (inline) {
    const heroes = inline.split(',').map((part) => {
      const [path, name = ''] = part.split(':')
      const [user, id] = path.split('/')
      return { user, id, name: decodeURIComponent(name) }
    })
    return clean({ title: '', heroes })
  }
  const url = sameOrigin(params.get('manifest') ?? 'class-demo.json')
  if (!url) throw new Error('manifest must be on this site')
  const r = await fetch(url)
  if (!r.ok) throw new Error(`class list: ${r.status}`)
  return clean(await r.json())
}
