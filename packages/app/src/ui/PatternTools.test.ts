import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSong } from '@driftbox/engine'
import { useBox } from '../store'
import { PatternTools } from './PatternTools'

beforeEach(() => {
  const song = defaultSong()
  useBox.setState({
    song,
    editing: song.patterns[0].id,
    view: 'tr808',
    selectedVoice: '808.bd',
    selectedBass: '303.a',
    patternClipboard: null,
    flamMode: false,
  })
})

describe('the focused pattern clipboard', () => {
  it('puts cut, copy and a gated paste beside the existing focus controls', () => {
    const markup = renderToStaticMarkup(createElement(PatternTools))

    expect(markup).toContain('aria-label="Focused pattern clipboard"')
    expect(markup).toContain('aria-label="Cut Bass Drum"')
    expect(markup).toContain('aria-label="Copy Bass Drum"')
    expect(markup).toContain('aria-label="Paste into Bass Drum"')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Paste into Bass Drum"/)
  })
})
