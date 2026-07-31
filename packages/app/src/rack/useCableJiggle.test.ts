import { describe, expect, it } from 'vitest'
import { jiggleImpulse } from './useCableJiggle.js'

describe('cable jiggle from a module drag', () => {
  it('lags behind horizontal movement and reverses with it', () => {
    expect(jiggleImpulse({ x: 10, y: 20 }, { x: 30, y: 20 })).toBeLessThan(0)
    expect(jiggleImpulse({ x: 30, y: 20 }, { x: 10, y: 20 })).toBeGreaterThan(0)
  })

  it('also reacts to a vertical move instead of leaving the cable rigid', () => {
    expect(jiggleImpulse({ x: 10, y: 20 }, { x: 10, y: 60 })).not.toBe(0)
  })

  it('does not kick a cable when the module has not moved', () => {
    expect(jiggleImpulse({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(0)
  })
})
