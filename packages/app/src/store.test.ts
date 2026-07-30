import { beforeEach, describe, expect, it } from 'vitest'
import { useBox } from './store'
import { SONGS, defaultSong, songBars } from '@driftbox/engine'
import { SCENES } from './visual/scenes'
import { soundingPatternAt } from './ui/useLiveStep'

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

describe('focused pattern tools', () => {
  beforeEach(() => {
    useBox.setState({
      song: {
        ...song(),
        patterns: [
          {
            id: 'tools',
            name: 'Tools',
            length: 4,
            tracks: {
              '909.bd': [1, 0, 2, 0],
              '909.sd': [0, 1, 0, 0],
              '808.bd': [1, 0, 0, 0],
            },
            bass: {
              '303.a': [
                { note: 2, accent: true, slide: false },
                { note: null, accent: false, slide: false },
                { note: 12, accent: false, slide: true },
                { note: 24, accent: false, slide: false },
              ],
              '303.b': [
                { note: 7, accent: false, slide: false },
                { note: null, accent: false, slide: false },
                { note: null, accent: false, slide: false },
                { note: null, accent: false, slide: false },
              ],
            },
          },
        ],
        chain: [{ pattern: 'tools', repeat: 1 }],
      },
      editing: 'tools',
      view: 'tr909',
      selectedVoice: '909.bd',
      selectedBass: '303.a',
    })
  })

  it('paints an exact drum value instead of cycling through it', () => {
    useBox.getState().setDrumStep('909.bd', 1, 1)
    expect(song().patterns[0].tracks['909.bd']).toEqual([1, 1, 2, 0])
    useBox.getState().setDrumStep('909.bd', 2, 0)
    expect(song().patterns[0].tracks['909.bd']).toEqual([1, 1, 0, 0])
  })

  it('rotates only the focused lane by default', () => {
    useBox.getState().rotateSelection(1, false)
    expect(song().patterns[0].tracks['909.bd']).toEqual([0, 1, 0, 2])
    expect(song().patterns[0].tracks['909.sd']).toEqual([0, 1, 0, 0])
    expect(song().patterns[0].tracks['808.bd']).toEqual([1, 0, 0, 0])
  })

  it('rotates the visible machine without touching the other one', () => {
    useBox.getState().rotateSelection(-1, true)
    expect(song().patterns[0].tracks['909.bd']).toEqual([0, 2, 0, 1])
    expect(song().patterns[0].tracks['909.sd']).toEqual([1, 0, 0, 0])
    expect(song().patterns[0].tracks['808.bd']).toEqual([1, 0, 0, 0])
  })

  it('rotates and transposes the selected 303 independently', () => {
    useBox.setState({ view: 'bass' })
    useBox.getState().rotateSelection(1, false)
    useBox.getState().transposeSelectedBass(2)

    const pattern = song().patterns[0]
    expect(pattern.bass!['303.a'].map((step) => step.note)).toEqual([24, 4, null, 14])
    expect(pattern.bass!['303.a'][2].accent).toBe(false)
    expect(pattern.bass!['303.b'].map((step) => step.note)).toEqual([7, null, null, null])
  })
})

describe('the visual a song asks for', () => {
  // `visual` is a plain string on the engine side, and the engine cannot check it: the
  // scene registry lives here, in the app. So a typo — or a scene renamed without its
  // songs being updated — is invisible to both packages on their own, and shows up only
  // as a song silently opening on whatever scene happened to be showing. This is the one
  // place both halves are in scope at once, so it is the only place it can be caught.
  it('gives every set-list song its own scene', () => {
    const ids = new Set(SCENES.map((s) => s.id))
    const claimed = new Set<string>()
    for (const preset of SONGS) {
      expect(preset.visual, `${preset.id} has no visual`).toBeDefined()
      expect(ids, `${preset.id} asks for "${preset.visual}"`).toContain(preset.visual)
      expect(claimed, `${preset.id} reuses "${preset.visual}"`).not.toContain(preset.visual)
      claimed.add(preset.visual!)
    }
  })

  it('switches the scene when the song is switched', () => {
    const withVisual = SONGS.find((s) => s.visual !== undefined)!
    useBox.getState().loadPreset(withVisual.id)
    expect(useBox.getState().scene).toBe(withVisual.visual)
  })
})

describe('which pattern is sounding', () => {
  // The step cursor is driven by this, and it was broken from the day it was written: the
  // grid compared a ChainStep object against a pattern id, which type-checks and is never
  // equal, so no cursor ever rendered on any of the 176 pads. The second bug was hidden
  // behind the first — indexing the chain by bar ignores `repeat`, so it would have pointed
  // at the wrong section from the second bar of any song.
  it('follows the chain rather than counting entries as bars', () => {
    const song = defaultSong()
    expect(song.chain[0].repeat).toBeGreaterThan(1)
    // Every bar of the first entry's repeat is still the first entry's pattern.
    for (let bar = 0; bar < song.chain[0].repeat; bar++) {
      expect(soundingPatternAt(song, bar)).toBe(song.chain[0].pattern)
    }
    // And the bar after it is the second entry, not the entry at index `repeat`.
    expect(soundingPatternAt(song, song.chain[0].repeat)).toBe(song.chain[1].pattern)
  })

  it('returns a pattern id, not a chain step', () => {
    const id = soundingPatternAt(defaultSong(), 0)
    expect(typeof id).toBe('string')
    expect(defaultSong().patterns.map((p) => p.id)).toContain(id)
  })

  it('falls back to the first pattern when there is no chain', () => {
    const song = { ...defaultSong(), chain: [] }
    expect(soundingPatternAt(song, 7)).toBe(song.patterns[0].id)
  })
})

describe('every scene', () => {
  it('declares an accent the pad can use', () => {
    // The filter pad draws over whatever scene is running, on its own animation frame. A
    // scene without an accent silently falls back to amber, which is the one colour that
    // is wrong on the bright one.
    for (const scene of SCENES) {
      expect(scene.accent, `${scene.id} has no accent`).toMatch(/^\d+, \d+, \d+$/)
    }
  })
})
