import { defaultKit, emptyPattern, type Pattern, type Song, type StepValue } from '@driftbox/engine'
import { describe, expect, it, vi } from 'vitest'
import {
  PROBLEMS,
  StemCache,
  stemFileName,
  stemName,
  stemPreviewStart,
  stemRow,
  trayStatus,
  type StemRowInput,
} from './stem-review.js'

// Every claim here sat behind an `OfflineAudioContext` render, so checking any of it by hand meant waiting
// several seconds per stem and then listening. The in-flight half of the cache is the one that mattered
// most: two clicks during one render would otherwise start a second render of the same audio and race the
// first to the cache.

const lane = (...steps: StepValue[]): StepValue[] =>
  Array.from({ length: 16 }, (_, index) => steps[index] ?? 0)

const song = (tracks: Pattern['tracks'], bars = 2): Song => ({
  bpm: 120,
  swing: 0.5,
  patterns: [{ ...emptyPattern('a', 'A'), tracks }],
  chain: [{ pattern: 'a', repeat: bars }],
  kit: defaultKit(Object.keys(tracks)),
})

describe('naming a stem', () => {
  it('uses the name on the machine', () => {
    expect(stemName('808.bd')).toBe('Bass Drum')
    expect(stemName('909.cp')).toBe('Clap')
  })

  it('names the 303s, which are not in the drum kit', () => {
    expect(stemName('303.a')).not.toBe('303.a')
  })

  it('falls back to the id for something it does not know', () => {
    // A song from a future engine can carry a voice this build has never heard of; a row labelled with
    // the raw id is still a row you can preview.
    expect(stemName('future.voice')).toBe('future.voice')
  })
})

describe('where a preview starts', () => {
  it('leaves a quarter-second of lead-in before the first hit', () => {
    // 120bpm over 16 steps is 0.125s a step, so a hit on step five lands half a second in.
    const hits = song({ '808.sd': lane(0, 0, 0, 0, 1) })
    expect(stemPreviewStart(hits, '808.sd')).toBeCloseTo(0.25, 5)
  })

  it('finds a voice that does not come in until later', () => {
    // Four seconds from bar one is silence for most of a kit; without this the desk looks broken.
    const late = stemPreviewStart(song({ '808.cp': lane(0, 0, 0, 0, 0, 0, 0, 0, 1) }), '808.cp')
    expect(late).toBeCloseTo(0.75, 5)
  })

  it('clamps rather than starting before the top of the song', () => {
    // A voice on the downbeat has no room for a lead-in, and a negative start is not a time.
    expect(stemPreviewStart(song({ '808.bd': lane(1) }), '808.bd')).toBe(0)
  })

  it('previews from the top for a voice that never plays', () => {
    expect(stemPreviewStart(song({ '808.bd': lane(1) }), '909.rim')).toBe(0)
  })
})

describe('naming the file', () => {
  it('numbers stems so a folder of them sorts into playing order', () => {
    expect(stemFileName('Bass Drum', 0, 'My Song')).toBe('my-song-1-bass-drum.wav')
    expect(stemFileName('Bass Drum', 9, 'My Song')).toBe('my-song-10-bass-drum.wav')
  })

  it('flattens anything an operating system might object to', () => {
    expect(stemFileName('Hi/Tom "2"', 0, 'a/b')).toBe('a-b-1-hi-tom-2-.wav')
  })

  it('falls back rather than producing a name that starts with a hyphen', () => {
    // An unsaved song has no document name, which is the ordinary case rather than the exceptional one.
    expect(stemFileName('Snare', 0, '')).toBe('driftbox-1-snare.wav')
    expect(stemFileName('Snare', 0, '   ')).toBe('driftbox-1-snare.wav')
    expect(stemFileName('Snare', 0)).toBe('driftbox-1-snare.wav')
  })

  it('trims the hyphens a stripped prefix leaves at either end', () => {
    expect(stemFileName('Snare', 0, '  My Song  ')).toBe('my-song-1-snare.wav')
  })
})

