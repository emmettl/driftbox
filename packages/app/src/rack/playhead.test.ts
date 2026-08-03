import { describe, expect, it } from 'vitest'
import { beatsAt, moveTo, stepAt, STOPPED, timeOfStep } from './playhead.js'

// Where the rack's transport is, in musical time. Pure arithmetic against a clock the caller supplies, so
// none of this needs audio — which is the whole reason it is its own file rather than a few lines inside a
// component that could only be checked by ear.

describe('a stopped transport', () => {
  it('is at the top and stays there', () => {
    expect(beatsAt(STOPPED, 0)).toBe(0)
    expect(beatsAt(STOPPED, 100)).toBe(0)
  })
})

describe('a running transport', () => {
  const started = moveTo(STOPPED, 10, true, 120)

  it('advances at the tempo it was given', () => {
    // 120bpm is two beats a second, so a second after starting is beat two.
    expect(beatsAt(started, 11)).toBeCloseTo(2, 5)
    expect(beatsAt(started, 12)).toBeCloseTo(4, 5)
  })

  it('rewinds to the top when it starts, rather than resuming', () => {
    // Matching `Graph.setTransport`. A transport that resumed where it left off would put a recording
    // somewhere nobody was looking at.
    const stopped = moveTo(started, 12, false, 120)
    expect(beatsAt(stopped, 12)).toBeCloseTo(4, 5)
    const again = moveTo(stopped, 20, true, 120)
    expect(beatsAt(again, 20)).toBe(0)
  })

  it('holds its position while stopped so a knob moved there still records somewhere real', () => {
    const stopped = moveTo(started, 12, false, 120)
    expect(beatsAt(stopped, 99)).toBeCloseTo(4, 5)
  })

  it('counts sixteenths from the top', () => {
    // Four sixteenths to a beat, so a second at 120bpm is eight steps.
    expect(stepAt(started, 10)).toBe(0)
    expect(stepAt(started, 11)).toBe(8)
  })
})

describe('changing tempo while it runs', () => {
  it('carries on from where the music was rather than jumping', () => {
    // The piece worth reading twice. Multiplying total elapsed seconds by the *current* tempo would move
    // every position already recorded the moment somebody nudged the tempo — a lane recorded at 174 would
    // drift the instant you tried it at 172.
    const head = moveTo(STOPPED, 0, true, 120)
    expect(beatsAt(head, 2)).toBeCloseTo(4, 5)

    const faster = moveTo(head, 2, true, 240)
    // Still at beat four at the moment of the change: nothing jumps.
    expect(beatsAt(faster, 2)).toBeCloseTo(4, 5)
    // And a second later it has covered four beats rather than two.
    expect(beatsAt(faster, 3)).toBeCloseTo(8, 5)
  })

  it('is unchanged by being told the tempo it already has', () => {
    const head = moveTo(STOPPED, 0, true, 120)
    expect(moveTo(head, 5, true, 120)).toBe(head)
  })

  it('ignores a tempo that is not one', () => {
    const head = moveTo(STOPPED, 0, true, Number.NaN)
    expect(head.tempo).toBe(120)
    expect(moveTo(head, 1, true, 0).tempo).toBe(120)
  })

  it('clamps to the same range the graph does', () => {
    expect(moveTo(STOPPED, 0, true, 5).tempo).toBe(20)
    expect(moveTo(STOPPED, 0, true, 5000).tempo).toBe(400)
  })
})

describe('turning a position back into a time', () => {
  it('round-trips a step', () => {
    // What playback needs: a recorded position becomes a context time, which becomes a frame. A step that
    // did not survive the trip would put every point in the wrong place, consistently and invisibly.
    const head = moveTo(STOPPED, 4, true, 174)
    for (const step of [0, 1, 16, 97]) {
      expect(stepAt(head, timeOfStep(head, step))).toBe(step)
    }
  })

  it('survives a tempo change mid-arrangement', () => {
    let head = moveTo(STOPPED, 0, true, 120)
    head = moveTo(head, 4, true, 174)
    for (const step of [40, 41, 64]) {
      expect(stepAt(head, timeOfStep(head, step))).toBe(step)
    }
  })

  it('is the top of the arrangement when nothing is running', () => {
    expect(timeOfStep(STOPPED, 32)).toBe(0)
  })
})
