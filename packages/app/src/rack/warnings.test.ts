import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RackWarnings } from './RackWarnings.js'
import { rackWarnings, type RackWarningState } from './warnings.js'

// Every one of these sentences exists because somebody was confused by silence, and every one of them was
// previously a conditional inside a two-thousand-line component where nothing could reach it. They are the
// app's only voice: if a warning appears when it should not, it is noise, and if it fails to appear the
// person is left with an instrument that looks broken.

const QUIET: RackWarningState = {
  started: true,
  playing: true,
  audioState: 'running',
  hasAudioInput: false,
  audioInputState: 'off',
  audioInputError: null,
  voices: 1,
  hasMidi: false,
  placeholders: 0,
  shared: false,
  loadedFiles: [],
}

const ids = (state: Partial<RackWarningState>) =>
  rackWarnings({ ...QUIET, ...state }).map((warning) => warning.id)

const text = (state: Partial<RackWarningState>, id: string) =>
  rackWarnings({ ...QUIET, ...state }).find((warning) => warning.id === id)?.text ?? ''

describe('a rack with nothing wrong with it', () => {
  it('says nothing at all', () => {
    expect(rackWarnings(QUIET)).toEqual([])
  })
})

describe('a suspended audio context', () => {
  it('is worth saying only once the transport claims to be running', () => {
    expect(ids({ audioState: 'suspended' })).toEqual(['audio-suspended'])
    expect(ids({ audioState: 'suspended', playing: false })).toEqual([])
    // Before the first Start gesture there is no context to have suspended, and "press Play again" would
    // be advice about a button that has not been pressed once.
    expect(ids({ audioState: 'suspended', started: false })).toEqual([])
  })
})

describe('the live input', () => {
  it('reports a failure only while the patch still asks for one', () => {
    const denied = { audioInputError: 'Audio-input permission was denied.' }
    expect(ids({ ...denied, hasAudioInput: true })).toEqual(['audio-input-error'])
    // Deleting the module releases the device; the sentence about it is then about nothing.
    expect(ids(denied)).toEqual([])
  })

  it('warns about feedback for as long as it is monitoring', () => {
    expect(ids({ hasAudioInput: true, audioInputState: 'on' })).toEqual(['audio-input-monitoring'])
    expect(text({ hasAudioInput: true, audioInputState: 'on' }, 'audio-input-monitoring')).toContain(
      'headphones',
    )
  })
})

describe('voices without a way to play different notes on them', () => {
  it('explains the level rather than leaving it looking like a bug', () => {
    expect(ids({ voices: 4 })).toEqual(['voices-without-midi'])
    expect(text({ voices: 4 }, 'voices-without-midi')).toContain('4× louder')
    // One voice cannot be a chord, and a MIDI module means the extra voices have notes of their own.
    expect(ids({ voices: 1 })).toEqual([])
    expect(ids({ voices: 4, hasMidi: true })).toEqual([])
  })
})

describe('modules this build does not have', () => {
  it('counts them, and says one as “1 module”', () => {
    expect(text({ placeholders: 1 }, 'placeholder-modules')).toBe(
      '1 module in this patch is not in this build. It is kept and will be saved, but it makes no sound.',
    )
    expect(text({ placeholders: 3 }, 'placeholder-modules')).toContain('3 modules')
  })
})

describe('a link that cannot carry what is loaded', () => {
  it('names the one file, and counts several', () => {
    const one = { shared: true, loadedFiles: ['amen.wav'] }
    expect(ids(one)).toEqual(['unshareable-samples'])
    expect(text(one, 'unshareable-samples')).toContain('“amen.wav”')
    expect(text(one, 'unshareable-samples')).toContain('audio device empty')

    const several = { shared: true, loadedFiles: ['amen.wav', 'think.wav'] }
    expect(text(several, 'unshareable-samples')).toContain('2 loaded audio files')
    expect(text(several, 'unshareable-samples')).toContain('audio devices empty')
  })

  it('says nothing until a link has actually been made', () => {
    expect(ids({ loadedFiles: ['amen.wav'] })).toEqual([])
    // A shipped break travels as its id and is rendered again at the other end, so it never breaks a link.
    expect(ids({ shared: true })).toEqual([])
  })
})

describe('the order they are read in', () => {
  it('puts what just happened above the standing facts about the patch', () => {
    expect(
      ids({
        shared: true,
        loadedFiles: ['amen.wav'],
        audioState: 'suspended',
        hasAudioInput: true,
        audioInputState: 'on',
        audioInputError: 'That audio input is no longer available.',
        voices: 2,
        placeholders: 1,
      }),
    ).toEqual([
      'unshareable-samples',
      'audio-suspended',
      'audio-input-error',
      'audio-input-monitoring',
      'voices-without-midi',
      'placeholder-modules',
    ])
  })
})

describe('the stack as rendered', () => {
  it('puts the link above the warning about the link', () => {
    const html = renderToStaticMarkup(
      createElement(RackWarnings, {
        shared: 'https://driftbox.example/#p=abc',
        warnings: rackWarnings({ ...QUIET, shared: true, loadedFiles: ['amen.wav'] }),
      }),
    )
    expect(html).toContain('<p class="rk-shared">https://driftbox.example/#p=abc</p>')
    expect(html.indexOf('rk-shared')).toBeLessThan(html.indexOf('rk-warn'))
    expect(html).toContain('amen.wav')
  })

  it('renders nothing for a page with nothing to say', () => {
    expect(
      renderToStaticMarkup(createElement(RackWarnings, { shared: null, warnings: [] })),
    ).toBe('')
  })
})
