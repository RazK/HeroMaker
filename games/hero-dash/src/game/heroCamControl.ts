import { HeroCam } from '../core/heroCam'
import { CFG } from './config'
import type { Game } from './game'

/**
 * Turns Hero Cam silhouette readings into game input. Thresholds are
 * deliberately generous with a release band, so a kid bouncing around does not
 * machine-gun the same action.
 */
export class HeroCamControl {
  readonly cam = new HeroCam()
  private jumpArmed = true
  private slideArmed = true
  private poseArmed = true

  constructor(private getGame: () => Game) {}

  get state() { return this.cam.state }
  get seesPlayer() { return this.cam.seesPlayer }
  get preview() { return this.cam.preview }

  start() { return this.cam.start() }
  stop() { this.cam.stop() }
  recalibrate() { this.cam.recalibrate() }

  update() {
    const r = this.cam.update()
    if (!r || this.cam.state !== 'ready') return

    // Nobody in frame — don't steer.
    if (r.mass < 0.02) return

    const game = this.getGame()
    const lane = (CFG.lanes - 1) / 2 + r.lean * ((CFG.lanes - 1) / 2) * 1.25
    game.requestLane(lane)

    if (r.rise > 0.55 && this.jumpArmed) { game.input.push('jump'); this.jumpArmed = false }
    if (r.rise < 0.30) this.jumpArmed = true

    if (r.rise < -0.42 && this.slideArmed) { game.input.push('slide'); this.slideArmed = false }
    if (r.rise > -0.22) this.slideArmed = true

    if (r.spread > 1.34 && this.poseArmed) { game.input.push('pose'); this.poseArmed = false }
    if (r.spread < 1.18) this.poseArmed = true
  }
}
