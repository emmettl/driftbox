import { renderVoice, type VoiceHandle } from './render'
import { Transport, type StepEvent } from './transport'
import { TR808_VOICES } from './voices/tr808'
import { TR909_VOICES } from './voices/tr909'
import { patternForBar, stepAt, type Song } from './pattern'
import { DEFAULT_PARAMS, type Voice, type VoiceParams, type VoiceSpec } from './types'

export * from './types'
export * from './pattern'
export * from './timing'
export { Transport, type StepEvent } from './transport'
export { renderVoice } from './render'
export { TR808_VOICES } from './voices/tr808'
export { TR909_VOICES } from './voices/tr909'

// The public face of the engine. Nothing in here — or anywhere below it — imports
// React, touches the DOM, or knows a sequencer UI exists. That is the whole point: the
// game embeds this and gets a soundtrack, the sequencer app embeds the same thing and
// puts knobs on it, and neither can drift from the other because there is one engine.

export const ALL_VOICES: Voice[] = [...TR909_VOICES, ...TR808_VOICES]

const VOICE_BY_ID = new Map(ALL_VOICES.map((v) => [v.id, v]))

export function voiceById(id: string): Voice | undefined {
  return VOICE_BY_ID.get(id)
}

/**
 * Build a voice's spec with its output normalisation applied.
 *
 * Everything that turns a voice into sound goes through here — the sequencer, the
 * audition button, the offline renderer behind the waveform display. If the trim were
 * applied at any one of those instead, the drawn waveform and the audible hit would be
 * different sizes, and the panel would quietly stop telling the truth.
 */
export function buildVoice(voice: Voice, params: VoiceParams, accent: number): VoiceSpec {
  const spec = voice.build(params, accent)
  if (voice.trim === undefined) return spec
  return { ...spec, trim: voice.trim }
}

export interface EngineOptions {
  /** Supply your own context to share one with other audio in the host app. */
  context?: AudioContext
  /** Master level, 0..1. */
  gain?: number
}

export class DriftboxEngine {
  readonly ctx: AudioContext
  /** Tap for visualisers. Everything audible passes through it. */
  readonly analyser: AnalyserNode

  private readonly bus: GainNode
  private readonly master: GainNode
  private readonly transport: Transport
  /** One ringing voice per choke group, so a closed hat can cut off an open one. */
  private readonly choking = new Map<string, VoiceHandle>()

  song: Song

  constructor(song: Song, options: EngineOptions = {}) {
    this.song = song
    this.ctx = options.context ?? new AudioContext()

    this.bus = this.ctx.createGain()
    this.bus.gain.value = 0.9

    // A gentle bus compressor. Drum machines are all transient, and without something
    // holding the peaks the master has to sit so low that everything sounds thin.
    const compressor = this.ctx.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.knee.value = 8
    compressor.ratio.value = 4
    compressor.attack.value = 0.004
    compressor.release.value = 0.18

    this.master = this.ctx.createGain()
    // 0.7, not 0.8. Measured by rendering the busiest shipped pattern through this
    // exact chain offline: the raw sum peaks at 2.14 and the compressor brings that to
    // 1.08 — still over full scale, so the loudest bars were hard-clipping on output.
    this.master.gain.value = options.gain ?? 0.7

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.75

    this.bus.connect(compressor)
    compressor.connect(this.master)
    this.master.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)

    this.transport = new Transport(this.ctx, {
      barLength: () => patternForBar(this.song, 0)?.length ?? 16,
      onStep: (event) => this.playStep(event),
    })
    this.transport.bpm = song.bpm
    this.transport.swing = song.swing
  }

  get running(): boolean {
    return this.transport.running
  }

  get position(): { bar: number; index: number } {
    return this.transport.position
  }

  set bpm(value: number) {
    this.song.bpm = value
    this.transport.bpm = value
  }

  get bpm(): number {
    return this.transport.bpm
  }

  set swing(value: number) {
    this.song.swing = value
    this.transport.swing = value
  }

  get swing(): number {
    return this.transport.swing
  }

  set gain(value: number) {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02)
  }

  /** Browsers start an AudioContext suspended until the user has interacted with the
   *  page. Call this from a click; starting the transport without it is silent. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  async start(): Promise<void> {
    await this.resume()
    this.transport.start()
  }

  stop(): void {
    this.transport.stop()
  }

  /** Fire one voice immediately — auditioning from the UI, or a one-shot from a game
   *  event that has nothing to do with the running pattern. */
  audition(voiceId: string, accent = 1): void {
    void this.resume()
    this.trigger(voiceId, this.ctx.currentTime + 0.01, accent)
  }

  trigger(voiceId: string, time: number, accent: number): void {
    const voice = voiceById(voiceId)
    if (!voice) return

    const params = this.song.kit.params[voiceId] ?? DEFAULT_PARAMS
    const spec = buildVoice(voice, params, accent)

    if (voice.choke) {
      const previous = this.choking.get(voice.choke)
      if (previous && previous.endsAt > time) {
        // Not an instant cut: a few milliseconds of fade, or the choke itself clicks.
        previous.output.gain.cancelScheduledValues(time)
        previous.output.gain.setValueAtTime(previous.output.gain.value, time)
        previous.output.gain.linearRampToValueAtTime(0, time + 0.004)
      }
    }

    const handle = renderVoice(this.ctx, spec, this.bus, time)
    if (voice.choke) this.choking.set(voice.choke, handle)
  }

  private playStep(event: StepEvent): void {
    const pattern = patternForBar(this.song, event.bar)
    if (!pattern) return

    for (const voiceId of Object.keys(pattern.tracks)) {
      const value = stepAt(pattern, voiceId, event.index)
      if (value === 0) continue
      this.trigger(voiceId, event.time, value === 2 ? 1 : 0.55)
    }
  }

  dispose(): void {
    this.stop()
    this.bus.disconnect()
    this.master.disconnect()
    this.analyser.disconnect()
  }
}

/**
 * Render a single voice on its own, offline, and hand back the samples.
 *
 * This is how the voices are actually verified — a kick either has energy below 100Hz
 * that decays over the time its knob says, or it does not, and that is a measurement
 * rather than an opinion. The sequencer also uses it to draw each voice's waveform in
 * its channel strip, so you can see the shape of the sound you are dialling in.
 */
export async function renderVoiceOffline(
  voice: Voice,
  params: VoiceParams = DEFAULT_PARAMS,
  accent = 1,
  sampleRate = 44100,
): Promise<Float32Array> {
  const spec = buildVoice(voice, params, accent)
  const length = Math.max(1, Math.ceil((spec.duration + 0.05) * sampleRate))
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  renderVoice(ctx, spec, ctx.destination, 0)
  const buffer = await ctx.startRendering()
  return buffer.getChannelData(0)
}
