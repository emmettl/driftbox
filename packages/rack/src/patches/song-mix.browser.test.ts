import { Bassline, buildVoice, planSong, renderVoice, voiceById } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { Rack, type Patch } from '../index.js'
import { grooveboxSong } from '../groovebox.js'
import { applyModulation } from '../modulation.js'
import { MODULES } from '../modules/index.js'
import { SONG_PATCHES } from './songs.js'

const SR = 22050

// Feed the retained song's dry machines into the four real host inputs. Render in eight-bar
// passages to bound the number of native voice nodes. Every arrangement section is covered;
// effect tails restart at passage boundaries, so this is a mix guardrail, not an export comparison.
async function checkPassage(patch: Patch, steps: ReturnType<typeof planSong>) {
  const song = grooveboxSong(patch)!
  const start = steps[0].time
  const last = steps.at(-1)!
  const seconds = last.time + last.stepSeconds - start + 0.5
  const context = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR)
  const rack = new Rack(context, MODULES)
  rack.patch = patch
  rack.setTransport(song.bpm, true, song.swing)
  for (const lane of patch.automation ?? []) {
    for (const point of lane.points) {
      const time = point.at * 60 / (4 * song.bpm) - start
      if (time > seconds) break
      rack.scheduleParam(lane.target[0], lane.target[1], point.value, Math.max(0, Math.round(time * SR)))
    }
  }
  const basses = await Promise.all([Bassline.create(context), Bassline.create(context)])
  basses.forEach(({ bassline }, index) => bassline.output.connect(rack.input(index + 2)!))
  for (const step of steps) {
    for (const hit of step.drums) {
      const voice = voiceById(hit.voiceId)!
      renderVoice(
        context,
        buildVoice(voice, hit.params, hit.accent),
        rack.input(hit.voiceId.startsWith('808.') ? 0 : 1)!,
        hit.time - start,
        hit.voiceId,
      )
    }
    for (const hit of step.bass) {
      basses[hit.voiceId === '303.a' ? 0 : 1].bassline.play(hit.note, hit.time - start)
    }
  }
  expect(await rack.start()).toBe(true)
  rack.output!.connect(context.destination)
  const audio = await context.startRendering()
  rack.stop()
  let peak = 0
  let power = 0
  let clipped = 0
  let finite = true
  for (let channel = 0; channel < 2; channel++) {
    for (const sample of audio.getChannelData(channel)) {
      finite &&= Number.isFinite(sample)
      peak = Math.max(peak, Math.abs(sample))
      power += sample * sample
      if (Math.abs(sample) > 0.98) clipped++
    }
  }
  const rms = Math.sqrt(power / (audio.length * 2))
  expect(finite).toBe(true)
  expect(peak).toBeGreaterThan(0.05)
  expect(peak).toBeLessThanOrEqual(1.001)
  expect(rms).toBeGreaterThan(0.008)
  expect(rms).toBeLessThan(0.35)
  expect(clipped / (audio.length * 2)).toBeLessThan(0.001)
}

describe.each(SONG_PATCHES)('$name complete rack mix', (preset) => {
  it.each([false, true])('keeps headroom with macros at maximum: %s', async (maximum) => {
    let patch = preset.build()
    if (maximum) {
      patch = applyModulation({
        ...patch,
        modules: patch.modules.map((module) => module.type === 'combi'
          ? { ...module, params: { ...module.params,
            rotary1: 127, rotary2: 127, rotary3: 127, rotary4: 127 } }
          : module),
      }, MODULES)
    }
    const song = grooveboxSong(patch)!
    const bars = Math.max(8, song.chain.reduce((sum, entry) => sum + entry.repeat, 0))
    const plan = planSong(song, bars)
    for (let step = 0; step < plan.length; step += 128) {
      await checkPassage(patch, plan.slice(step, step + 128))
    }
  }, 90_000) // Every section is rendered twice; leave room for slower CI audio workers.
})
