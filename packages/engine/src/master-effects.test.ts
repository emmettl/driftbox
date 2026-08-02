import { describe, expect, it } from 'vitest'
import { driveCurve, pcfDecaySeconds, pcfFrequency } from './master-effects.js'

describe('authored master effect mappings', () => {
  it('has a true clean drive state and bounded symmetric saturation', () => {
    expect(driveCurve(0)).toBeNull()
    const curve = driveCurve(1)!
    expect(curve[0]).toBeCloseTo(-1, 5)
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5)
    expect(curve[Math.floor(curve.length / 2)]).toBeGreaterThanOrEqual(0)
  })

  it('maps the PCF knobs onto useful musical ranges', () => {
    expect(pcfFrequency(0)).toBe(60)
    expect(pcfFrequency(1)).toBe(12_000)
    expect(pcfFrequency(0.5)).toBeGreaterThan(500)
    expect(pcfDecaySeconds(0)).toBe(0.025)
    expect(pcfDecaySeconds(1)).toBe(0.8)
  })
})
