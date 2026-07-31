import { describe, expect, it } from 'vitest'
import { DriftboxEngine, GROOVEBOX_SECTIONS, type GrooveboxSection } from './index.js'
import { defaultSong } from './songs/index.js'

const peak = (buffer: AudioBuffer): number => {
  let value = 0
  for (const sample of buffer.getChannelData(0)) value = Math.max(value, Math.abs(sample))
  return value
}

interface RenderOptions {
  voice?: string
  destinationGain?: number
  divert?: GrooveboxSection
  tap?: GrooveboxSection
  sectionGain?: number
}

async function render(options: RenderOptions = {}): Promise<number> {
  const sampleRate = 44_100
  const context = new OfflineAudioContext(1, sampleRate, sampleRate)
  let destination: AudioNode | undefined
  if (options.destinationGain !== undefined) {
    const bus = context.createGain()
    bus.gain.value = options.destinationGain
    bus.connect(context.destination)
    destination = bus
  }
  let diverted: AudioNode | null = null
  if (options.divert || options.tap) {
    const section = context.createGain()
    section.gain.value = options.sectionGain ?? 1
    section.connect(context.destination)
    diverted = section
  }

  const engine = new DriftboxEngine(defaultSong(), {
    context: context as unknown as AudioContext,
    destination,
  })
  if (options.divert) engine.routeSection(options.divert, diverted)
  if (options.tap) engine.tapSection(options.tap, diverted)
  // No sends: this test is measuring the dry section route, not the shared effect return.
  engine.trigger(options.voice ?? '808.bd', 0.05, 1, undefined, { delay: 0, reverb: 0 })
  const buffer = await context.startRendering()
  engine.dispose()
  return peak(buffer)
}

describe('a hosted engine output', () => {
  it('routes the complete mix through a supplied destination without bypassing it', async () => {
    expect(await render()).toBeGreaterThan(0.05)
    expect(await render({ destinationGain: 0 })).toBe(0)
  })

  it('gives the four authored machines stable section identities', () => {
    expect(GROOVEBOX_SECTIONS).toEqual(['tr808', 'tr909', '303.a', '303.b'])
  })

  it('can divert one dry machine without taking another out of the mastered mix', async () => {
    expect(await render({ divert: 'tr808', sectionGain: 0 })).toBe(0)
    expect(await render({ voice: '909.bd', divert: 'tr808', sectionGain: 0 })).toBeGreaterThan(0.05)
  })

  it('can tap a dry machine without removing it from the mastered mix', async () => {
    expect(await render({ tap: 'tr808', sectionGain: 0 })).toBeGreaterThan(0.05)
    expect(
      await render({ tap: 'tr808', destinationGain: 0, sectionGain: 1 }),
    ).toBeGreaterThan(0.05)
  })
})
