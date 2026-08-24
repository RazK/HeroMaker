import * as THREE from 'three'

/** Fibrous paper grain, drawn once into a canvas and reused everywhere. */
function paperCanvas(size: number, base: string, grain: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  const img = g.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * grain
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  g.putImageData(img, 0, 0)
  // A few long fibres so it reads as paper rather than TV static.
  g.globalAlpha = 0.05
  for (let i = 0; i < size / 3; i++) {
    g.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#000000'
    g.lineWidth = Math.random() * 1.4
    const x = Math.random() * size, y = Math.random() * size
    const a = Math.random() * Math.PI, len = 8 + Math.random() * 40
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke()
  }
  g.globalAlpha = 1
  return c
}

export function paperTexture(base = '#f6efe0', grain = 26, repeat = 1): THREE.Texture {
  const t = new THREE.CanvasTexture(paperCanvas(256, base, grain))
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** The road: paper, wobbly crayon edges, and dashed lane dividers. */
export function roadTexture(lanes: number, laneWidth: number, shoulder: number): THREE.Texture {
  const S = 512
  const c = paperCanvas(S, '#cfc4ae', 26)
  const g = c.getContext('2d')!
  const totalWidth = lanes * laneWidth + shoulder * 2
  const px = (metres: number) => (metres / totalWidth) * S

  const wobbly = (x: number, dashed: boolean, width: number, color: string) => {
    g.strokeStyle = color
    g.lineWidth = width
    g.lineCap = 'round'
    const seg = dashed ? 34 : S
    for (let y = 0; y < S; y += seg + (dashed ? 26 : 0)) {
      g.beginPath()
      for (let s = 0; s <= seg; s += 8) {
        const xx = x + Math.sin((y + s) * 0.06) * 2.4 + (Math.random() - 0.5) * 1.6
        if (s === 0) g.moveTo(xx, y + s); else g.lineTo(xx, y + s)
      }
      g.stroke()
    }
  }

  // Kerbs
  wobbly(px(shoulder), false, 11, '#b8402c')
  wobbly(S - px(shoulder), false, 11, '#b8402c')
  for (let i = 1; i < lanes; i++) {
    wobbly(px(shoulder + i * laneWidth), true, 9, '#fffdf6')
  }

  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Vertical sky gradient with a paper tint. */
export function skyTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 8; c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, top)
  grad.addColorStop(0.55, bottom)
  grad.addColorStop(1, '#fdf6e6')
  g.fillStyle = grad
  g.fillRect(0, 0, 8, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const CRAYON = {
  leaf: ['#4fa845', '#3d8f57', '#68b83c', '#2f7d4f'],
  trunk: '#8a5a3b',
  hill: ['#9ad36a', '#7fc25a', '#b6dd7d'],
  obstacle: ['#e2574c', '#f0a03c', '#7b5ea7', '#3e8fd0'],
  star: '#ffd23f',
  gate: '#7b5ea7',
}
