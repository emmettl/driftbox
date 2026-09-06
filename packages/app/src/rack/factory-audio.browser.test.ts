import { MODULES, PATCHES, Rack, patchPresetById, renderPatch } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import { breakById, renderBreak } from './breaks.js'

const SR = 22050
const energy = (samples: Float32Array, end = samples.length) => {
  let total = 0
  for (let i = 0; i < end; i++) total += samples[i] ** 2
  return Math.sqrt(total / end)
}

// Exercise the whole factory bank, including the generated samples. Keyboard and external-input
// patches get a held note / test oscillator; silence is only intentional before the player supplies it.
describe.each(PATCHES)('$name factory audio', preset => {
  it('produces a finite, audible mix with headroom', async () => {
    const patch = preset.build()
    const data: Record<string, Record<string, Float32Array>> = {}
    if (preset.needsBreak) {
      const sample = await renderBreak(breakById(preset.needsBreak)!, { sampleRate: SR })
      for (const module of patch.modules.filter(m => m.type === 'sampler')) data[module.id] = { sample }
    }
    // A single held note for this mix check; the polyphonic performance has its own assertion below.
    patch.voices = 1
    patch.modules = patch.modules.map(module => module.type === 'midi'
      ? { ...module, params: { ...module.params, note: 60, gate: 1 } }
      : module.type === 'audio-input' ? { id: module.id, type: 'vco', params: { shape: 2 } } : module)
    const audio = await renderPatch(patch, { registry: MODULES, bars: preset.id === 'pressure-system' ? 41 : 4, tail: 0.4, sampleRate: SR, data })
    let peak = 0
    let clipped = 0
    let finite = true
    for (let channel = 0; channel < 2; channel++) {
      const samples = audio.getChannelData(channel)
      for (const sample of samples) {
        finite &&= Number.isFinite(sample)
        peak = Math.max(peak, Math.abs(sample))
        if (Math.abs(sample) > 0.98) clipped++
      }
    }
    expect(finite).toBe(true)
    expect(peak).toBeGreaterThan(0.015)
    expect(peak).toBeLessThanOrEqual(1.001)
    expect(clipped / (audio.length * 2)).toBeLessThan(0.001)
    expect(energy(audio.getChannelData(0))).toBeGreaterThan(0.002)
  })
})

it.each(['first-light', 'one-finger'])('%s responds to keys before the echo arrives', async id => {
  const patch = patchPresetById(id)!.build()
  const context = new OfflineAudioContext(2, SR * 2, SR)
  const rack = new Rack(context, MODULES)
  rack.patch = patch
  // The same per-voice MIDI slots the live keyboard writes, scheduled before worklet construction.
  const notes = id === 'first-light' ? [60, 64, 67, 71] : [57]
  notes.forEach((note, voice) => {
    rack.scheduleParam('midi-1', 'note', note, 0, voice)
    rack.scheduleParam('midi-1', 'gate', 1, 0, voice)
    rack.scheduleParam('midi-1', 'gate', 0, SR, voice)
  })
  expect(await rack.start()).toBe(true)
  rack.output!.connect(context.destination)
  const audio = await context.startRendering()
  rack.stop()
  for (let channel = 0; channel < 2; channel++) {
    const samples = audio.getChannelData(channel)
    expect(energy(samples, Math.floor(SR * 0.08))).toBeGreaterThan(0.005)
    let peak = 0
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
    expect(peak).toBeLessThan(0.95)
  }
})
