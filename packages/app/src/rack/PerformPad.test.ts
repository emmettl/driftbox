import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PerformPad } from './PerformPad.js'

describe('the rack performance pad', () => {
  it('keeps two faces mounted and turns between them while remaining the performance filter', () => {
    const props = {
      kaoss: null,
      scene: 'sunset',
      setScene: () => {},
      analyser: null,
      running: false,
      bpm: 120,
    }
    const front = renderToStaticMarkup(createElement(PerformPad, { ...props, flipped: false }))
    const back = renderToStaticMarkup(createElement(PerformPad, { ...props, flipped: true }))

    expect(front).toContain('data-side="front"')
    expect(front).toContain('rk-pad-face-front')
    expect(front).toContain('rk-pad-face-back')
    expect(front).toContain('backstage creature')
    expect(front).toContain('rk-pad-visualiser')
    expect(front).toContain('Scene: Sunset. Change scene.')
    expect(back).toContain('data-side="back"')
    expect(back).toContain('rk-pad-face-front')
    expect(back).toContain('rk-pad-face-back')
    expect(back).toContain('backstage creature')
    expect(back).toContain('Performance filter, back side')
  })
})
