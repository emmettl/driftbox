import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScalePlayer } from './ScalePlayer.js'
import { scalePlayerMask } from './scale-player-display.js'

describe('the Scale Player faceplate', () => {
  it('draws the selected preset relative to its key', () => {
    const def = MODULES['scale-player']
    const markup = renderToStaticMarkup(
      createElement(ScalePlayer, {
        def,
        module: { id: 'scale', type: 'scale-player' },
        value: (id: string) => ({ key: 2, scale: 5, filter: 0 }[id] ?? 0),
        onChange: () => {},
      }),
    )

    expect(markup).toContain('Scale Map')
    expect(markup).toContain('D Dorian · correct')
    expect(markup).toContain('D included in D Dorian')
    expect(markup).toContain('D# excluded from D Dorian')
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(7)
    expect(markup).toContain('click a key to customise')
  })

  it('shows portable Custom data and safely fills a missing mask', () => {
    const augmented = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    expect(scalePlayerMask(13, augmented)).toEqual(augmented)
    expect(scalePlayerMask(13)).toEqual(scalePlayerMask(0))
  })

  it('shows every scale preset with the expected number of notes', () => {
    expect(Array.from({ length: 13 }, (_, scale) => scalePlayerMask(scale).reduce((a, b) => a + b, 0)))
      .toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 12])
  })
})
