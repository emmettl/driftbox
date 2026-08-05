import { describe, expect, it } from 'vitest'
import { initialRackView, SPLIT_MIN_WIDTH } from './view.js'

// The opening view is one comparison, and its two halves live in different languages: this side decides,
// and `rack.css` lays out what was decided. The arithmetic is here; `rack-motion.test.ts` holds the two
// sides in step, because reading a stylesheet as text belongs with the other tests that already do.

describe('the view the rack opens on', () => {
  it('starts split wherever both bays fit', () => {
    expect(initialRackView(SPLIT_MIN_WIDTH)).toBe('split')
    expect(initialRackView(1440)).toBe('split')
    expect(initialRackView(3840)).toBe('split')
  })

  it('starts on the rack rather than on half of one', () => {
    expect(initialRackView(SPLIT_MIN_WIDTH - 1)).toBe('rack')
    expect(initialRackView(390)).toBe('rack')
    // Zero is what a missing window reports, and the rack is the safe thing to guess.
    expect(initialRackView(0)).toBe('rack')
  })
})
