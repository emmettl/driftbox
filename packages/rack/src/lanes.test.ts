import { describe, expect, it } from 'vitest'
import { MODULES } from './modules/index.js'
import { STEPS_PER_BAR } from './automation.js'
import { RackRenderer } from './headless.js'
import { LanePlayer, type LaneHost } from './lanes.js'
import type { AutoLane, Patch } from './types.js'

// The lookahead scheduler, which used to live in the app and therefore did not exist for anybody else.
//
// Two things are worth testing and they are the two the app got wrong on the way to getting it right: that a
// point is queued exactly once — the seam between one window and the next — and that it is queued *at* its
// position rather than at whenever the tick happened to notice it. Everything else is bookkeeping around a
// transport that can stop, seek and loop.

/** A host whose clock the test owns, recording what it was told to schedule. */
function fakeHost(tempo = 120): Omit<LaneHost, 'beat' | 'tempo' | 'running'> & {
  now: number
  beat: number
  tempo: number
  running: boolean
  scheduled: { target: string; value: number; frame: number }[]
} {
  return {
    now: 0,
    beat: 0,
    tempo,
    running: true,
    scheduled: [] as { target: string; value: number; frame: number }[],
    get time() {
      return this.now
    },
    frameFor(seconds: number) {
      return Math.max(0, Math.round(seconds * 48000))
    },
    scheduleParam(moduleId: string, paramId: string, value: number, frame: number) {
      this.scheduled.push({ target: `${moduleId}.${paramId}`, value, frame })
    },
  }
}

const lane = (points: { at: number; value: number }[]): AutoLane => ({
  target: ['filter', 'cutoff'],
  points,
})

describe('LanePlayer', () => {
  it('queues a point at the frame its position falls on', () => {
    // At 120bpm a sixteenth is 125ms. A point four steps in belongs half a second after the top, which at
    // 48kHz is frame 24000 — and the value has to arrive there rather than at the tick that noticed it.
    const host = fakeHost(120)
    const player = new LanePlayer(host, { lookahead: 1 })
    player.advance([lane([{ at: 4, value: 900 }])])

    expect(host.scheduled).toEqual([{ target: 'filter.cutoff', value: 900, frame: 24000 }])
  })

  it('queues each point exactly once across the seam', () => {
    // `pointsIn` is open at the start and closed at the end so that a window advancing by its own end does
    // not schedule the value on the seam twice — the failure that reads as a knob jumping twice.
    const host = fakeHost(120)
    const player = new LanePlayer(host, { lookahead: 0.25 })
    const lanes = [lane([{ at: 1, value: 1 }, { at: 2, value: 2 }, { at: 3, value: 3 }])]

    // Advance in small steps of real time, the way a 100ms tick would.
    for (let tick = 0; tick < 20; tick++) {
      player.advance(lanes)
      host.now += 0.1
      host.beat += (0.1 * host.tempo) / 60
    }

    expect(host.scheduled.map((entry) => entry.value)).toEqual([1, 2, 3])
  })

  it('queues nothing while the transport is stopped, and does not replay when it starts', () => {
    const host = fakeHost(120)
    host.running = false
    const player = new LanePlayer(host, { lookahead: 0.25 })
    const lanes = [lane([{ at: 0, value: 1 }, { at: 8, value: 2 }])]

    host.beat = 4 // parked a bar in
    player.advance(lanes)
    expect(host.scheduled).toHaveLength(0)
    // The window followed the position while stopped, so pressing play does not hand over a quarter of a
    // second of moves that never happened.
    expect(player.position).toBeCloseTo(4 * (STEPS_PER_BAR / 4))
  })

  it('re-queues from the top after a seek backwards', () => {
    // A loop. Without rewinding the window, every lane would go silent until the music caught up with
    // wherever the window had already reached.
    const host = fakeHost(120)
    const player = new LanePlayer(host, { lookahead: 0.25 })
    const lanes = [lane([{ at: 1, value: 1 }])]

    host.beat = 8
    player.advance(lanes)
    expect(host.scheduled).toHaveLength(0) // long past that point

    host.beat = 0
    host.now = 4
    player.advance(lanes)
    expect(host.scheduled.map((entry) => entry.value)).toEqual([1])
  })

  it('reads the tempo every time rather than holding the one it started with', () => {
    // A lane is recorded in musical positions precisely so it survives a tempo change. Holding the tempo
    // here would put every point in the wrong place the moment somebody moved it.
    const host = fakeHost(120)
    const player = new LanePlayer(host, { lookahead: 1 })
    host.tempo = 240
    player.advance([lane([{ at: 4, value: 900 }])])

    // Twice the tempo, half the time: frame 12000 rather than 24000.
    expect(host.scheduled[0].frame).toBe(12000)
  })

  it('plays the automation in a patch through a real rack', () => {
    // End to end on the headless host, which is the only one a node test can drive: the lane closes the Out
    // halfway through, and the audio has to show it.
    const patch: Patch = {
      modules: [
        { id: 'osc', type: 'vco', params: { tune: 0 } },
        { id: 'out', type: 'out', params: { level: 0.8 } },
      ],
      cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
      tempo: 120,
      automation: [{ target: ['out', 'level'], points: [{ at: 0, value: 0.8 }, { at: 8, value: 0 }] }],
    }

    const renderer = new RackRenderer(MODULES, { sampleRate: 48000 })
    renderer.patch = patch
    renderer.setTransport(120, true)
    const player = new LanePlayer(renderer)

    // Eight sixteenths at 120bpm is one second, so two seconds covers the whole lane.
    const audio = renderer.render(2, () => player.advance(patch.automation))

    const rms = (from: number, to: number) => {
      let sum = 0
      for (let i = from; i < to; i++) sum += audio.channels[0][i] ** 2
      return Math.sqrt(sum / (to - from))
    }
    expect(rms(0, 24000)).toBeGreaterThan(0.1)
    // Past the last point the lane holds its final value, which is silence.
    expect(rms(60000, 96000)).toBeLessThan(0.01)
  })
})
