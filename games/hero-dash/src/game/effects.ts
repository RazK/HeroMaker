import * as THREE from 'three'
import { starGeometry } from '../world/props'

interface Bit { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; spin: THREE.Vector3 }

/** Small pooled burst of spinning shards — used for stars and crashes. */
export class Bursts {
  readonly group = new THREE.Group()
  private live: Bit[] = []
  private idle: Bit[] = []

  constructor(private max = 90) {
    const geo = starGeometry()
    geo.scale(0.42, 0.42, 0.42)
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: '#ffd23f', transparent: true, depthWrite: false,
      }))
      mesh.visible = false
      this.group.add(mesh)
      this.idle.push({ mesh, vel: new THREE.Vector3(), life: 0, max: 1, spin: new THREE.Vector3() })
    }
  }

  emit(pos: THREE.Vector3, count: number, color: string, speed = 5, life = 0.55) {
    for (let i = 0; i < count; i++) {
      const bit = this.idle.pop()
      if (!bit) return
      bit.mesh.position.copy(pos)
      bit.mesh.visible = true
      bit.mesh.scale.setScalar(0.6 + Math.random() * 0.7)
      ;(bit.mesh.material as THREE.MeshBasicMaterial).color.set(color)
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1
      const r = Math.sqrt(1 - u * u)
      bit.vel.set(Math.cos(a) * r, Math.abs(u) * 0.9 + 0.35, Math.sin(a) * r)
        .multiplyScalar(speed * (0.5 + Math.random()))
      bit.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6)
      bit.life = bit.max = life * (0.7 + Math.random() * 0.6)
      this.live.push(bit)
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i]
      b.life -= dt
      if (b.life <= 0) {
        b.mesh.visible = false
        this.live.splice(i, 1)
        this.idle.push(b)
        continue
      }
      b.vel.y -= 15 * dt
      b.mesh.position.addScaledVector(b.vel, dt)
      b.mesh.rotation.x += b.spin.x * dt
      b.mesh.rotation.y += b.spin.y * dt
      b.mesh.rotation.z += b.spin.z * dt
      const t = b.life / b.max
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, t * 1.8)
    }
  }
}

/** Radial speed streaks that switch on during Hero Time. */
export class SpeedLines {
  readonly group = new THREE.Group()
  private lines: THREE.Mesh[] = []
  private mat = new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, depthTest: false,
  })

  constructor(count = 26) {
    const geo = new THREE.PlaneGeometry(0.035, 3.2)
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, this.mat)
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3
      const r = 4.2 + Math.random() * 3.4
      m.position.set(Math.cos(a) * r, Math.sin(a) * r, -6)
      m.rotation.z = a - Math.PI / 2
      m.scale.y = 0.6 + Math.random() * 1.4
      this.lines.push(m)
      this.group.add(m)
    }
    this.group.renderOrder = 999
  }

  update(dt: number, strength: number) {
    this.mat.opacity += (strength * 0.32 - this.mat.opacity) * Math.min(1, dt * 8)
    if (this.mat.opacity < 0.01) { this.group.visible = false; return }
    this.group.visible = true
    for (const l of this.lines) l.scale.y = 0.6 + Math.random() * 1.8
  }
}
