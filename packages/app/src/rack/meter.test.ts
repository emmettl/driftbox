import type { MeterReading } from '@driftbox/rack'
import { describe, expect, it, vi } from 'vitest'
import { meterSnapshot, publishMeters, subscribeMeter } from './meter.js'

const reading = (id: string, level: number): MeterReading => ({
  id,
  level,
  peak: level,
  envelope: level,
  waveform: new Float32Array(48).fill(level),
})

describe('meter display store', () => {
  it('notifies only the faceplate whose module changed', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeMeter('meter-a', first)
    const stopSecond = subscribeMeter('meter-b', second)

    publishMeters([reading('meter-a', 0.5)])
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(meterSnapshot('meter-a').level).toBe(0.5)

    stopFirst()
    stopSecond()
  })

  it('provides a stable silent reading before audio starts', () => {
    expect(meterSnapshot('not-built-yet')).toMatchObject({
      level: 0,
      peak: 0,
      envelope: 0,
    })
  })
})
