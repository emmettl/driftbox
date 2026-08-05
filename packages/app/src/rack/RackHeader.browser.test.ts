import type { Patch } from '@driftbox/rack'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RackHeader } from './RackHeader.js'
import { useRack } from './store.js'

// The header had no test at all, which is most of how it got to twenty-one controls in a row. Two of the
// three claims it now makes are structural rather than visual, so they can be held here: every action is
// still reachable, and nothing moves under the pointer as the session changes state.
//
// The position assertions are the point. "Start audio becomes Play in the same place" and "Rec does not
// appear out of nowhere and shove the row along" are exactly the kind of thing that is obvious on the day
// and silently undone six months later by adding one conditional button.

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PATCH: Patch = {
  modules: [
    { id: 'v', type: 'voice' },
    { id: 'speaker', type: 'out' },
  ],
  cables: [{ from: ['v', 'out'], to: ['speaker', 'in'] }],
}

type Props = Parameters<typeof RackHeader>[0]

const BASE: Props = {
  loadedBreakName: null,
  started: false,
  failed: false,
  onStart: () => {},
  automationOpen: false,
  onOpenAutomation: () => {},
  adding: false,
  onToggleAdd: () => {},
  browsing: false,
  onToggleBrowse: () => {},
  rackView: 'rack',
  performing: false,
  onCycleView: () => {},
  midiState: 'off',
  onToggleMidi: () => {},
  hasAudioInput: true,
  audioInputState: 'off',
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
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function show(over: Partial<Props> = {}) {
  act(() => root.render(createElement(RackHeader, { ...BASE, ...over })))
}

/** Every control in the header, in document order — which is the order a hand and a Tab both travel it. */
const controls = () =>
  [...host.querySelectorAll<HTMLElement>('button, a, select, input')].map(
    (node) => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? node.tagName,
  )

const groups = () =>
  [...host.querySelectorAll('.rk-group')].map((group) => group.getAttribute('aria-label'))

function find(label: string) {
  const node = [...host.querySelectorAll<HTMLElement>('button, a')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent?.trim().startsWith(label),
  )
  expect(node, label).toBeTruthy()
  return node!
}

const press = (label: string) =>
  act(() => find(label).dispatchEvent(new MouseEvent('click', { bubbles: true })))

beforeEach(() => {
  useRack.getState().load(structuredClone(PATCH))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the header as a shape', () => {
  it('sorts every control into a named group', () => {
    show()
    expect(groups()).toEqual([
      'Transport',
      'Build',
      'View',
      'Rack setup',
      'Share and render',
      'Guide and sequencer',
    ])
    // Nothing loose between the groups: a control outside one is a control with no stated kind, which is
    // the state the whole row used to be in.
    for (const node of host.querySelectorAll('button, a, select, input')) {
      expect(node.closest('.rk-group'), node.textContent ?? '').toBeTruthy()
    }
  })

  it('holds a ceiling on how many controls the row can grow back to', () => {
    // The worst case the old header could reach was twenty-one: a guitar patch, a retained song, audio
    // started. It is seventeen now, which is a real reduction and not the main fix — the main fix is that
    // the seventeen are sorted into six named clusters instead of being one undifferentiated row.
    //
    // The number is asserted anyway, because this is exactly how it got to twenty-one: nobody ever adds
    // eleven buttons, they add one, eleven times.
    show({ started: true, hasRetainedSong: true, audioInputState: 'on' })
    const visible = host.querySelectorAll('.rk-group button, .rk-group a, .rk-group label')
    expect(visible.length).toBeLessThanOrEqual(17)
  })
})

describe('nothing moving under the pointer', () => {
  it('turns Start audio into Play in the same slot', () => {
    show()
    const before = controls()
    expect(before[0]).toBe('Start audio')

    show({ started: true })
    const after = controls()
    expect(after[0]).toBe('▶ Play')
    // Same slot, and every control after it unmoved — which is the whole claim.
    expect(after.slice(1)).toEqual(before.slice(1))
  })

  it('keeps Rec and BPM in place before audio rather than adding them later', () => {
    show()
    expect(find('● Rec').hasAttribute('disabled')).toBe(true)
    expect(find('● Rec').getAttribute('title')).toBe('Start audio first')
    // BPM is document state, not session state: a patch is 174 whether or not anything has been pressed.
    const bpm = host.querySelector<HTMLInputElement>('input[aria-label="Tempo"]')!
    expect(bpm.disabled).toBe(false)

    show({ started: true })
    expect(find('● Rec').hasAttribute('disabled')).toBe(false)
  })

  it('does not change the row when a retained song appears', () => {
    // Song WAV and Song stems used to arrive with the document and take the row's right-hand end with
    // them. They are inside the Export menu now, so the toolbar is the same shape either way.
    show({ started: true })
    const native = controls()
    show({ started: true, hasRetainedSong: true })
    expect(controls()).toEqual(native)
  })

  it('shows a render in progress on the button that is still visible', () => {
    show({ started: true, exporting: 'patch' })
    expect(controls()).toContain('Rendering patch… ▾')
  })
})

describe('the export menu', () => {
  it('starts shut, and offers the rack renders when opened', () => {
    show({ started: true })
    expect(find('Export').getAttribute('aria-expanded')).toBe('false')
    press('Export')
    expect(find('Export').getAttribute('aria-expanded')).toBe('true')
    expect(controls()).toContain('Copy link')
    expect(controls()).toContain('Patch WAV')
    expect(controls()).toContain('Patch stems (1)')
    // Nothing to render a song from, so it does not offer to.
    expect(controls()).not.toContain('Song WAV')
  })

  it('offers the song renders only when there is a song', () => {
    show({ started: true, hasRetainedSong: true })
    press('Export')
    expect(controls()).toContain('Song WAV')
    expect(controls()).toContain('Song stems')
  })

  it('runs the action and shuts behind it', () => {
    const onCopyLink = vi.fn()
    show({ started: true, onCopyLink })
    press('Export')
    press('Copy link')
    expect(onCopyLink).toHaveBeenCalledTimes(1)
    expect(find('Export').getAttribute('aria-expanded')).toBe('false')
  })

  it('stays open when a disabled action is pressed, because nothing happened', () => {
    show({ started: true, patchStemCount: 0 })
    press('Export')
    press('Patch stems')
    expect(find('Export').getAttribute('aria-expanded')).toBe('true')
  })

  it('shuts on Escape without letting the key reach the rack behind it', () => {
    // Escape in the rack cancels an armed cable. Shutting a menu must not also undo the patch somebody
    // was halfway through making.
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    show({ started: true })
    press('Export')
    // Dispatched at an element rather than at `window`: listeners on the event's own target fire in
    // registration order regardless of phase, so aiming at window would test the test rather than the
    // capture that stops the key.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    window.removeEventListener('keydown', behind)
    expect(find('Export').getAttribute('aria-expanded')).toBe('false')
    expect(behind).not.toHaveBeenCalled()
  })
})

describe('what the header says about the document', () => {
  it('counts the automation lanes it can open', () => {
    show({ started: true })
    expect(controls()).toContain('Automation')
    act(() => {
      useRack.getState().load({
        ...structuredClone(PATCH),
        automation: [{ target: ['v', 'cutoff'], points: [{ at: 0, value: 400 }] }],
      })
    })
    expect(controls()).toContain('Automation (1)')
  })

  it('replaces the transport with the reason there is not one', () => {
    show({ failed: true })
    expect(host.textContent).toContain('No AudioWorklet')
    expect(controls()).not.toContain('Start audio')
  })

  it('says a missing browser feature quietly rather than as a warning', () => {
    // Nobody can act on "this browser has no Web MIDI", so it is not an alarm.
    show({ midiState: 'unavailable' })
    expect(host.querySelector('.rk-quiet')?.textContent).toBe('No Web MIDI')
    expect(host.querySelector('.rk-warn')).toBeNull()
  })

  it('blocks the way back when the retained song is undecodable here', () => {
    show({ sequencerBlocked: true })
    expect(host.textContent).toContain('Sequencer unavailable')
    expect(host.querySelector('a.rk-away')).toBeNull()
  })
})
