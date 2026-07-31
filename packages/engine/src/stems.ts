import { BASS_VOICES } from './bass.js'
import { Bassline } from './bassline.js'
import { DEFAULT_FX, Sends, type SendLevels } from './effects.js'
import { songBars, type Song } from './pattern.js'
import { renderVoice } from './render.js'
import { planSong } from './schedule.js'
import { buildVoice, voiceById } from './kit.js'

// Stems. One audio file per voice, which is what "per-voice outputs" means in practice.
//
// A browser cannot hand eight separate signals to a mixer — `AudioContext.destination` is
// whatever the output device is, and on almost every machine that is two channels. So the
// useful form of separate outputs here is not live routing, it is STEMS: render the song
// once per voice, offline and faster than real time, and hand back a buffer each. That is
// how a DAW is fed anyway.
//
// **Stems are pre-master.** Each one is its voice, dry plus that voice's own delay and
// reverb, summed at the same bus gain the live engine uses — and stopping there, before the
// compressor. This is the decision that makes the set useful: a compressor is non-linear
// and shared, so stems rendered through it do not add back up to the mix. Rendered
// pre-compressor they sum to within rounding of the live pre-compressor bus, which is what
// anybody importing them expects and what the test asserts.
//
// **Stems are not sample-reproducible, and cannot be.** Every noise voice — hats, claps,
// snares, the rim — starts at a random offset into a per-context buffer of random floats,
// so two renders of the same hat are two different hats. That is deliberate in the engine
// (it is what stops a closed hat sounding like a machine gun) and it means a stem set will
// not null-sum against a separately rendered mix. It does not matter for the purpose: you
// export once and use those files. It does mean the test asserts onsets and energy rather
// than samples.
//
// The one thing that is not separable at all is the sends' TAILS. Reverb is one room for
// the whole song by design, so a stem carries only the wet that its own voice put into it —
// which is right for mixing, and does mean twelve stems have twelve slightly different
// early reflections rather than one shared tail. There is no way around that short of one
// reverb per voice, which is not what the effect is for.

export interface Stem {
  voiceId: string
  /** The voice's display name, for the file. */
  name: string
  buffer: AudioBuffer
}

export interface StemOptions {
  sampleRate?: number
  /** Seconds of silence after the last step, so tails are not cut off. */
  tail?: number
  /** Render only these voices. Defaults to every voice the song actually uses. */
  only?: string[]
  /** Supplied by the host in tests; defaults to the global. */
  offline?: (channels: number, length: number, rate: number) => OfflineAudioContext
}

/**
 * Every voice the song actually plays.
 *
 * Only patterns the chain reaches count. A song often carries a pattern that is no longer
 * arranged anywhere — you write one, take it out of the chain, and it stays in the list —
 * and rendering a stem of a voice that never sounds hands somebody a silent file to wonder
 * about.
 */
export function voicesUsed(song: Song): string[] {
  const seen = new Set<string>()
  // Derive this from the same plan used by the live engine and renderer. Looking only at
  // pattern ids is no longer precise once a section can take its 808 and 303 from
  // different patterns: a source pattern may contain other voices that are not selected.
  const bars = song.chain.length > 0 ? songBars(song) : 1
  for (const step of planSong(song, bars)) {
    for (const hit of step.drums) seen.add(hit.voiceId)
    for (const hit of step.bass) seen.add(hit.voiceId)
  }
  return [...seen]
}

/** How long the song runs, plus room for the tail. */
export function songSeconds(song: Song, tail = 4): number {
  const plan = planSong(song, songBars(song))
  const last = plan[plan.length - 1]
  return (last ? last.time + last.stepSeconds : 0) + tail
}

/**
 * Render one voice of the song on its own.
 *
 * Everything is scheduled against the offline clock from the same `planSong` the live
 * transport walks, so a stem plays exactly what you heard — including its swing, which is
 * per voice and would be very easy to lose here.
 */
