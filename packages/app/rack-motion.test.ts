import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')

describe('the rack turn', () => {
  it('hands off both stable faces at the same edge in either direction', () => {
    expect(styles).toContain(
      '.rk-rack-flipped {\n  transform: rotateY(180deg);\n}',
    )
    expect(styles).toContain(
      '--spin: 520ms;\n  --spin-edge: 238ms;',
    )
    expect(styles).toContain(
      'transition: opacity 0s linear var(--spin-edge);',
    )
    expect(styles).toContain('.rk-side-front {\n  opacity: 1;\n}')
    expect(styles).toContain('.rk-side-back {\n  opacity: 0;')
    expect(styles).toContain('.rk-rack-flipped .rk-side-front {\n  opacity: 0;\n}')
    expect(styles).toContain('.rk-rack-flipped .rk-side-back {\n  opacity: 1;\n}')
    expect(styles).not.toContain('--rk-rear-cable-opacity')
    expect(styles).not.toContain('@keyframes rk-hide-front-face')
    expect(styles).not.toContain('@keyframes rk-reveal-rear-face')
  })

  it('does not delay either face when reduced motion removes the turn', () => {
    expect(styles).toContain('.rk-side {\n    transition: none;\n  }')
  })
})
