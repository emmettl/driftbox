import { beforeEach, describe, expect, it } from 'vitest'
import { useBox } from './store'
import { SONGS, defaultSong, songBars } from '@driftbox/engine'
import { SCENES } from './visual/scenes'

// The store is where a whole song gets rebuilt on every keystroke, and immutable updates
// have one classic failure: a spread that reconstructs a nested object from one of its
// fields and quietly drops the rest. That is not a hypothetical here — `setParam` did
// exactly that, and turning a single drum knob wiped every 303 setting and every send
// level in the song. It read as correct, and it was correct until the `Kit` grew.
//
// So these are mostly preservation tests. They are dull to read and they are the reason
// that class of bug cannot come back.

beforeEach(() => {
  useBox.setState({ song: defaultSong(), engine: null, editing: 'drift' })
})

const song = () => useBox.getState().song

describe('editing one thing does not disturb the others', () => {
  it('a drum knob leaves the 303 settings, sends and swing alone', () => {
    useBox.setState({
      song: {
        ...song(),
        kit: { ...song().kit, swing: { '808.ch': 0.7 } },
      },
    })
    const before = song().kit

    useBox.getState().setParam('808.bd', 'decay', 0.9)

    const after = song().kit
    expect(after.params['808.bd'].decay).toBe(0.9)
    expect(after.bass).toEqual(before.bass)
    expect(after.sends).toEqual(before.sends)
    expect(after.swing).toEqual(before.swing)
  })

  it('a 303 knob leaves the drum settings and sends alone', () => {
    const before = song().kit
    useBox.getState().setBassParam('303.a', 'cutoff', 0.8)

    expect(song().kit.bass!['303.a'].cutoff).toBe(0.8)
    expect(song().kit.params).toEqual(before.params)
    expect(song().kit.sends).toEqual(before.sends)
  })

  it('a send leaves everything else alone', () => {
    const before = song().kit
    useBox.getState().setSend('808.bd', 'reverb', 0.5)

    expect(song().kit.sends!['808.bd'].reverb).toBe(0.5)
    expect(song().kit.params).toEqual(before.params)
    expect(song().kit.bass).toEqual(before.bass)
  })

  it('a per-voice swing leaves everything else alone', () => {
    const before = song().kit
    useBox.getState().setVoiceSwing('808.ch', 0.8)

    expect(song().kit.swing!['808.ch']).toBe(0.8)
    expect(song().kit.params).toEqual(before.params)
    expect(song().kit.bass).toEqual(before.bass)
    expect(song().kit.sends).toEqual(before.sends)
  })

  it('editing a step leaves the other patterns alone', () => {
    const before = song().patterns.find((p) => p.id === 'neon')
    useBox.getState().toggleStep('808.bd', 3)
    expect(song().patterns.find((p) => p.id === 'neon')).toEqual(before)
  })
})

describe('the arrangement', () => {
  it('appends, and the song gets a bar longer', () => {
    const before = songBars(song())
    useBox.getState().appendChain('haze')
    expect(songBars(song())).toBe(before + 1)
  })

  it('holds a section for as many bars as it is told', () => {
    useBox.getState().setChainRepeat(0, 8)
    expect(song().chain[0].repeat).toBe(8)
  })

  it('removes by position', () => {
    const before = song().chain.length
    useBox.getState().removeChain(0)
    expect(song().chain).toHaveLength(before - 1)
  })

  it('reorders without losing anything', () => {
    const before = [...song().chain]
    useBox.getState().moveChain(0, 1)
    expect(song().chain).toHaveLength(before.length)
    expect(song().chain[0]).toEqual(before[1])
    expect(song().chain[1]).toEqual(before[0])
  })

  it('survives being emptied entirely', () => {
    // An empty arrangement is a normal state to pass through while rebuilding one, and
    // the app has to keep playing — `patternForBar` falls back to the first pattern.
    while (song().chain.length > 0) useBox.getState().removeChain(0)
    expect(song().chain).toEqual([])
    expect(songBars(song())).toBe(0)
  })
})

describe('pattern length', () => {
  it('keeps the steps that fit and pads the rest', () => {
    useBox.getState().setPatternLength(8)
    const pattern = song().patterns.find((p) => p.id === 'drift')!
    expect(pattern.length).toBe(8)
    for (const track of Object.values(pattern.tracks)) expect(track).toHaveLength(8)
    for (const line of Object.values(pattern.bass ?? {})) expect(line).toHaveLength(8)
  })

  it('pads with rests when it grows', () => {
    useBox.getState().setPatternLength(24)
    const pattern = song().patterns.find((p) => p.id === 'drift')!
    expect(pattern.tracks['808.bd']).toHaveLength(24)
    expect(pattern.tracks['808.bd'][23]).toBe(0)
    expect(pattern.bass!['303.a'][23]).toEqual({ note: null, accent: false, slide: false })
  })

  it('keeps the head of a pattern when shrunk', () => {
    const before = song().patterns.find((p) => p.id === 'drift')!.tracks['808.bd'].slice(0, 4)
    useBox.getState().setPatternLength(4)
    expect(song().patterns.find((p) => p.id === 'drift')!.tracks['808.bd']).toEqual(before)
  })

  it('refuses a length that would break the sequencer', () => {
    useBox.getState().setPatternLength(0)
    expect(song().patterns.find((p) => p.id === 'drift')!.length).toBe(1)
    useBox.getState().setPatternLength(9999)
    expect(song().patterns.find((p) => p.id === 'drift')!.length).toBe(64)
  })

  it('only touches the pattern being edited', () => {
    const before = song().patterns.find((p) => p.id === 'neon')!
    useBox.getState().setPatternLength(8)
    expect(song().patterns.find((p) => p.id === 'neon')).toEqual(before)
  })
})

describe('the visual a song asks for', () => {
  // `visual` is a plain string on the engine side, and the engine cannot check it: the
  // scene registry lives here, in the app. So a typo — or a scene renamed without its
  // songs being updated — is invisible to both packages on their own, and shows up only
  // as a song silently opening on whatever scene happened to be showing. This is the one
  // place both halves are in scope at once, so it is the only place it can be caught.
  it('names a scene that exists, for every song that names one', () => {
    const ids = new Set(SCENES.map((s) => s.id))
    for (const preset of SONGS) {
      if (preset.visual === undefined) continue
      expect(ids, `${preset.id} asks for "${preset.visual}"`).toContain(preset.visual)
    }
  })

  it('switches the scene when the song is switched', () => {
    const withVisual = SONGS.find((s) => s.visual !== undefined)!
    useBox.getState().loadPreset(withVisual.id)
    expect(useBox.getState().scene).toBe(withVisual.visual)
  })
})
