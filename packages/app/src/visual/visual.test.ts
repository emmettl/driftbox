import { beforeEach, describe, expect, it } from 'vitest'
import { resetSceneAudio, sceneAudio, setSceneAudio } from './audio.js'
import { ease, readBands, readLevels } from './levels.js'

// The visual layer, and the one rule that makes it shareable.
//
// The scenes used to import the sequencer's store to reach `engine.analyser` — thirteen scenes depending
// on the whole sequencer for one node. These tests pin the two halves of undoing that: the reading
// functions take an `AnalyserNode` and nothing more, and nothing under `visual/` reaches for the store.

/**
 * Every source file in the visual layer, scenes included, as text.
 *
 * Read through Vite's `import.meta.glob` rather than `node:fs`, because the app's tsconfig deliberately
 * has `types: ["vite/client"]` and no node types — app source has no business touching a filesystem, and
 * widening that for one test would let any component reach for `process` and still type-check. Asking the
 * bundler what files exist is also the more honest question here.
 */
const SOURCES = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sources = () => Object.entries(SOURCES)

describe('the visual layer stands on its own', () => {
  it('has more than a couple of files, so the sweep below means something', () => {
    // A guard on the guard. If the glob ever stopped matching anything — a rename, a move, a change to
    // Vite's glob syntax — the import checks would pass vacuously and read as "still decoupled" while
    // saying nothing at all.
    expect(sources().length).toBeGreaterThan(10)
  })

  it('never imports the sequencer store', () => {
    // The whole point. A scene that reaches for `useBox` again drags the engine, the songs and the
    // sequencer's own store into the rack's page — which is a 38kB page and the reason this matters.
    // Cheap to break by accident when copying an existing scene as the start of a new one.
    const offenders = sources().filter(([, text]) => /from ['"][./]*\.\.\/store['"]/.test(text))
    expect(offenders.map(([path]) => path)).toEqual([])
  })

  it('never imports the engine either', () => {
    // `levels.ts` did, for a type it only used to name a field. Same class of coupling, quieter.
    const offenders = sources().filter(([, text]) => /@driftbox\/engine/.test(text))
    expect(offenders.map(([path]) => path)).toEqual([])
  })
})

/** The parts of an AnalyserNode these functions actually touch, over a spectrum you choose. */
function fakeAnalyser(fill: (bin: number, bins: number) => number, bins = 512): AnalyserNode {
  return {
    frequencyBinCount: bins,
    getByteFrequencyData(target: Uint8Array) {
      for (let i = 0; i < target.length; i++) target[i] = fill(i, bins)
    },
  } as unknown as AnalyserNode
}

describe('reading the mix', () => {
  it('reads an analyser rather than an engine', () => {
    // Stated as a test because it is the API change: anything with an `AnalyserNode` can drive a scene,
    // which is what lets the rack use one. There is no engine anywhere in this file.
    const { bass, high } = readLevels(fakeAnalyser(() => 255))
    expect(bass).toBeCloseTo(1, 5)
    expect(high).toBeCloseTo(1, 5)
  })

  it('is silent with no analyser at all', () => {
    // The state every page is in before the first tap, and a scene reads this sixty times a second until
    // then — so it has to be zero rather than a throw.
    expect(readLevels(null)).toEqual({ bass: 0, high: 0 })
    expect(readLevels(undefined)).toEqual({ bass: 0, high: 0 })
  })

  it('tells a kick apart from a hat', () => {
    // Energy only in the bottom 2% of the spectrum, which is roughly a kick's fundamental.
    const low = readLevels(fakeAnalyser((i, bins) => (i < bins * 0.02 ? 255 : 0)))
    expect(low.bass).toBeGreaterThan(0.5)
    expect(low.high).toBe(0)

    // And only in the top third, which is where hats and the noise in a snare live.
    const top = readLevels(fakeAnalyser((i, bins) => (i > bins * 0.7 ? 255 : 0)))
    expect(top.high).toBeGreaterThan(0.5)
    expect(top.bass).toBe(0)
  })

  it('splits the spectrum logarithmically, so a kick and a hat land in different bands', () => {
    // Linear band edges would put fifteen of sixteen lanes in the top two octaves, where a drum machine
    // has almost nothing but hats — the entire reason for showing bands separately would be lost.
    const bands = readBands(fakeAnalyser((i, bins) => (i < bins * 0.02 ? 255 : 0)), new Float32Array(16))
    const loudest = bands.indexOf(Math.max(...bands))
    expect(loudest).toBeLessThan(8)
  })

  it('zeroes the bands it was given when there is no analyser', () => {
    const out = new Float32Array(8).fill(0.5)
    readBands(null, out)
    expect([...out]).toEqual(new Array(8).fill(0))
  })

  it('snaps up on a transient and eases down after it', () => {
    // Symmetric smoothing makes every hit a slow swell and loses the punch, which is the difference
    // between a visualiser reading the music and one merely moving.
    expect(ease(0.1, 0.9, 1 / 60)).toBe(0.9)
    const falling = ease(0.9, 0, 1 / 60)
    expect(falling).toBeLessThan(0.9)
    expect(falling).toBeGreaterThan(0.5)
  })
})

describe('what the scenes are watching', () => {
  beforeEach(resetSceneAudio)

  it('starts silent, stopped, and at a tempo that is not zero', () => {
    // A scene mounted before audio exists still runs a frame loop. Dividing by a zero tempo would put
    // NaN into a matrix, which reads as the scene disappearing.
    expect(sceneAudio.analyser).toBe(null)
    expect(sceneAudio.running).toBe(false)
    expect(sceneAudio.bpm).toBeGreaterThan(0)
  })

  it('keeps the same object, so a scene holding a reference sees the change', () => {
    // The one real hazard of publishing rather than passing: every scene imports `sceneAudio` once and
    // reads it every frame, so replacing the object would leave all of them reading the old one for ever.
    const held = sceneAudio
    const analyser = fakeAnalyser(() => 0)
    setSceneAudio({ analyser, running: true, bpm: 174 })
    expect(held.analyser).toBe(analyser)
    expect(held.running).toBe(true)
    expect(held.bpm).toBe(174)
  })

  it('leaves alone what it was not told about', () => {
    setSceneAudio({ bpm: 174 })
    setSceneAudio({ running: true })
    expect(sceneAudio.bpm).toBe(174)
  })

  it('can be told there is no analyser, which is not the same as not being told', () => {
    // `undefined` means "no change" and `null` means "there is no audio" — a page unmounting its graph
    // has to be able to say the second one.
    setSceneAudio({ analyser: fakeAnalyser(() => 0) })
    setSceneAudio({ analyser: null })
    expect(sceneAudio.analyser).toBe(null)
  })

  it('goes back to silence on reset', () => {
    setSceneAudio({ analyser: fakeAnalyser(() => 0), running: true, bpm: 174 })
    resetSceneAudio()
    expect(sceneAudio).toEqual({ analyser: null, running: false, bpm: 120 })
  })
})
