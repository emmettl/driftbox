import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HelpDialog } from './HelpDialog'

describe('HelpDialog', () => {
  it('offers layered groovebox topics from a concise starting point', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'groovebox', onClose: vi.fn() }),
    )

    expect(markup).toContain('Groovebox guide')
    expect(markup).toContain('The mental model')
    expect(markup).toContain('Make a beat')
    expect(markup).toContain('Patterns')
    expect(markup).toContain('Song &amp; automation')
    expect(markup).toContain('Sound, MIDI &amp; files')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-modal="true"')
  })

  it.each([
    ['patterns', 'Lane length', 'PCF row'],
    ['song', 'What a song section contains', 'Automation'],
    ['sound', 'Master FX', 'Mix / stems'],
    ['keys', 'Global shortcuts', '303 step entry'],
  ])('explains the groovebox %s topic', (topic, first, second) => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, {
        surface: 'groovebox',
        onClose: vi.fn(),
        initialTopic: topic,
      }),
    )

    expect(markup).toContain(first)
    expect(markup).toContain(second)
  })

  it('offers layered rack topics from the signal-flow mental model', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'rack', onClose: vi.fn() }),
    )

    expect(markup).toContain('Rack guide')
    expect(markup).toContain('The mental model')
    expect(markup).toContain('Patch something')
    expect(markup).toContain('Patching &amp; devices')
    expect(markup).toContain('Module map')
    expect(markup).toContain('Play &amp; automate')
  })

  it.each([
    ['patching', 'Cable rules', 'Device patches and parameters'],
    ['modules', 'Sources', 'Control and modulation'],
    ['performance', 'Rack automation', 'Embedded Groovebox'],
    ['files', 'Share and render', 'Patch keyboard controls'],
  ])('explains the rack %s topic', (topic, first, second) => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, {
        surface: 'rack',
        onClose: vi.fn(),
        initialTopic: topic,
      }),
    )

    expect(markup).toContain(first)
    expect(markup).toContain(second)
  })
})
