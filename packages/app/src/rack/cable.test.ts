import { describe, expect, it } from 'vitest'
import { SWING_MS, cableMiddle, cablePath, sag, swingAngle, swingPeriod, swingSeed } from './cable.js'

// A cable is decoration, so what is worth testing is not the curve family but the behaviour that makes
// it read as a cable rather than a diagram: it always hangs BELOW both of its ends, and pulling the ends
// apart takes the slack out rather than deepening the loop.

const at = (x: number, y: number) => ({ x, y })

describe('a hanging cable', () => {
  it('starts and ends exactly on the jacks', () => {
    const path = cablePath(at(10, 20), at(300, 140))
    expect(path.startsWith('M 10 20 ')).toBe(true)
    expect(path.endsWith(' 300 140')).toBe(true)
  })

  it('hangs below the straight line between its ends, however they are arranged', () => {
    // Below the CHORD, not below both ends — which is what sag means and is what a real cable does. A
    // cable between a high jack and a much lower one has its middle above the lower end; asserting
    // otherwise was the first version of this test and it was demanding something no cable does.
    for (const [from, to] of [
      [at(0, 0), at(200, 0)],
      [at(0, 200), at(200, 0)],
      [at(0, 0), at(200, 200)],
      [at(200, 0), at(0, 0)],
      [at(0, 0), at(0, 200)],
      [at(0, 300), at(400, 10)],
    ]) {
      const middle = cableMiddle(from, to)
      expect(middle.y).toBeGreaterThan((from.y + to.y) / 2)
    }
  })

  it('hangs below both ends when they are level, which is most of them', () => {
    // Two jacks side by side on the same row is the common case, and there the stronger property holds.
    for (const width of [20, 120, 480]) {
      const middle = cableMiddle(at(0, 100), at(width, 100))
      expect(middle.y).toBeGreaterThan(100)
    }
  })

  it('sags most when the ends are closest', () => {
    // The property that separates a cable from a bezier. Two jacks next to each other have a big loop of
    // spare cable between them; two jacks far apart have almost none.
    const near = sag(at(0, 0), at(30, 0))
    const far = sag(at(0, 0), at(800, 0))
    expect(near).toBeGreaterThan(0)
    // Relative to the distance it spans, the short cable is far slacker.
    expect(near / 30).toBeGreaterThan((far / 800) * 5)
  })

  it('never goes taut', () => {
    // A cable pulled straight looks like a wire in a schematic, and two jacks on top of each other would
    // give a zero-length path with nothing to grab.
    expect(sag(at(0, 0), at(0, 0))).toBeGreaterThan(20)
  })

  it('puts the grab point on the curve', () => {
    // The click target for unpatching has to be on the cable. A cubic with both control points dropped by
    // the same amount is three quarters of that drop at its middle — worth having as arithmetic rather
    // than as a guess that happens to look close.
    const from = at(0, 0)
    const to = at(400, 100)
    const drop = sag(from, to)
    const middle = cableMiddle(from, to)
    expect(middle.x).toBe(200)
    expect(middle.y).toBeCloseTo(50 + drop * 0.75, 5)
  })

  it('rounds its coordinates so the path string stays short', () => {
    // These end up in the DOM on every pointer move while a cable is being dragged.
    expect(cablePath(at(1 / 3, 2 / 3), at(10 / 3, 20 / 3))).not.toMatch(/\d\.\d\d/)
  })
})

