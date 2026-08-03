import {
  DEFAULT_FX,
  SONGS,
  defaultSong,
  renderMix,
  type Song,
} from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import {
  decodePatch,
  embedGrooveboxSong,
  encodePatch,
  grooveboxSong,
  patchCompatibility,
  renderRetainedSongMix,
} from './index.js'

const rest = { note: null, accent: false, slide: false } as const
const MAXIMUM_SAMPLE_DIFFERENCE = 2e-5

/** A compact document that exercises both machines, both 303s, stereo panning and sends. */
function paritySong(): Song {
  const seed = defaultSong()
  return {
    ...seed,
    bpm: 126,
    swing: 0.18,
    patterns: [
      {
        id: 'parity',
        name: 'Parity',
        length: 4,
        tracks: {
          '808.bd': [2, 0, 0, 0],
          '808.cp': [1, 0, 0, 0],
          '909.sd': [2, 0, 0, 0],
          '909.oh': [1, 0, 0, 0],
        },
        bass: {
          '303.a': [{ note: 0, accent: true, slide: true }, rest, rest, rest],
          '303.b': [{ note: 7, accent: false, slide: false }, rest, rest, rest],
        },
        pcf: [2, 0, 0, 0],
      },
    ],
    chain: [{ pattern: 'parity', repeat: 1 }],
    kit: {
      ...seed.kit,
      params: {
        ...seed.kit.params,
        '808.cp': { ...seed.kit.params['808.cp'], pan: 0.18 },
        '909.oh': { ...seed.kit.params['909.oh'], pan: 0.84 },
      },
      sends: {
        ...seed.kit.sends,
        '808.cp': { delay: 0.35, reverb: 0.4 },
        '303.a': { delay: 0.45, reverb: 0.2 },
      },
    },
    fx: {
      ...(seed.fx ?? DEFAULT_FX),
      drive: 0.2,
      pcfAmount: 0.55,
      compressor: 0.62,
    },
  }
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function maximumDifference(a: AudioBuffer, b: AudioBuffer): number {
  let maximum = 0
  for (let channel = 0; channel < a.numberOfChannels; channel++) {
    const left = a.getChannelData(channel)
    const right = b.getChannelData(channel)
    for (let frame = 0; frame < left.length; frame++) {
      maximum = Math.max(maximum, Math.abs(left[frame] - right[frame]))
    }
  }
  return maximum
}

async function renderPair(
  song: Song,
  options: { duration: number; tail: number; sampleRate: number; useLadder: boolean },
): Promise<[AudioBuffer, AudioBuffer]> {
  const patch = decodePatch(encodePatch(embedGrooveboxSong(song)))
  expect(patch).not.toBeNull()
  expect(patch && patchCompatibility(patch)).toBe('groovebox-compatible')
  expect(patch && grooveboxSong(patch)).toEqual(song)

  const originalRandom = Math.random
  try {
    Math.random = seeded(0x303_808_909)
    const sequencer = await renderMix(song, options)
    Math.random = seeded(0x303_808_909)
    const rack = await renderRetainedSongMix(patch!, options)
    expect(rack).not.toBeNull()
    return [sequencer, rack!]
  } finally {
    Math.random = originalRandom
  }
}

describe('retained-song render equivalence', () => {
  it('renders the sequencer Song WAV equivalently after the rack document boundary', async () => {
    const song = paritySong()
    const options = {
      duration: 1.2,
      tail: 0.2,
      sampleRate: 8000,
      useLadder: false,
    }
    const [sequencer, rack] = await renderPair(song, options)

    expect(rack.numberOfChannels).toBe(sequencer.numberOfChannels)
    expect(rack.sampleRate).toBe(sequencer.sampleRate)
    expect(rack.length).toBe(sequencer.length)
    expect(sequencer.getChannelData(0).some((sample) => Math.abs(sample) > 0.001)).toBe(true)
    // Separate OfflineAudioContexts, particularly under coverage instrumentation, can
    // round Web Audio internals differently. This ceiling remains below -93 dBFS.
    expect(maximumDifference(sequencer, rack)).toBeLessThan(MAXIMUM_SAMPLE_DIFFERENCE)
  })

  it.each(SONGS)('keeps the shipped $id render inside the same tolerance', async ({ build }) => {
    const [sequencer, rack] = await renderPair(build(), {
      duration: 0.75,
      tail: 0.1,
      sampleRate: 8000,
      useLadder: false,
    })
    expect(maximumDifference(sequencer, rack)).toBeLessThan(MAXIMUM_SAMPLE_DIFFERENCE)
  })
})
