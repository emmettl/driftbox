import type { ModuleDef, Processor, Transport } from '../types.js'

/**
 * The patchable half of a live browser audio input.
 *
 * Capture itself belongs to the host: permission prompts, device ids and MediaStreams do
 * not exist in an AudioWorkletGlobalScope and must not become part of a portable patch.
 * The host connects a MediaStreamAudioSourceNode to rack input 4; this processor turns
 * that host bus into an ordinary rack outlet.
 *
 * `channel` matters for small guitar interfaces. They commonly expose two mono sockets as
 * the left and right channels of one device, so selecting the interface is not enough to
 * select the socket. A mono browser stream is accepted for either position.
 *
 * This class is SELF-CONTAINED — see the comment in `worklet.ts`.
 */
export class AudioInputProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
    _transport?: Transport,
    hostInputs: Float32Array[][] = [],
  ): void {
    const out = outlets[0]
    const level = params[0]
    const channel = params[1]
    // Inputs 0..3 belong to the retained 808, 909 and two 303 buses.
    const captured = hostInputs[4] ?? []
    const left = captured[0]
    const right = captured[1] ?? left

    for (let i = 0; i < frames; i++) {
      const source = channel[i] >= 0.5 ? right : left
      out[i] = (source?.[i] ?? 0) * level[i]
    }
  }
}

export const AUDIO_INPUT_MODULE: ModuleDef = {
  type: 'audio-input',
  version: 1,
  name: 'Audio Input',
  group: 'Sources',
  blurb:
    'A microphone or audio-interface input supplied by the browser. Select the device in the rack header, then patch it like any other source.',
  logo: {
    paths: [
      'M8 20h14M42 20h14',
      'M22 10v20M42 10v20',
      'M22 14c7 0 7-7 14-7v26c-7 0-7-7-14-7',
    ],
  },
  inlets: [],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    { id: 'level', name: 'Level', min: 0, max: 4, default: 1 },
    {
      id: 'channel',
      name: 'Channel',
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['Left / mono', 'Right'],
    },
  ],
  processor: AudioInputProcessor,
  // One captured source, however many synth voices the patch happens to have.
  poly: false,
}
