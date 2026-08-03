import { MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChordPlayer } from './ChordPlayer.js'
import { chordPreview } from './chord-player-display.js'

describe('the Chord Player faceplate', () => {
  it('draws all eight possible voices and explains the active voicing', () => {
    const def = MODULES['chord-player']
    const values: Record<string, number> = {
      key: 0,
      scale: 0,
      notes: 5,
      inversion: 0,
      open: 1,
      octUp: 1,
      octDown: 1,
      color: 1,
      alter: 0,
    }
    const markup = renderToStaticMarkup(createElement(ChordPlayer, {
      def,
      module: { id: 'chord', type: 'chord-player' },
      value: (id: string) => values[id] ?? 0,
      onChange: () => {},
    }))

    expect(markup).toContain('Chord Loom')
    expect(markup).toContain('C Major · 8 voices')
    expect(markup.match(/data-active="yes"/g)).toHaveLength(8)
    expect(markup).toContain('Hold to alter chord')
  })

  it('mirrors inversion, open voicing, additions and Alter', () => {
    expect(chordPreview({
      key: 0, scale: 0, notes: 4, inversion: 3, open: false,
      octUp: false, octDown: false, color: false, alter: false,
    })).toEqual([-1, 0, 4, 7])
    expect(chordPreview({
      key: 0, scale: 0, notes: 3, inversion: 0, open: true,
      octUp: true, octDown: true, color: true, alter: true,
    })).toEqual([-12, 0, 7, 12, 14, 15])
  })

  it('uses the same safe Custom-scale fallback as the processor', () => {
    expect(chordPreview({
      key: 0, scale: 13, custom: Array(12).fill(0), notes: 3, inversion: 0, open: false,
      octUp: false, octDown: false, color: false, alter: false,
    })).toEqual([0, 4, 7])
  })
})
