import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PerformPad } from './PerformPad.js'

describe('the rack performance pad', () => {
  it('has a distinct back side with its creature while remaining the performance filter', () => {
    const front = renderToStaticMarkup(createElement(PerformPad, { kaoss: null, flipped: false }))
    const back = renderToStaticMarkup(createElement(PerformPad, { kaoss: null, flipped: true }))

    expect(front).toContain('data-side="front"')
    expect(front).not.toContain('backstage creature')
    expect(back).toContain('data-side="back"')
    expect(back).toContain('backstage creature')
    expect(back).toContain('Performance filter, back side')
  })
})
