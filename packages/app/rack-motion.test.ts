import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')

describe('the rack turn', () => {
  it('reveals rear cables just after the eased turn crosses the edge', () => {
    expect(styles).toContain(
      '.rk-rack-flipped {\n  transform: rotateY(180deg);\n  animation: rk-reveal-rear-cables var(--spin) linear;\n}',
    )
    expect(styles).toContain(
      '.rk-rack-flipped .rk-cable {\n  opacity: var(--rk-rear-cable-opacity);\n}',
    )
    expect(styles).toContain('0%,\n  45.79% {\n    --rk-rear-cable-opacity: 0;')
    expect(styles).toContain('45.8%,\n  100% {\n    --rk-rear-cable-opacity: 1;')
    expect(styles).not.toContain('.rk-rack:not(.rk-rack-flipped) .rk-cable')
  })

  it('does not delay cables when reduced motion removes the turn', () => {
    expect(styles).toContain('.rk-rack-flipped {\n    animation: none;\n  }')
  })
})