describe('a row of the desk', () => {
  const row = (over: Partial<StemRowInput> = {}) =>
    stemRow({
      id: '808.bd',
      ready: false,
      playing: false,
      rendering: false,
      busy: false,
      ...over,
    })

  it('starts as something nobody has rendered yet', () => {
    const idle = row()
    expect(idle.state).toBe('idle')
    expect(idle.status).toBe('not rendered')
    expect(idle.glyph).toBe('▶')
    expect(idle.detail).toBe('808.bd')
  })

  it('reports the length once there is a buffer to report it from', () => {
    const ready = row({ duration: 4.25 })
    expect(ready.state).toBe('ready')
    expect(ready.status).toBe('ready')
    expect(ready.detail).toBe('808.bd · 4.3s')
  })

  it('says "ready" without a length when the audio is no longer to hand', () => {
    expect(row({ ready: true }).detail).toBe('808.bd · ready')
  })

  it('offers to stop what it is playing', () => {
    const sounding = row({ playing: true, duration: 4 })
    expect(sounding.state).toBe('playing')
    expect(sounding.glyph).toBe('■')
    expect(sounding.sounding).toBe(true)
  })

  it('puts the spinner ahead of everything, because it explains the wait', () => {
    const working = row({ rendering: true, playing: true, duration: 4 })
    expect(working.state).toBe('rendering')
    expect(working.status).toBe('rendering')
    expect(working.glyph).toBe('…')
  })

  it('keeps offering to stop a stem that is sounding while something else renders', () => {
    // A save started mid-preview leaves the row reading "rendering" — and the button somebody would
    // press to silence it still has to be the stop button, and still has to work.
    const working = row({ rendering: true, playing: true, busy: true })
    expect(working.sounding).toBe(true)
    expect(working.glyph).toBe('…')
    expect(working.playDisabled).toBe(false)
  })

  it('locks every other row while one is busy', () => {
    // Two offline renders at once is not wrong, but it is slower than either alone and it makes the
    // first one look stuck.
    const other = row({ busy: true })
    expect(other.playDisabled).toBe(true)
    expect(other.saveDisabled).toBe(true)
  })

  it('locks the save button even on the row that is sounding', () => {
    expect(row({ playing: true, busy: true }).saveDisabled).toBe(true)
  })
})

describe('the line along the bottom', () => {
  it('says what is here when nothing is happening', () => {
    expect(trayStatus(null, null, '12 stems in this song')).toBe('12 stems in this song')
  })

  it('names what it is rendering', () => {
    expect(trayStatus(null, 'Bass Drum', '12 stems')).toBe('Rendering Bass Drum…')
  })

  it('puts a problem ahead of progress', () => {
    // An error that scrolls past underneath "Rendering…" is an error nobody saw.
    expect(trayStatus(PROBLEMS.render('Snare'), 'Bass Drum', '12 stems')).toBe(
      'Could not render Snare.',
    )
  })
})

describe('the stem cache', () => {
  /** A render that finishes only when told to, so two callers can be caught mid-flight. */
  function deferred() {
    const calls: string[] = []
    let release: ((value: string | null) => void) | null = null
    const render = vi.fn((id: string) => {
      calls.push(id)
      return new Promise<string | null>((resolve) => {
        release = resolve
      })
    })
    return { calls, render, finish: (value: string | null) => release?.(value) }
  }

  it('renders once and keeps the result', async () => {
    const render = vi.fn(async (id: string) => `audio:${id}`)
    const cache = new StemCache(render)

    expect(await cache.ensure('808.bd')).toBe('audio:808.bd')
    expect(await cache.ensure('808.bd')).toBe('audio:808.bd')
    expect(render).toHaveBeenCalledOnce()
    expect(cache.cached('808.bd')).toBe('audio:808.bd')
  })

  it('hands a second caller the render already running rather than starting another', async () => {
    // The claim this module exists for. Each of these takes seconds; two of them race to the cache.
    const { render, finish, calls } = deferred()
    const cache = new StemCache(render)

    const first = cache.ensure('808.bd')
    const second = cache.ensure('808.bd')
    expect(cache.pending('808.bd')).toBe(true)
    finish('audio')

    expect(await first).toBe('audio')
    expect(await second).toBe('audio')
    expect(calls).toEqual(['808.bd'])
  })

  it('renders different stems independently', async () => {
    const render = vi.fn(async (id: string) => `audio:${id}`)
    const cache = new StemCache(render)

    await Promise.all([cache.ensure('808.bd'), cache.ensure('808.sd')])
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('reports each stem ready exactly once, and never for a cache hit', async () => {
    const ready: string[] = []
    const cache = new StemCache(async (id: string) => `audio:${id}`)

    await cache.ensure('808.bd', (id) => ready.push(id))
    await cache.ensure('808.bd', (id) => ready.push(id))
    expect(ready).toEqual(['808.bd'])
  })

  it('does not keep a render that produced nothing, so it can be asked for again', async () => {
    let attempt = 0
    const cache = new StemCache(async (id: string) => (attempt++ === 0 ? null : `audio:${id}`))

    expect(await cache.ensure('808.bd')).toBeNull()
    expect(cache.cached('808.bd')).toBeUndefined()
    expect(await cache.ensure('808.bd')).toBe('audio:808.bd')
  })

  it('stops being in flight whether the render worked or not', async () => {
    const cache = new StemCache(async () => null)
    await cache.ensure('808.bd')
    expect(cache.pending('808.bd')).toBe(false)

    const failing = new StemCache(async () => {
      throw new Error('offline render failed')
    })
    await expect(failing.ensure('808.bd')).rejects.toThrow('offline render failed')
    // Otherwise a single failure would make that stem permanently unrenderable for this tray.
    expect(failing.pending('808.bd')).toBe(false)
  })
})
