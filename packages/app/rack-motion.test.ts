import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')
const rackApp = readFileSync(new URL('./src/rack/RackApp.tsx', import.meta.url), 'utf8')

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

describe('the performance view hand-off', () => {
  it('uses the real pad as a shared element between split and full layouts', () => {
    expect(rackApp).toContain('document.startViewTransition(() => flushSync(update))')
    expect(styles).toContain('view-transition-name: rk-performance-pad;')
    expect(styles).toContain('view-transition-name: rk-performance-rack;')
    expect(styles).toContain(
      "html[data-rack-view-transition='split-pad']::view-transition-group(rk-performance-pad)",
    )
  })

  it('keeps the hidden pad face out of flattened transition snapshots', () => {
    expect(styles).toContain('.rk-pad-face-front {\n  opacity: 1;')
    expect(styles).toContain('.rk-pad-face-back {\n  opacity: 0;')
    expect(styles).toContain(".rk-pad[data-side='back'] .rk-pad-face-front {\n  opacity: 0;")
    expect(styles).toContain(".rk-pad[data-side='back'] .rk-pad-face-back {\n  opacity: 1;")
    expect(styles).toContain('.rk-pad-face {\n    transition: none;\n  }')
  })

  it('hands full-pad mode back to an animated rack without overriding reduced motion', () => {
    expect(styles).toContain(
      "html[data-rack-view-transition='pad-rack']::view-transition-old(rk-performance-pad)",
    )
    expect(styles).toContain(
      "html[data-rack-view-transition='pad-rack']::view-transition-new(rk-performance-rack)",
    )
    expect(rackApp).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches")
  })
})
