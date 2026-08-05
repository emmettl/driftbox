import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SPLIT_MIN_WIDTH } from './src/rack/view.js'

const styles = readFileSync(new URL('./src/rack/rack.css', import.meta.url), 'utf8')
// The two halves of the performance view, read as text. `useRackView` decides which arrangement is on
// screen and how the browser gets there; `RackStage` lays the result out. They were one component when
// these assertions were written, and the claims are the same either way — a stylesheet and the code that
// drives it, held in step.
const rackView = readFileSync(new URL('./src/rack/useRackView.ts', import.meta.url), 'utf8')
const rackStage = readFileSync(new URL('./src/rack/RackStage.tsx', import.meta.url), 'utf8')

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
    expect(rackView).toContain('document.startViewTransition(() => flushSync(update))')
    expect(styles).toContain('view-transition-name: rk-performance-pad;')
    expect(styles).toContain('view-transition-name: rk-performance-rack;')
    expect(styles).toContain(
      "html[data-rack-view-transition='split-pad']::view-transition-group(rk-performance-pad)",
    )
  })

  it('captures a non-rotating shell so cycling views cannot flatten the rack turn', () => {
    expect(rackStage).toContain('className="rk-rack-snapshot"')
    expect(styles).toContain(
      '.rk-rack-snapshot {\n  position: relative;\n  view-transition-name: rk-performance-rack;',
    )
    expect(styles).not.toContain('.rk-rack {\n  position: relative;\n  view-transition-name:')
  })

  it('reopens split at the rack bay and keeps the keyboard above transition snapshots', () => {
    expect(rackView).toContain(
      "if (rackView === 'split' && performanceSpace.current) performanceSpace.current.scrollLeft = 0",
    )
    expect(rackStage).toContain('ref={performanceSpace}')
    expect(rackStage).toContain('className={`rk-performance-space rk-performance-space-${rackView}')
    expect(styles).toContain('view-transition-name: rk-performance-keyboard;')
    expect(styles).toContain('::view-transition-group(rk-performance-keyboard) {\n  z-index: 2;')
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
    expect(rackView).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches")
  })

  it('opens on split where there is room, without animating an arrival nothing moved into', () => {
    expect(rackView).toContain(
      "initialRackView(typeof window === 'undefined' ? 0 : window.innerWidth)",
    )
    // The entrance keyframes are cancelled until the View button has actually moved something, and
    // restored from then on — so cycling back into split still slides the rack aside.
    expect(rackStage).toContain("viewCycled ? '' : ' rk-performance-space-seated'")
    expect(rackView).toContain('setViewCycled(true)')
    expect(styles).toContain(
      '.rk-performance-space-seated .rk-stage,\n.rk-performance-space-seated .rk-perform {\n  animation: none;\n}',
    )
    // Order is the whole mechanism: these selectors weigh the same as the ones setting the entrance, so
    // the rule cancelling it has to come after them.
    expect(styles.indexOf('.rk-performance-space-seated .rk-stage')).toBeGreaterThan(
      styles.indexOf('animation: rk-pad-arrive'),
    )
  })

  it('decides the opening width from the layout the stylesheet actually draws', () => {
    // Two 480px bays, the 24px gutter and 16px of padding either side: `SPLIT_MIN_WIDTH` is arithmetic on
    // these four numbers, and the media query below is the same threshold from the other end. If a bay or
    // the gutter changes, this catches whichever half of the pair got left behind.
    expect(styles).toContain('grid-template-columns: 480px 480px;')
    expect(styles).toContain('gap: 24px;\n  padding: 32px 16px calc(48px + var(--keys-offset));')
    expect(480 * 2 + 24 + 16 * 2).toBe(SPLIT_MIN_WIDTH)
    expect(styles).toContain(`@media (max-width: ${SPLIT_MIN_WIDTH - 1}px)`)
  })
})
