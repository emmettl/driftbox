import { describe, expect, it } from 'vitest'
import { FOLLOWER_MODULE, FollowerProcessor } from './follower.js'

// What the comments in `follower.ts` claim, measured. The two that matter are the attack/release asymmetry
// — a single coefficient would make a fast follower a fast releaser, which is a different device — and the
// gate's hysteresis, which is the difference between a trigger and a buzz.

const SR = 44100
const FRAMES = 128

const at = (id: string) => FOLLOWER_MODULE.params.findIndex((p) => p.id === id)

interface Options {
  attack?: number
  release?: number
  gain?: number
  threshold?: number
}

/** Run `blocks` of `signal(i)` through a fresh follower; returns the last block of each outlet. */
function run(signal: (sampleIndex: number) => number, blocks: number, options: Options = {}) {
  const processor = new FollowerProcessor(SR)
  const params = FOLLOWER_MODULE.params.map(
    (p) => new Float32Array(FRAMES).fill(options[p.id as keyof Options] ?? p.default),
  )
  const env: number[] = []
  const gate: number[] = []
  let n = 0
  for (let b = 0; b < blocks; b++) {
    const inlets = [new Float32Array(FRAMES)]
    for (let i = 0; i < FRAMES; i++) inlets[0][i] = signal(n++)
    const outlets = FOLLOWER_MODULE.outlets.map(() => new Float32Array(FRAMES))
    processor.process(inlets, outlets, params, FRAMES)
    env.push(...outlets[0])
    gate.push(...outlets[1])
  }
  return { env, gate }
}

const sine = (hz: number, amplitude = 1) => (i: number) =>
  Math.sin((2 * Math.PI * hz * i) / SR) * amplitude

describe('the follower', () => {
  it('settles at the amplitude of what it is given', () => {
    // Peak-following, so a sine of amplitude 0.5 reads about 0.5 — not the 0.354 an RMS follower would give.
    const { env } = run(sine(200, 0.5), 60)
    expect(env[env.length - 1]).toBeGreaterThan(0.45)
    expect(env[env.length - 1]).toBeLessThan(0.55)
  })

  it('rectifies, so a negative half-cycle still reads positive', () => {
    const { env } = run(() => -0.6, 40)
    expect(env[env.length - 1]).toBeGreaterThan(0.55)
  })

  it('rises in about the attack time', () => {
    // The 99%-in-the-stated-time convention the ADSR, the Seq and the Compressor all use. Checked at the
    // stated time rather than by curve-fitting: the claim is what a knob marked in seconds means.
    const attack = 0.01
    const { env } = run(() => 1, 20, { attack, release: 1 })
    const atTime = env[Math.round(attack * SR)]
    expect(atTime).toBeGreaterThan(0.95)
    expect(atTime).toBeLessThanOrEqual(1.001)
  })

  /** Drive the follower to 1, then let `blocks` of silence pass; returns where it ended up. */
  function afterSilence(release: number, blocks: number): number {
    const processor = new FollowerProcessor(SR)
    const params = FOLLOWER_MODULE.params.map((p) => new Float32Array(FRAMES).fill(p.default))
    params[at('attack')].fill(0.001)
    params[at('release')].fill(release)

    const loud = new Float32Array(FRAMES).fill(1)
    const outlets = () => FOLLOWER_MODULE.outlets.map(() => new Float32Array(FRAMES))
    for (let b = 0; b < 20; b++) processor.process([loud], outlets(), params, FRAMES)

    const silent = new Float32Array(FRAMES)
    let last = 0
    for (let b = 0; b < blocks; b++) {
      const out = outlets()
      processor.process([silent], out, params, FRAMES)
      last = out[0][FRAMES - 1]
    }
    return last
  }

  it('releases on the same 99%-in-the-stated-time curve the attack uses', () => {
    // Expected from the convention rather than from a number somebody eyeballed: after t seconds of a
    // release of r, what is left is 0.01^(t/r). Writing it out is what makes this a test of the stated
    // behaviour instead of a snapshot of whatever the code happened to do.
    const release = 0.5
    const blocks = 20
    const seconds = (blocks * FRAMES) / SR
    expect(afterSilence(release, blocks)).toBeCloseTo(Math.pow(0.01, seconds / release), 3)
  })

  it('falls much more slowly than it rises, which is the whole point of two knobs', () => {
    // A single coefficient would make a fast follower also a fast releaser — everything breathing in and
    // out at once. Same elapsed silence, two release settings, wildly different places.
    const slow = afterSilence(0.5, 20)
    const fast = afterSilence(0.005, 20)
    expect(slow).toBeGreaterThan(0.5)
    expect(fast).toBeLessThan(0.001)
  })

  it('scales by the gain knob', () => {
    const plain = run(() => 0.5, 60)
    const loud = run(() => 0.5, 60, { gain: 4 })
    expect(loud.env[loud.env.length - 1]).toBeCloseTo(plain.env[plain.env.length - 1] * 4, 2)
  })

  it('opens the gate above the threshold and shuts it well below', () => {
    const open = run(() => 0.8, 40, { threshold: 0.3 })
    expect(open.gate[open.gate.length - 1]).toBe(1)
    const shut = run(() => 0.05, 40, { threshold: 0.3 })
    expect(shut.gate[shut.gate.length - 1]).toBe(0)
  })

  it('does not chatter on a signal sitting exactly on the threshold', () => {
    // The reason the gate has hysteresis at all. Without it a signal parked on the threshold crosses it
    // every few samples and the "trigger" is a buzz at whatever rate the noise happens to have.
    const threshold = 0.5
    // A little noise on top of exactly the threshold, deterministic so the test cannot flake.
    let seed = 12345
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return (seed / 0x7fffffff - 0.5) * 0.02
    }
    const { gate } = run(() => threshold + jitter(), 40, { threshold, attack: 0.0005, release: 0.0005 })
    // Count edges in the settled second half.
    const settled = gate.slice(gate.length / 2)
    let edges = 0
    for (let i = 1; i < settled.length; i++) if (settled[i] !== settled[i - 1]) edges++
    expect(edges).toBeLessThanOrEqual(1)
  })

  it('keeps the envelope honest when the gain would push it past the ceiling', () => {
    // Clamped at the outlet and not in the state: clamping the running envelope would make the release
    // start from the ceiling rather than from where the signal was, so a loud transient would take the
    // same time to fall as a quiet one.
    const { env } = run(() => 1, 40, { gain: 8 })
    expect(env[env.length - 1]).toBe(4)
    for (const value of env) expect(Number.isFinite(value)).toBe(true)
  })

  it('declares its params in the order the processor reads them', () => {
    expect(FOLLOWER_MODULE.params.map((p) => p.id)).toEqual([
      'attack',
      'release',
      'gain',
      'threshold',
    ])
  })
})
