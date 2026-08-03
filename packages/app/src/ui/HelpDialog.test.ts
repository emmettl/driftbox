import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HelpDialog } from './HelpDialog'

describe('HelpDialog', () => {
  it('explains the groovebox controls and hidden shortcuts', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'groovebox', onClose: vi.fn() }),
    )

    expect(markup).toContain('Groovebox guide')
    expect(markup).toContain('Make a beat')
    expect(markup).toContain('303 notes')
    expect(markup).toContain('Open this guide')
    expect(markup).toContain('aria-modal="true"')
  })

  it('explains patching, views, and rack shortcuts', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'rack', onClose: vi.fn() }),
    )

    expect(markup).toContain('Rack guide')
    expect(markup).toContain('Patch something')
    expect(markup).toContain('Drag from one jack to another')
    expect(markup).toContain('Sequencer →')
    expect(markup).toContain('Turn the rack around')
  })
})
