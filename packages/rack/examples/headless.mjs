// The rack, scoring a scene that changes, with no browser anywhere.
//
// Run it after building the package:
//
//     npm run build --workspace @driftbox/rack
//     node packages/rack/examples/headless.mjs
//
// It renders sixteen seconds of a shipped patch while an intensity curve rises and falls the way a level
// might, writes `headless.wav` beside this file, and prints what the render cost. The cost is the
// interesting number: a game has to know whether this fits in its frame budget, and a patch is a few
// percent of one core.
//
// What this does NOT include is the groovebox — the 808, 909 and 303s arrive on a patch's host inputs from
// `@driftbox/engine`, which is Web Audio from end to end. Headless you get the rack's own modules.

import { writeFileSync } from 'node:fs'
import { Adaptive, MODULES, PATCHES, RackRenderer } from '../dist/index.js'

const SECONDS = 16
const preset = PATCHES.find((entry) => entry.id === 'acid') ?? PATCHES[0]

// Every module, because a shipped preset can contain any of them. A game with a patch it knows passes a
// registry of just that patch's modules instead, and carries a fraction of the bytes — see the README.
const renderer = new RackRenderer(MODULES, { sampleRate: 48000 })
renderer.patch = preset.build()
renderer.setTransport(renderer.patch.tempo ?? 120, true)

// The score: what each knob reads at each intensity. Two controls, one of each kind — a filter that slides
// with the scene, and a waveform that is a choice and therefore waits for a bar line.
const filter = renderer.patch.modules.find((module) => module.type === 'ladder' || module.type === 'svf')
const osc = renderer.patch.modules.find((module) => module.type === 'vco')
const controls = []
if (filter) {
  controls.push({
    target: [filter.id, 'cutoff'],
    points: [
      { at: 0, value: 300 },
      { at: 1, value: 6000 },
    ],
  })
}
if (osc) {
  controls.push({
    target: [osc.id, 'shape'],
    points: [
      { at: 0, value: 0 },
      { at: 0.6, value: 1 },
    ],
    onBar: true,
    step: true,
  })
}
const score = new Adaptive(renderer, { controls })

// A scene that gets tense and calms down again: 0 → 1 → 0 across the render.
const intensityAt = (seconds) => {
  const halfway = SECONDS / 2
  return seconds < halfway ? seconds / halfway : Math.max(0, 2 - seconds / halfway)
}

const started = process.hrtime.bigint()
const audio = renderer.render(SECONDS, ({ frame, beat }) => {
  score.update(intensityAt(frame / renderer.sampleRate), beat)
})
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

console.log(`patch:    ${preset.name} — ${preset.blurb}`)
console.log(`controls: ${controls.map(({ target }) => target.join('.')).join(', ') || 'none in this patch'}`)
console.log(
  `render:   ${SECONDS}s of stereo in ${elapsedMs.toFixed(0)}ms — ` +
    `${((SECONDS * 1000) / elapsedMs).toFixed(1)}x realtime, ` +
    `~${((elapsedMs / (SECONDS * 1000)) * 100).toFixed(2)}% of one core`,
)

writeFileSync(new URL('./headless.wav', import.meta.url), wav(audio))
console.log('wrote:    headless.wav')

/** Sixteen-bit stereo, which is all a listening check needs. */
function wav({ sampleRate, length, channels }) {
  const bytes = Buffer.alloc(44 + length * 4)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + length * 4, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(2, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 4, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(length * 4, 40)
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < 2; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]))
      bytes.writeInt16LE(Math.round(sample * 32767), 44 + i * 4 + channel * 2)
    }
  }
  return bytes
}
