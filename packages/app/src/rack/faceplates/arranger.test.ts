import { ARRANGER_SECTIONS, MODULES } from '@driftbox/rack'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Arranger } from './Arranger.js'

// What the song panel has to get right, checked by rendering it.
//
// The module's own tests cover the counting; these cover the claim the panel makes, which is that you can
// *see* the song — every section at once, the ones past the end still there, and the length in bars.
//
// Rendered to static markup, which is why the panel takes its sections from the `module` prop rather than
// from the store: zustand answers a server render from the state the store was *created* with, so a
// component that subscribes renders an empty patch here no matter what the test sets. That is a property
// of the test environment rather than of the app — but reading the prop is also simply the better shape,
// since the Chassis looks the module up out of the live patch before passing it.
//
// The gestures themselves are pointer drags and belong to the browser tests.

const DEF = MODULES.arranger

/** Render the panel over one arranger holding `data`, and give back its markup. */
function render(data: Record<string, number[]>, length = 4) {
  return renderToStaticMarkup(
    createElement(Arranger, {
      def: DEF,
      module: { id: 'song-1', type: 'arranger', params: { length }, data },
      value: (id: string) =>
        id === 'length' ? length : (DEF.params.find((p) => p.id === id)?.default ?? 0),
      onChange: () => {},
    }),
  )
}

describe('the song panel', () => {
  it('shows every section the module can hold, not just the ones in use', () => {
    // Sixteen rows always. A song that grows when you turn the length knob would mean the empty rows are
    // somewhere you cannot aim at until after you have committed to needing them.
    const markup = render({ patterns: [0, 1], repeats: [4, 4] }, 2)
    const rows = markup.match(/rk-song-row/g) ?? []
    expect(rows).toHaveLength(ARRANGER_SECTIONS)
  })

  it('dims the sections past the end of the song rather than dropping them', () => {
    const markup = render({ patterns: [0, 1, 2, 3], repeats: [1, 1, 1, 1] }, 2)
    const past = markup.match(/rk-song-past/g) ?? []
    expect(past).toHaveLength(ARRANGER_SECTIONS - 2)
  })

  it('shows the pattern and the bar count each section actually holds', () => {
    // Read off the labels, which carry both numbers — so a screen reader and this test agree with what is
    // drawn, rather than the numbers being visual only.
    const markup = render({ patterns: [0, 5, 2], repeats: [8, 2, 1] }, 3)
    expect(markup).toContain('Section 2 pattern, 5')
    expect(markup).toContain('Section 2 bars, 2')
  })

  it('says how long the song is, counting only the sections it plays', () => {
    // Eight plus two, and not the four written into the section past the end.
    const markup = render({ patterns: [0, 1, 2], repeats: [8, 2, 4] }, 2)
    expect(markup).toContain('10 bars')
  })

  it('counts a section with no repeat written as the default rather than as nothing', () => {
    // The module treats a missing or zero repeat as one bar, but the panel shows four — so a song with
    // four sections and no data reads as sixteen bars and plays as four. Showing what it will play once
    // written beats showing a number nobody chose; what must not happen is showing zero.
    const markup = render({}, 4)
    expect(markup).toContain('16 bars')
  })

  it('draws a song with no data at all rather than throwing', () => {
    expect(() => render({})).not.toThrow()
  })

  it('survives a module carrying no data at all', () => {
    // Which is every arranger the moment it is added, and every one loaded from a patch saved before its
    // owner touched it.
    expect(() =>
      renderToStaticMarkup(
        createElement(Arranger, {
          def: DEF,
          module: { id: 'song-1', type: 'arranger' },
          value: (id: string) => DEF.params.find((p) => p.id === id)?.default ?? 0,
          onChange: () => {},
        }),
      ),
    ).not.toThrow()
  })
})
