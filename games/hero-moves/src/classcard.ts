import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import qrcode from 'qrcode-generator'
import './ui/toybox.css'
import './ui/classcard.css'
import { parseHero } from './avatar/loader'
import { animUrl } from './anim/files'
import { el } from './ui/dom'
import { loadManifest, heroVrm, type ClassHero } from './class/manifest'
import { Dancer } from './class/dancer'

/**
 * Printable hero cards: A6, one per child — the hero mid-dance on the sun, the
 * child's first name, and a QR code that opens that hero dancing on its own
 * page (class-stage.html?hero=<id>). Print the page and every child has one;
 * a parent scans it and the hero dances on grandma's phone.
 *
 *   class-card.html                every child in the class, one card per page
 *   class-card.html?hero=<id>      one child
 *   &origin=https://...            the site the QR codes point at (default: this one)
 *
 * The render is the real 3D hero, posed from the Charleston the class stage
 * dances (hands on hips, facing front), on a transparent background — so it stands on the sun.
 */
const params = new URLSearchParams(location.search)
const origin = (() => {
  const o = params.get('origin')
  return o && /^https:\/\/[a-z0-9.-]+$/i.test(o) ? o : location.origin
})()
/** Which moment of which clip the card shows: ?pose=<clip>:<0..1>. */
const POSE = (() => {
  const [clip, at] = (params.get('pose') ?? 'dance:0.1').split(':')
  return { clip, at: Number(at) || 0 }
})()

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(900, 1000, false)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xffffff, 0xffe9c4, 0.9))
const key = new THREE.DirectionalLight(0xfff3e0, 2.1)
key.position.set(1.2, 3.5, 4)
scene.add(key)
const fill = new THREE.DirectionalLight(0xe9e3ff, 0.6)
fill.position.set(-3, 1.5, 2)
scene.add(fill)
{
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.25
  pmrem.dispose()
}
const camera = new THREE.PerspectiveCamera(26, 0.9, 0.05, 50)

async function heroPicture(h: ClassHero): Promise<string> {
  const r = await fetch(heroVrm(h))
  if (!r.ok) throw new Error(`${r.status}`)
  const hero = await parseHero(await r.arrayBuffer())
  const d = new Dancer(hero)
  await d.bind(animUrl)
  scene.add(hero.root)
  d.pose([{ clip: POSE.clip, time: POSE.at, weight: 1 }])
  hero.vrm.update(0)
  // Frame what the pose actually occupies, not the T-pose.
  hero.root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(hero.vrm.scene)
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3())
  const tan = Math.tan((camera.fov * Math.PI) / 360)
  const dist = Math.max((size.y * 1.06) / 2 / tan, (size.x * 1.06) / 2 / (tan * camera.aspect)) + size.z / 2
  camera.position.set(mid.x, mid.y + size.y * 0.04, mid.z + dist)
  camera.lookAt(mid.x, mid.y, mid.z)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  scene.remove(hero.root)
  d.mixer.stopAllAction()
  hero.dispose()
  return url
}

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
}

function card(h: ClassHero, title: string, i: number) {
  const link = `${origin}/play/class-stage.html?hero=${h.id}`
  const pic = el('img', { class: 'cc-hero', alt: `הגיבור של ${h.name}` })
  const qr = el('div', { class: 'cc-qr' })
  qr.innerHTML = qrSvg(link)
  const node = el('article', { class: `cc-card tb-plate-${(i % 6) + 1}` },
    el('div', { class: 'cc-top' }, el('div', { class: 'cc-eyebrow' }, `הגיבורים של ${title}`)),
    el('div', { class: 'cc-stage' }, el('div', { class: 'cc-sun' }), pic),
    el('div', { class: 'cc-name' }, h.name),
    el('div', { class: 'cc-foot' },
      el('div', { class: 'cc-scan' }, el('strong', {}, 'סרקו אותי'), el('span', {}, 'ותראו את הגיבור רוקד!')),
      qr),
    el('div', { class: 'cc-brand' }, 'HeroMaker'),
  )
  return { node, pic }
}

;(async () => {
  const m = await loadManifest()
  const want = params.get('hero')
  const list = want ? m.heroes.filter((h) => h.id === want) : m.heroes
  const root = document.getElementById('app')!
  const cards = list.map((h, i) => card(h, m.title || 'הגן', m.heroes.indexOf(h) >= 0 ? m.heroes.indexOf(h) : i))
  root.append(...cards.map((c) => c.node))
  await document.fonts.ready
  // One hero at a time: twelve VRMs in memory to print a page is pointless.
  for (let i = 0; i < list.length; i++) {
    try { cards[i].pic.src = await heroPicture(list[i]) } catch (err) { console.warn(list[i].name, (err as Error).message) }
  }
  ;(window as any).__ready = true
})()