describe('a cable swinging after a flip', () => {
  // The detail that made Reason's back panel feel like an object. What is worth testing is not the exact
  // curve of the motion but the four things that make it read as physical: it starts and finishes at rest,
  // it goes both ways, longer cables swing slower, and the cable does not change length while it moves.

  it('hangs still until the rack is turned, and again once it has settled', () => {
    // A swing that never quite stopped would leave the panel permanently twitching, and the rAF loop
    // permanently running.
    const from = at(0, 0)
    const to = at(300, 0)
    expect(swingAngle(0, from, to)).toBe(0)
    expect(swingAngle(SWING_MS, from, to)).toBe(0)
    expect(swingAngle(SWING_MS + 500, from, to)).toBe(0)
    // Before the flip is not a state that should exist, but reversing time should not throw a cable out.
    expect(swingAngle(-100, from, to)).toBe(0)
  })

  it('starts moving immediately rather than easing in', () => {
    // Started with a kick, not released from a displacement: the rack accelerates away and the cable,
    // being where it was, is suddenly moving. `cos` here instead of `sin` would look like the cables
    // anticipated the flip.
    const angle = swingAngle(30, at(0, 0), at(300, 0))
    expect(Math.abs(angle)).toBeGreaterThan(0.05)
  })

  it('throws the cables the other way when the rack turns back', () => {
    // Flipping to the back and flipping to the front are opposite motions. A swing that ignored the
    // direction would be visibly wrong on every second press.
    const from = at(0, 0)
    const to = at(300, 0)
    for (const t of [20, 60, 140]) {
      expect(swingAngle(t, from, to, -1)).toBeCloseTo(-swingAngle(t, from, to, 1), 10)
    }
  })

  it('overshoots and comes back rather than easing to a stop', () => {
    // A cable that swung out and drifted back would read as a fade. It has to cross the middle.
    const from = at(0, 0)
    const to = at(300, 0)
    const samples = Array.from({ length: 160 }, (_, i) => swingAngle(i * 10, from, to))
    let crossings = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.sign(samples[i]) !== 0 && Math.sign(samples[i]) !== Math.sign(samples[i - 1])) crossings++
    }
    expect(crossings).toBeGreaterThanOrEqual(3)
  })

  it('decays, so each swing is smaller than the last', () => {
    // Every peak lower than the one before it, which is the actual claim. The first version of this
    // compared the largest angle in two fixed windows and only just failed: neither window happened to
    // land on a peak, so it was comparing a near-peak against an off-peak and calling the difference
    // decay. Finding the peaks first says the thing that is meant.
    const from = at(0, 0)
    const to = at(300, 0)
    const samples = Array.from({ length: 400 }, (_, i) => Math.abs(swingAngle(i * 4, from, to)))
    const peaks: number[] = []
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i] > samples[i - 1] && samples[i] >= samples[i + 1]) peaks.push(samples[i])
    }
    expect(peaks.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1])
  })

  it('is already still when the loop stops, so the cut is not itself a movement', () => {
    // The animation ends at SWING_MS and whatever the cable is doing then, it stops doing instantly. So
    // what matters is not the residual ANGLE but the residual displacement in the units the rack is drawn
    // in — the first tuning of this left 0.065rad at the cut, which is about four design units of belly
    // and a small visible snap. Asserted in design units because that is what somebody would see — the
    // rack renders about one design unit to the pixel, so two units is the threshold of nothing.
    const from = at(0, 0)
    const to = at(460, 200)
    for (const seed of [0, 0.5, 0.999]) {
      const last = cableMiddle(from, to, swingAngle(SWING_MS - 16, from, to, 1, seed))
      const rest = cableMiddle(from, to)
      expect(Math.hypot(last.x - rest.x, last.y - rest.y)).toBeLessThan(2)
    }
  })

  it('swings a long cable more slowly than a short one', () => {
    const short = swingPeriod(at(0, 0), at(20, 0))
    const long = swingPeriod(at(0, 0), at(900, 0))
    expect(long).toBeGreaterThan(short * 1.5)
    // A pendulum, so it goes as the square root: the ratio of periods is the root of the ratio of sags.
    const ratio = sag(at(0, 0), at(900, 0)) / sag(at(0, 0), at(20, 0))
    expect(long / short).toBeCloseTo(Math.sqrt(ratio), 6)
  })

  it('does not rely on length alone to break the lockstep', () => {
    // Measured in the browser, and the reason `seed` exists. Every cable in the shipped patch spans
    // between 433 and 508 design units — the rack is one column wide, so they all run about the same
    // diagonal. Through the sag and then the square root that is a 5% spread in period, and all eight
    // cables peaked on the same frame of the same swing. Length-derived periods are correct and, here,
    // not enough on their own.
    const spans = [433, 463, 470, 491, 508]
    const fromLength = spans.map((d) => swingPeriod(at(0, 0), at(d, 0)))
    const spread = Math.max(...fromLength) / Math.min(...fromLength)
    expect(spread).toBeLessThan(1.1)

    // With each cable's own seed the spread is worth having.
    const seeded = spans.map((d, i) => swingPeriod(at(0, 0), at(d, 0), i / spans.length))
    expect(Math.max(...seeded) / Math.min(...seeded)).toBeGreaterThan(1.2)
  })

  it('gives a cable the same character every time it is drawn', () => {
    // Not randomness: a seed that changed between renders would make the cable jump. It has to be a
    // function of the cable's own name and nothing else.
    expect(swingSeed('vco.out>ladder.in')).toBe(swingSeed('vco.out>ladder.in'))
    expect(swingSeed('vco.out>ladder.in')).not.toBe(swingSeed('adsr.out>vca.cv'))
    for (const key of ['a', 'clock.gate>seq.clock', 'out.in', '', 'x'.repeat(200)]) {
      const seed = swingSeed(key)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(1)
    }
  })

  it('spreads the seeds out rather than clustering them', () => {
    // A hash that put every real cable name in the same tenth would leave the lockstep exactly where it
    // was, so this checks against names of the shape the panel actually generates.
    const keys = [
      'clock.gate>seq.clock',
      'seq.pitch>vco.pitch',
      'seq.gate>adsr.gate',
      'vco.out>ladder.in',
      'adsr.out>vca.cv',
      'ladder.out>vca.in',
      'vca.out>out.in',
      'seq.trig>vca.cv',
    ]
    const seeds = keys.map(swingSeed)
    expect(new Set(seeds).size).toBe(keys.length)
    // Spanning most of the range, not huddled in a corner of it.
    expect(Math.max(...seeds) - Math.min(...seeds)).toBeGreaterThan(0.5)
  })

  it('holds a cable still for its own moment before it starts to move', () => {
    // The stagger, so the panel comes loose in a ripple rather than snapping sideways as one sheet. A
    // cable with a late seed has not moved yet at 20ms; one with a zero seed has.
    const from = at(0, 0)
    const to = at(460, 200)
    expect(swingAngle(20, from, to, 1, 0)).not.toBe(0)
    expect(swingAngle(20, from, to, 1, 0.95)).toBe(0)
    // And it still gets its full swing once it starts.
    const late = Array.from({ length: 60 }, (_, i) => Math.abs(swingAngle(i * 10, from, to, 1, 0.95)))
    expect(Math.max(...late)).toBeGreaterThan(0.5)
  })

  it('settles every cable by the time the animation stops, whatever its seed', () => {
    // The loop stops at SWING_MS and whatever a cable is doing then is where it stays. A stagger that
    // pushed a cable's motion past that would leave it permanently leaning.
    const from = at(0, 0)
    const to = at(460, 200)
    for (const seed of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(swingAngle(SWING_MS, from, to, 1, seed)).toBe(0)
      expect(swingAngle(SWING_MS - 1, from, to, 1, seed)).toBeCloseTo(0, 1)
    }
  })

  it('moves far enough at its peak to actually be seen', () => {
    // The assertion this file most needed and did not originally have. The first version of the swing
    // conserved the cable's length exactly, by swinging the belly on an arc of radius `sag` — correct
    // physics, and measured in the browser at 10.8 design units of travel. On a rack 480 units wide that
    // is invisible; the mid-swing screenshot was indistinguishable from the settled one. Every property
    // test in this block passed while the feature did nothing.
    //
    // So: a floor on how far the belly travels, in the same units the rack is laid out in.
    for (const [from, to] of [
      [at(0, 0), at(120, 0)],
      [at(0, 40), at(440, 300)],
      [at(20, 400), at(460, 60)],
    ]) {
      const still = cableMiddle(from, to)
      const thrown = cableMiddle(from, to, 0.9)
      expect(Math.abs(thrown.x - still.x)).toBeGreaterThan(30)
    }
  })

  it('lifts the belly as it swings out, and dips as it passes through the middle', () => {
    // The part that sells it: the cable does not just slide sideways on rails, it rises and falls. Second
    // order in the angle, so the bob runs at twice the rate of the sway without a second oscillator.
    const from = at(0, 100)
    const to = at(400, 100)
    const still = cableMiddle(from, to, 0)
    const out = cableMiddle(from, to, 0.9)
    expect(out.x).toBeGreaterThan(still.x)
    expect(out.y).toBeLessThan(still.y)
    // Symmetric: swinging the other way lifts it by the same amount and throws it the other side.
    const other = cableMiddle(from, to, -0.9)
    expect(other.y).toBeCloseTo(out.y, 6)
    expect(other.x).toBeLessThan(still.x)
  })

  it('never lifts the belly above the jacks it hangs from', () => {
    // Length is only approximately conserved now, so this is the bound that replaces it: however hard a
    // cable is thrown it still hangs, rather than snapping up into a taut line across the panel.
    const from = at(0, 100)
    const to = at(400, 100)
    for (const angle of [0, 0.4, -0.4, 0.9, -0.9, 1.2]) {
      expect(cableMiddle(from, to, angle).y).toBeGreaterThan(100)
    }
  })

  it('still draws a path anchored on the jacks mid-swing', () => {
    // Whatever the cable is doing in the middle, both ends stay plugged in.
    const path = cablePath(at(10, 20), at(300, 140), 0.4)
    expect(path.startsWith('M 10 20 ')).toBe(true)
    expect(path.endsWith(' 300 140')).toBe(true)
  })

  it('draws exactly the resting path at rest', () => {
    // The default has to be arithmetically identical, not merely close, or every existing cable would
    // shift by a fraction of a unit the moment the swing was introduced.
    for (const [from, to] of [
      [at(0, 0), at(200, 0)],
      [at(30, 300), at(410, 12)],
      [at(0, 0), at(0, 0)],
    ]) {
      expect(cablePath(from, to, 0)).toBe(cablePath(from, to))
      expect(cableMiddle(from, to, 0)).toEqual(cableMiddle(from, to))
    }
  })
})
