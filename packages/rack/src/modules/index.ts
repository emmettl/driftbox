import type { ModuleDef, Registry } from '../types.js'
import { ADSR_MODULE } from './adsr.js'
import { CLOCK_MODULE } from './clock.js'
import { COMPRESSOR_MODULE } from './compressor.js'
import { DELAY_MODULE } from './delay.js'
import { DRIVE_MODULE } from './drive.js'
import { LADDER_MODULE } from './ladder.js'
import { LFO_MODULE } from './lfo.js'
import { MIDI_MODULE } from './midi.js'
import { MIXER_MODULE } from './mixer.js'
import { NOISE_MODULE } from './noise.js'
import { OFFSET_MODULE } from './offset.js'
import { OUT_MODULE } from './out.js'
import { QUANTIZER_MODULE } from './quantizer.js'
import { SAMPLE_HOLD_MODULE } from './sample-hold.js'
import { SAMPLER_MODULE } from './sampler.js'
import { SEQ_MODULE } from './seq.js'
import { SVF_MODULE } from './svf.js'
import { REVERB_MODULE } from './reverb.js'
import { TRACKER_MODULE } from './tracker.js'
import { TRANSPORT_MODULE } from './transport.js'
import { VCA_MODULE } from './vca.js'
import { VCO_MODULE } from './vco.js'

// Twenty-two modules: enough to make a track, something to play it with, something that knows what a bar is,
// and — as of `docs/DNB.md` — something that can chop a break.
//
// `docs/RACK.md` planned fifteen and listed clock and sequencer as one. Splitting them was the first
// departure and the reason is in `clock.ts`: a clock that is not a sequencer can drive several at
// different divisions, and a sequencer with no clock in it can be advanced by anything that makes an edge.
//
// MIDI is the second, and it is the only module here whose input does not come from a cable — see the long
// comment in `midi.ts` for why that needed no change to the message ABI.
//
// Three of the original omissions were later decided the other way. **There is a sampler**: drum and bass is
// built on chopped breaks, and `docs/DNB.md` settles where that line sits — the engine's drum machines stay
// fully synthesised while the rack is a different instrument. **There is polyphony**, which was always a
// decision rather than a gap. **There is reverb**, implemented as an FDN because the engine's convolver is not
// available inside an AudioWorklet.
//
// Adding one is a class, a def and a test. Nothing here needs to know about it beyond this list,
// and `modules.test.ts` holds every entry to the same structural rules, so a new module gets that
// coverage for free the moment it is listed.

/** In the order a faceplate would sensibly show them: sources, then filters, then shapers, then
 *  control, then the output. Nothing depends on this order — `compile` reads the registry by key —
 *  but a UI that iterates it should not have to sort. */
export const MODULE_LIST: readonly ModuleDef[] = [
  VCO_MODULE,
  NOISE_MODULE,
  SAMPLER_MODULE,
  LADDER_MODULE,
  SVF_MODULE,
  VCA_MODULE,
  DRIVE_MODULE,
  DELAY_MODULE,
  ADSR_MODULE,
  LFO_MODULE,
  SAMPLE_HOLD_MODULE,
  OFFSET_MODULE,
  MIXER_MODULE,
  TRANSPORT_MODULE,
  CLOCK_MODULE,
  COMPRESSOR_MODULE,
  SEQ_MODULE,
  REVERB_MODULE,
  TRACKER_MODULE,
  MIDI_MODULE,
  QUANTIZER_MODULE,
  OUT_MODULE,
]

export const MODULES: Registry = Object.fromEntries(
  MODULE_LIST.map((def) => [def.type, def]),
)

export { ADSR_MODULE, AdsrProcessor } from './adsr.js'
export { CLOCK_MODULE, ClockProcessor } from './clock.js'
export { DELAY_MODULE, DelayProcessor } from './delay.js'
export { DRIVE_MODULE, DriveProcessor } from './drive.js'
export { LADDER_MODULE, LadderProcessor } from './ladder.js'
export { LFO_MODULE, LfoProcessor } from './lfo.js'
export { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './midi.js'
export { MIXER_MODULE, MixerProcessor } from './mixer.js'
export { NOISE_MODULE, NoiseProcessor } from './noise.js'
export { OFFSET_MODULE, OffsetProcessor } from './offset.js'
export { OUT_MODULE, OutProcessor } from './out.js'
export { QUANTIZER_MODULE, QuantizerProcessor } from './quantizer.js'
export { SAMPLE_HOLD_MODULE, SampleHoldProcessor } from './sample-hold.js'
export { SAMPLER_MODULE, SamplerProcessor } from './sampler.js'
export { SEQ_MODULE, SeqProcessor } from './seq.js'
export { SVF_MODULE, SvfProcessor } from './svf.js'
export { COMPRESSOR_MODULE, CompressorProcessor } from './compressor.js'
export { REVERB_MODULE, ReverbProcessor } from './reverb.js'
export { TRACKER_LANES, TRACKER_MODULE, TrackerProcessor } from './tracker.js'
export { TRANSPORT_MODULE, TransportProcessor } from './transport.js'
export { VCA_MODULE, VcaProcessor } from './vca.js'
export { VCO_MODULE, VcoProcessor } from './vco.js'
