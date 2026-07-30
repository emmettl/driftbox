import { describe, expect, it } from 'vitest'
import { cableMiddle, cablePath, sag } from './cable.js'

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
