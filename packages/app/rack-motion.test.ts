import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')

describe('the rack turn', () => {
  it('reveals the stable rear face just after the eased turn crosses the edge', () => {
    expect(styles).toContain(
      '.rk-rack-flipped {\n  transform: rotateY(180deg);\n}',
    )
    expect(styles).toContain(
      '.rk-rack-flipped .rk-side-back {\n  animation: rk-reveal-rear-face var(--spin) linear;\n}',
    )
    expect(styles).toContain('0%,\n  45.79% {\n    opacity: 0;')
    expect(styles).toContain('45.8%,\n  100% {\n    opacity: 1;')
    expect(styles).not.toContain('--rk-rear-cable-opacity')
    expect(styles).not.toContain('45.79% {\n    visibility: hidden;')
  })

  it('does not delay the rear face when reduced motion removes the turn', () => {
    expect(styles).toContain('.rk-rack-flipped .rk-side-back {\n    animation: none;\n  }')
  })
})
