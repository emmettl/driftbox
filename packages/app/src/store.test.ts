import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBox } from './store'
import {
  AUTOMATION_TARGET,
  SONGS,
  chainBarAt,
  defaultSong,
  songBars,
  type DriftboxEngine,
} from '@driftbox/engine'
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
  useBox.setState({
    song: defaultSong(),
    engine: null,
    editing: 'drift',
    running: false,
    loop: null,
    automationRecording: false,
  })
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

describe('automation recording', () => {
  it('writes supported controls at the current transport position while armed and running', () => {
    const engine = {
      running: true,
      position: { bar: 2, index: 3 },
    } as unknown as DriftboxEngine
    useBox.setState({ engine, running: true, automationRecording: true })

    useBox.getState().setBpm(138)
    useBox.getState().setSwing(0.42)
    useBox.getState().setParam('808.bd', 'decay', 0.2)
    useBox.getState().setBassParam('303.a', 'cutoff', 0.8)
    useBox.getState().setVoiceSwing('808.ch', 0.7)

    const lanes = new Map(song().automation?.map((lane) => [lane.target, lane.points]))
    expect(lanes.get(AUTOMATION_TARGET.bpm)).toEqual([{ bar: 2, index: 3, value: 138 }])
    expect(lanes.get(AUTOMATION_TARGET.swing)).toEqual([{ bar: 2, index: 3, value: 0.42 }])
    expect(lanes.get(AUTOMATION_TARGET.voice('808.bd', 'decay'))).toEqual([
      { bar: 2, index: 3, value: 0.2 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.bass('303.a', 'cutoff'))).toEqual([
      { bar: 2, index: 3, value: 0.8 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.voiceSwing('808.ch'))).toEqual([
      { bar: 2, index: 3, value: 0.7 },
    ])
  })

  it('does not write points while stopped, even if recording is armed', () => {
    const engine = {
      running: false,
      position: { bar: 4, index: 5 },
    } as unknown as DriftboxEngine
    useBox.setState({ engine, running: false, automationRecording: true })
    useBox.getState().setParam('808.bd', 'tone', 0.1)
    expect(song().automation).toBeUndefined()
  })

  it('clears the timeline without changing base parameter values', () => {
    const current = song()
    useBox.setState({
      song: {
        ...current,
        automation: [{
          target: AUTOMATION_TARGET.swing,
          interpolation: 'linear',
          points: [{ bar: 0, index: 0, value: 0.8 }],
        }],
      },
    })
    const swing = song().swing
    useBox.getState().clearAutomation()
    expect(song().automation).toBeUndefined()
    expect(song().swing).toBe(swing)
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

  it('changes one machine clip without changing the section fallback', () => {
    const before = song().chain[0]
    useBox.getState().setChainClip(0, 'tr909', 'neon')
    expect(song().chain[0]).toEqual({
      ...before,
      clips: { ...before.clips, tr909: 'neon' },
    })
    expect(song().chain[0].pattern).toBe(before.pattern)
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

  it('loops one section at its absolute bar range and toggles it off', () => {
    const setLoop = vi.fn()
    const clearLoop = vi.fn()
    useBox.setState({
      engine: { setLoop, clearLoop } as unknown as DriftboxEngine,
      loop: null,
    })
    const index = 1
    const start = chainBarAt(song(), index)
    const bars = song().chain[index].repeat

    useBox.getState().toggleSectionLoop(index)
    expect(setLoop).toHaveBeenCalledWith(start, bars)
    expect(useBox.getState().loop).toEqual({ start, bars })

    useBox.getState().toggleSectionLoop(index)
    expect(clearLoop).toHaveBeenCalled()
    expect(useBox.getState().loop).toBeNull()
  })

  it('starts playback at an exact bar', async () => {
    const startAt = vi.fn().mockResolvedValue(undefined)
    useBox.setState({
      engine: { running: false, startAt } as unknown as DriftboxEngine,
      running: false,
    })

    useBox.getState().startAtBar(7)
    await vi.waitFor(() => expect(useBox.getState().running).toBe(true))
    expect(startAt).toHaveBeenCalledWith(7)
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

  it('programs 909 flams and their global width without touching another machine', () => {
    useBox.getState().toggleFlamStep('909.sd', 0)
    useBox.getState().setFlamWidth(0.72)

    expect(song().patterns[0].tracks['909.sd'][0]).toBe(1)
    expect(song().patterns[0].flams!['909.sd'][0]).toBe(true)
    expect(song().patterns[0].tracks['808.bd']).toEqual([1, 0, 0, 0])
    expect(song().kit.flam).toBe(0.72)
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

  it('follows the selected machine clip', () => {
    const song = {
      ...defaultSong(),
      chain: [
        {
          pattern: 'haze',
          clips: { tr909: 'neon', '303.a': 'drift' },
          repeat: 4,
        },
      ],
    }
    expect(soundingPatternAt(song, 0, 'tr808')).toBe('haze')
    expect(soundingPatternAt(song, 0, 'tr909')).toBe('neon')
    expect(soundingPatternAt(song, 0, '303.a')).toBe('drift')
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
