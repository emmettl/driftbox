import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')

describe('the rack turn', () => {
  it('reveals rear cables after the midpoint only when turning front to back', () => {
    expect(styles).toContain(
      '.rk-rack-flipped .rk-cable {\n  animation: rk-reveal-rear-cables var(--spin) linear;\n}',
    )
    expect(styles).toContain('0%,\n  54.99% {\n    opacity: 0;')
    expect(styles).toContain('55%,\n  100% {\n    opacity: 1;')
    expect(styles).not.toContain('.rk-rack:not(.rk-rack-flipped) .rk-cable')
  })

  it('does not delay cables when reduced motion removes the turn', () => {
    expect(styles).toContain('.rk-rack-flipped .rk-cable {\n    animation: none;\n  }')
  })
})
