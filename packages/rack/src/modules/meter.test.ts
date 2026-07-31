import { describe, expect, it } from 'vitest'
import { METER_MODULE, MeterProcessor } from './meter.js'

const SR = 48_000
const FRAMES = 128

function run(
  processor: MeterProcessor,
  input: Float32Array,
  gain = 1,
  release = 0.3,
) {
  const thru = new Float32Array(FRAMES)
  const env = new Float32Array(FRAMES)
  processor.process(
    [input],
    [thru, env],
    [
      new Float32Array(FRAMES).fill(gain),
      new Float32Array(FRAMES).fill(release),
      new Float32Array(FRAMES).fill(0),
    ],
    FRAMES,
  )
  return { thru, env, meter: processor.meter() }
}

describe('VU meter', () => {
  it('passes the signal through sample for sample', () => {
    const input = Float32Array.from(
      { length: FRAMES },
      (_, index) => Math.sin((index / FRAMES) * Math.PI * 4) * 0.7,
    )
    const result = run(new MeterProcessor(SR), input)
    expect([...result.thru]).toEqual([...input])
  })

  it('measures RMS and peak with sensitivity without changing Thru', () => {
    const input = new Float32Array(FRAMES).fill(0.25)
    const result = run(new MeterProcessor(SR), input, 2)

    expect(result.meter.level).toBeCloseTo(0.5, 6)
    expect(result.meter.peak).toBeCloseTo(0.5, 6)
    expect([...result.thru]).toEqual([...input])
  })

  it('holds a ballistic envelope and exposes it as CV', () => {
    const processor = new MeterProcessor(SR)
    const loud = run(processor, new Float32Array(FRAMES).fill(1), 1, 1)
    const after = run(processor, new Float32Array(FRAMES), 1, 1)

    expect(loud.env[FRAMES - 1]).toBeGreaterThan(0.6)
    expect(after.env[0]).toBeGreaterThan(0)
    expect(after.env[FRAMES - 1]).toBeLessThan(loud.env[FRAMES - 1])
    expect(after.meter.envelope).toBeCloseTo(after.env[FRAMES - 1], 6)
  })

  it('publishes a small clipped waveform for the faceplate', () => {
    const input = Float32Array.from(
      { length: FRAMES },
      (_, index) => (index % 2 === 0 ? -2 : 2),
    )
    const reading = run(new MeterProcessor(SR), input).meter

    expect(reading.waveform).toHaveLength(48)
    expect(Math.min(...reading.waveform)).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...reading.waveform)).toBeLessThanOrEqual(1)
  })

  it('declares the display choice as patch state and stays mono after polyphonic collapse', () => {
    expect(METER_MODULE.params.find((param) => param.id === 'mode')?.labels).toEqual([
      'VU',
      'LED',
      'Wave',
    ])
    expect(METER_MODULE.poly).toBe(false)
  })
})
