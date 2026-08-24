export const CFG = {
  lanes: 3,
  laneWidth: 2.2,
  shoulder: 1.3,

  speedStart: 9.5,
  speedMax: 23,
  /** Metres of running it takes to reach top speed. */
  speedRampDistance: 1400,

  laneChangeTime: 0.17,
  jumpHeight: 2.05,
  jumpTime: 0.78,
  slideTime: 0.72,
  poseTime: 0.55,

  hearts: 3,
  invulnTime: 1.5,
  stumbleTime: 0.6,

  /** Hero Time: full meter buys this many seconds of flight. */
  powerDuration: 6.5,
  powerPerStar: 0.030,
  powerPerGate: 0.16,
  powerFlightHeight: 2.6,
  magnetRadius: 6.5,

  scorePerMetre: 1,
  scorePerStar: 10,
  scorePerGate: 75,

  /** Track slices are generated this far ahead and recycled this far behind. */
  spawnAhead: 190,
  despawnBehind: 26,
  sliceGap: 13,
  /** No obstacles at all for the first stretch, so the first seconds feel good. */
  graceDistance: 44,

  fogNear: 70,
  fogFar: 175,
}

export const laneX = (lane: number) => (lane - (CFG.lanes - 1) / 2) * CFG.laneWidth
export const roadWidth = CFG.lanes * CFG.laneWidth + CFG.shoulder * 2
