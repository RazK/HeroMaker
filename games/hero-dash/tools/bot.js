(() => {
  window.__bot = { on: true, actions: {}, crashes: 0 }
  const act = (a) => { window.__input.push(a); window.__bot.actions[a] = (window.__bot.actions[a] ?? 0) + 1 }
  const LANE_W = 2.2
  const laneOf = (x) => Math.max(0, Math.min(2, Math.round(x / LANE_W + 1)))
  let cooldown = 0
  // Decide once per simulation step, so the bot is unaffected by render fps.
  window.__api.onStep((dt) => {
    if (!window.__bot.on || window.__api.phase() !== 'running') return
    cooldown -= dt
    if (cooldown > 0) return
    const d = window.__api.debug()
    const lane = d.lane
    const react = (a, wait) => { act(a); cooldown = wait }

    let best = null
    for (const e of d.entities) {
      if (e.kind === 'star') continue
      const dz = e.z - d.z
      if (dz < 0.4 || dz > 12) continue
      if (e.kind !== 'gate' && laneOf(e.x) !== lane) continue
      if (!best || dz < best.dz) best = { dz, kind: e.kind }
    }

    const blocked = new Set()
    for (const e of d.entities) {
      if (e.kind === 'star' || e.kind === 'gate') continue
      const dz = e.z - d.z
      if (dz > 0.3 && dz < 10) blocked.add(laneOf(e.x))
    }

    if (!best) {
      const counts = [0, 0, 0]
      for (const e of d.entities) {
        if (e.kind !== 'star') continue
        const dz = e.z - d.z
        if (dz > 4 && dz < 30) counts[laneOf(e.x)] += 1
      }
      let want = lane, bestCount = counts[lane]
      for (const l of [lane - 1, lane + 1]) {
        if (l < 0 || l > 2 || blocked.has(l)) continue
        if (counts[l] > bestCount + 1) { bestCount = counts[l]; want = l }
      }
      if (want !== lane) react(want < lane ? 'left' : 'right', 0.28)
      return
    }

    if (best.kind === 'gate') { if (best.dz < 3.0) react('pose', 0.35); return }
    if (best.kind === 'low') { if (best.dz < 4.0) react('jump', 0.45); return }
    if (best.kind === 'high') { if (best.dz < 3.2) react('slide', 0.45); return }
    const opts = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !blocked.has(l))
    if (opts.length) react(opts[0] < lane ? 'left' : 'right', 0.25)
    else if (best.dz < 4.0) react('jump', 0.4)
  })
})()