async function renderOne(song: Song, voiceId: string, opts: Required<Pick<StemOptions, 'sampleRate' | 'tail'>> & Pick<StemOptions, 'offline'>): Promise<AudioBuffer> {
  const seconds = songSeconds(song, opts.tail)
  const make =
    opts.offline ?? ((c: number, l: number, r: number) => new OfflineAudioContext(c, l, r))
  const ctx = make(2, Math.ceil(seconds * opts.sampleRate), opts.sampleRate)

  const bus = ctx.createGain()
  bus.gain.value = 0.9
  bus.connect(ctx.destination)

  // This voice's own sends, returning to this voice's own bus. Same settings as the live
  // engine, so a stem's wet matches what that voice contributed to the mix.
  const sends = new Sends(ctx, bus)
  sends.update(song.fx ?? DEFAULT_FX, song.bpm)
  const sendTo = (output: AudioNode, levels: SendLevels) => {
    for (const [input, amount] of [
      [sends.delayInput, levels.delay],
      [sends.reverbInput, levels.reverb],
    ] as const) {
      if (amount <= 0) continue
      const gain = ctx.createGain()
      gain.gain.value = amount
      output.connect(gain)
      gain.connect(input)
    }
  }

  const plan = planSong(song, songBars(song))
  const isBass = BASS_VOICES.some((v) => v.id === voiceId)

  if (isBass) {
    const { bassline } = await Bassline.create(ctx)
    bassline.output.connect(bus)
    const bassSends = [
      [sends.delayInput, 'delay'],
      [sends.reverbInput, 'reverb'],
    ] as const
    const sendGains = Object.fromEntries(bassSends.map(([input, kind]) => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      bassline.output.connect(gain)
      gain.connect(input)
      return [kind, gain]
    })) as Record<keyof SendLevels, GainNode>
    for (const step of plan) {
      for (const hit of step.bass) {
        if (hit.voiceId !== voiceId) continue
        sendGains.delay.gain.setValueAtTime(hit.sends.delay, hit.time)
        sendGains.reverb.gain.setValueAtTime(hit.sends.reverb, hit.time)
        bassline.play(hit.note, hit.time)
      }
    }
  } else {
    const voice = voiceById(voiceId)
    if (voice) {
      for (const step of plan) {
        for (const hit of step.drums) {
          if (hit.voiceId !== voiceId) continue
          const spec = buildVoice(voice, hit.params, hit.accent)
          const handle = renderVoice(ctx, spec, bus, hit.time)
          sendTo(handle.output, hit.sends)
        }
      }
    }
  }

  return ctx.startRendering()
}

/**
 * The whole song, one buffer per voice.
 *
 * Rendered one voice at a time rather than all at once with a splitter, because a 303 is a
 * single persistent monosynth — two of them in one graph would be two oscillators, but two
 * *stems* of one of them is a contradiction. Doing it serially also keeps peak memory to
 * one song rather than twelve.
 */
export async function renderStems(song: Song, options: StemOptions = {}): Promise<Stem[]> {
  const sampleRate = options.sampleRate ?? 44100
  const tail = options.tail ?? 4
  const ids = options.only ?? voicesUsed(song)

  const out: Stem[] = []
  for (const voiceId of ids) {
    const buffer = await renderOne(song, voiceId, { sampleRate, tail, offline: options.offline })
    const name = voiceById(voiceId)?.name ?? BASS_VOICES.find((v) => v.id === voiceId)?.name ?? voiceId
    out.push({ voiceId, name, buffer })
  }
  return out
}

/**
 * An AudioBuffer as a 32-bit float WAV.
 *
 * Float rather than 16-bit integer, and this is not a preference. A stem is PRE-MASTER by
 * design — it has not been through the bus compressor or the master gain — so it can and
 * does exceed full scale: the 909 closed hat comes out of the shipped chillwave song at
 * 1.11. Writing that as 16-bit means clamping it, which turns the loudest hat in the song
 * into a click, and the alternative of scaling everything down to fit changes the balance
 * between the files, which is the one thing a stem set exists to preserve.
 *
 * Float WAV has no ceiling, so neither problem arises. Every DAW written this century opens
 * it; the trade is that a few old utilities will not.
 */
export function toWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytes = 44 + frames * channels * 4
  const view = new DataView(new ArrayBuffer(bytes))

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  // 3 is IEEE float. Writing 1 here with 32-bit samples is the classic way to produce a
  // file that opens and sounds like tearing static.
  view.setUint16(20, 3, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 4, true)
  view.setUint16(32, channels * 4, true)
  view.setUint16(34, 32, true)
  ascii(36, 'data')
  view.setUint32(40, frames * channels * 4, true)

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      view.setFloat32(at, data[c][i], true)
      at += 4
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
