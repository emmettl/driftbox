import { MODULES } from '@driftbox/rack'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Palette } from './Palette.js'
import { RackHeader } from './RackHeader.js'
import { spotlightRef } from './spotlight.js'
import { useRack } from './store.js'
import { TUTORIALS } from './tutorials.js'

// Two things, and the second is the one worth having.
//
// The resolver itself is small enough to read, but it is a getter over a live document and the whole point
// of it is *when* it answers, which is not checkable without one.
//
// And then the anti-rot test. A tour aims by selector, so an attribute renamed in a component leaves the
// tour pointing at nothing — no error, no warning, just a step with no arrow on it and nobody any the
// wiser. `isAimable` keeps the tours to four attributes; this checks those attributes are really there.

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  host.remove()
})

describe('resolving a spotlight', () => {
  it('answers with the first selector present, not the first written', () => {
    host.innerHTML = '<button data-beacon="add">Add</button>'
    const ref = spotlightRef(['.rk-card[data-module="voice"]', '[data-beacon="add"]'])
    expect(ref.current?.textContent).toBe('Add')

    // The card appears when the picker opens, and the aim moves to it without anything being told.
    host.insertAdjacentHTML('beforeend', '<button class="rk-card" data-module="voice">Voice</button>')
    expect(ref.current?.textContent).toBe('Voice')
  })

  it('lets go of a target that has gone', () => {
    host.innerHTML = '<button data-beacon="rec">Rec</button>'
    const ref = spotlightRef(['[data-beacon="rec"]'])
    expect(ref.current).toBeTruthy()
    host.innerHTML = ''
    expect(ref.current).toBeNull()
  })

  it('shrugs off a selector that is not one', () => {
    // These are hand-written strings in a data file, and this getter is read inside a requestAnimationFrame
    // callback — where a throw takes the whole beacon down and reads as the rack having broken.
    host.innerHTML = '<button data-beacon="add">Add</button>'
    const ref = spotlightRef(['[[[nonsense', '[data-beacon="add"]'])
    expect(ref.current?.textContent).toBe('Add')
    expect(spotlightRef(['[[[nonsense']).current).toBeNull()
  })

  it('answers with nothing rather than throwing when it has nothing to answer with', () => {
    expect(spotlightRef([]).current).toBeNull()
  })
})

describe('what the tours aim at', () => {
  /** Every selector any tour uses, once. */
  const aimed = [...new Set(TUTORIALS.flatMap((t) => t.steps.flatMap((s) => s.spotlight ?? [])))]

  it('finds every header control a tour points at', () => {
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(RackHeader, {
          loadedBreakName: null,
          started: true,
          failed: false,
          onStart: () => {},
          automationOpen: false,
          onOpenAutomation: () => {},
          adding: false,
          onToggleAdd: () => {},
          browsing: false,
          onToggleBrowse: () => {},
          rackView: 'rack' as const,
          performing: false,
          onCycleView: () => {},
          midiState: 'off' as const,
          onToggleMidi: () => {},
          hasAudioInput: false,
          audioInputState: 'off' as const,
          audioInputs: [],
          selectedAudioInput: '',
          onSelectAudioInput: () => {},
          onCloseAudioInput: () => {},
          exporting: null,
          patchStemCount: 1,
          hasRetainedSong: false,
          onCopyLink: () => {},
          onExportPatch: () => {},
          onReviewPatchStems: () => {},
          onExportSong: () => {},
          onReviewSongStems: () => {},
          tempo: 120,
          onHelp: () => {},
          sequencerBlocked: false,
          onSequencer: () => {},
        }),
      ),
    )

    const wanted = aimed.filter((selector) => selector.startsWith('[data-beacon'))
    expect(wanted.length).toBeGreaterThan(0)
    for (const selector of wanted) {
      expect(host.querySelector(selector), selector).toBeTruthy()
    }
    act(() => root.unmount())
  })

  it('finds every picker card a tour points at', () => {
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(Palette, { onModule: () => {}, onChunk: () => {}, onClose: () => {} }),
      ),
    )

    const wanted = aimed.filter((selector) => selector.startsWith('.rk-card'))
    expect(wanted.length).toBeGreaterThan(0)
    for (const selector of wanted) {
      expect(host.querySelector(selector), selector).toBeTruthy()
    }
    act(() => root.unmount())
  })

  it('names only module types this build actually has', () => {
    // The front and back panels carry `data-module-type`, so a selector for one is only ever as good as
    // the type in it. A tour aiming at a module that has been renamed points at nothing for ever.
    for (const selector of aimed) {
      const type = /\[data-module-type="([a-z0-9-]+)"\]/.exec(selector)?.[1]
      if (!type) continue
      expect(MODULES[type], selector).toBeDefined()
    }
  })

  it('aims at a module the tour has just had you add', () => {
    // The other half of the same claim, from the store's side: `[data-module-type="ladder"]` only ever
    // resolves because adding a Ladder puts one on the rack under that attribute.
    useRack.getState().load({ modules: [], cables: [] })
    act(() => useRack.getState().addModule('ladder'))
    expect(useRack.getState().patch.modules.some((m) => m.type === 'ladder')).toBe(true)
  })
})
