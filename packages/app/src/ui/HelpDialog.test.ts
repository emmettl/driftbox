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
    ['silence', 'Check these four, in this order', 'Silent for a reason'],
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

describe('HelpDialog guided tours', () => {
  const TOURS = [
    { id: 'first-sound', name: 'A sound of your own', blurb: 'Add an instrument and play it.', minutes: 3, steps: 5, done: false },
    { id: 'macros', name: 'Four knobs', blurb: 'The Combinator, and why.', minutes: 4, steps: 4, done: true },
  ]

  it('offers no tours tab to a host with none', () => {
    // The guide is shared with the sequencer, which has no tours. A dead tab there would be worse than
    // no tab: it is the one place somebody looks after reading "start here".
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'groovebox', onClose: vi.fn() }),
    )
    expect(markup).not.toContain('Guided tours')
  })

  it('puts the tab straight after Start here, where somebody who read it will look', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, { surface: 'rack', onClose: vi.fn(), tutorials: TOURS }),
    )
    expect(markup.indexOf('Guided tours')).toBeGreaterThan(markup.indexOf('Start here'))
    expect(markup.indexOf('Guided tours')).toBeLessThan(markup.indexOf('Patching'))
  })

  it('lists every tour, marks the finished ones, and counts what is left', () => {
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, {
        surface: 'rack',
        onClose: vi.fn(),
        initialTopic: 'tours',
        tutorials: TOURS,
      }),
    )

    expect(markup).toContain('A sound of your own')
    expect(markup).toContain('Four knobs')
    expect(markup).toContain('5 steps')
    expect(markup).toContain('1 of 2 not done yet')
    // A finished tour stays on the shelf and offers itself again, rather than disappearing as you learn.
    expect(markup).toContain('again →')
    expect(markup).toContain('start →')
  })

  it('says plainly that a tour does not touch the rack', () => {
    // The promise the whole design rests on. If the copy ever stops saying it, the panel is just a
    // wizard that has not got round to pressing anything yet.
    const markup = renderToStaticMarkup(
      createElement(HelpDialog, {
        surface: 'rack',
        onClose: vi.fn(),
        initialTopic: 'tours',
        tutorials: TOURS,
      }),
    )
    expect(markup).toContain('nothing is pressed, patched or turned on your behalf')
  })
})
