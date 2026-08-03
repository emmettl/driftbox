import { describe, expect, it } from 'vitest'
import { LOOPER_MODULE, LooperProcessor } from './looper.js'

const SR = 8000
const FRAMES = 8
const filled = (value: number) => new Float32Array(FRAMES).fill(value)

function run(
  processor: LooperProcessor,
  mode: number,
  left = filled(0),
  right = filled(0),
  options: { feedback?: number; dry?: number; loop?: number; clear?: number } = {},
) {
  const outLeft = new Float32Array(FRAMES)
  const outRight = new Float32Array(FRAMES)
  processor.process(
    [left, right],
    [outLeft, outRight],
    [
      filled(mode),
      filled(options.feedback ?? 0.85),
      filled(options.dry ?? 1),
      filled(options.loop ?? 1),
      filled(options.clear ?? 0),
    ],
    FRAMES,
  )
  return [outLeft, outRight] as const
}

describe('the performance looper', () => {
  it('passes stereo dry signal while stopped', () => {
    const left = Float32Array.from({ length: FRAMES }, (_, index) => index / 10)
    const right = Float32Array.from({ length: FRAMES }, (_, index) => -index / 20)
    const output = run(new LooperProcessor(SR), 0, left, right)
    expect([...output[0]]).toEqual([...left])
    expect([...output[1]]).toEqual([...right])
  })

  it('closes a recorded first pass and plays both channels from its beginning', () => {
    const looper = new LooperProcessor(SR)
    const left = Float32Array.from({ length: FRAMES }, (_, index) => index / 20)
    const right = Float32Array.from({ length: FRAMES }, (_, index) => 0.5 - index / 30)
    run(looper, 1, left, right)
    const playback = run(looper, 2, filled(0), filled(0), { dry: 0 })
    expect([...playback[0]]).toEqual([...left])
    expect([...playback[1]]).toEqual([...right])
  })

  it('uses feedback when overdubbing and keeps the channels independent', () => {
    const looper = new LooperProcessor(SR)
    run(looper, 1, filled(0.2), filled(-0.1))
    run(looper, 3, filled(0.3), filled(0.05), { feedback: 0.5, dry: 0 })
    const playback = run(looper, 2, filled(0), filled(0), { dry: 0 })
    expect(playback[0][0]).toBeCloseTo(0.4)
    expect(playback[1][0]).toBeCloseTo(0)
  })

  it('lets Dub make the first pass on an empty pedal', () => {
    const looper = new LooperProcessor(SR)
    run(looper, 3, filled(0.25), filled(-0.25))
    const playback = run(looper, 2, filled(0), filled(0), { dry: 0 })
    expect(playback[0][0]).toBeCloseTo(0.25)
    expect(playback[1][0]).toBeCloseTo(-0.25)
  })

  it('clears on every change of the hidden trigger', () => {
    const looper = new LooperProcessor(SR)
    run(looper, 1, filled(0.4), filled(0.4))
    run(looper, 2, filled(0), filled(0), { dry: 0 })
    const cleared = run(looper, 2, filled(0), filled(0), { dry: 0, clear: 1 })
    expect(cleared[0].every((sample) => sample === 0)).toBe(true)
    expect(looper.meter().loopSeconds).toBe(0)

    run(looper, 1, filled(0.2), filled(0.2), { clear: 1 })
    run(looper, 2, filled(0), filled(0), { dry: 0, clear: 1 })
    const clearedAgain = run(looper, 2, filled(0), filled(0), { dry: 0, clear: 0 })
    expect(clearedAgain[0].every((sample) => sample === 0)).toBe(true)
  })

  it('publishes loop length, playhead and a display waveform', () => {
    const looper = new LooperProcessor(SR)
    run(looper, 1, filled(0.25), filled(-0.1))
    run(looper, 2, filled(0), filled(0), { dry: 0 })
    const reading = looper.meter()
    expect(reading.loopSeconds).toBeCloseTo(FRAMES / SR)
    expect(reading.loopPosition).toBeGreaterThanOrEqual(0)
    expect(reading.waveform).toHaveLength(48)
    expect(reading.waveform.some((sample) => sample !== 0)).toBe(true)
  })

  it('declares stereo ports, four performance states and one shared instance', () => {
    expect(LOOPER_MODULE.inlets[0].stereo).toBe(true)
    expect(LOOPER_MODULE.outlets[0].stereo).toBe(true)
    expect(LOOPER_MODULE.params[0].labels).toEqual(['Stop', 'Rec', 'Play', 'Dub'])
    expect(LOOPER_MODULE.params.find((param) => param.id === 'clear')?.hidden).toBe(true)
    expect(LOOPER_MODULE.poly).toBe(false)
  })
})
