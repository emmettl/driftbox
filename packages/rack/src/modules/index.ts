import type { ModuleDef, Registry } from '../types.js'
import { ADSR_MODULE } from './adsr.js'
import { AUDIO_INPUT_MODULE } from './audio-input.js'
import { ARP_MODULE } from './arp.js'
import { ARRANGER_MODULE } from './arranger.js'
import { ALLIGATOR_MODULE } from './alligator.js'
import { CABINET_MODULE } from './cabinet.js'
import { CLOCK_MODULE } from './clock.js'
import { COMBI_MODULE } from './combi.js'
import { COMPRESSOR_MODULE } from './compressor.js'
import { DELAY_MODULE } from './delay.js'
import { DISTORTION_MODULE } from './distortion.js'
import { DRIVE_MODULE } from './drive.js'
import { EQ_MODULE } from './eq.js'
import { FOLLOWER_MODULE } from './follower.js'
import { GROOVEBOX_MODULE } from './groovebox.js'
import { IMAGER_MODULE } from './imager.js'
import { LADDER_MODULE } from './ladder.js'
import { LIMITER_MODULE } from './limiter.js'
import { LFO_MODULE } from './lfo.js'
import { LOOPER_MODULE } from './looper.js'
import { MIDI_MODULE } from './midi.js'
import { METER_MODULE } from './meter.js'
import { MIXER_MODULE } from './mixer.js'
import { NOISE_MODULE } from './noise.js'
import { OFFSET_MODULE } from './offset.js'
import { OUT_MODULE } from './out.js'
import { PHASER_MODULE } from './phaser.js'
import { PING_PONG_MODULE } from './ping-pong.js'
import { QUANTIZER_MODULE } from './quantizer.js'
import { SAMPLE_HOLD_MODULE } from './sample-hold.js'
import { SAMPLER_MODULE } from './sampler.js'
import { SEQ_MODULE } from './seq.js'
import { SVF_MODULE } from './svf.js'
import { REVERB_MODULE } from './reverb.js'
import { TRACKER_MODULE } from './tracker.js'
import { TRANSPORT_MODULE } from './transport.js'
import { TUNER_MODULE } from './tuner.js'
import { VCA_MODULE } from './vca.js'
import { VCO_MODULE } from './vco.js'
import { VOCODER_MODULE } from './vocoder.js'
import { VOICE_MODULE } from './voice.js'

// Forty-one modules: enough to make a track, something to play it with, something that knows what a bar
// is, something that can chop a break — and, as of the Combinator, something to play all of it *with one
// hand*.
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
// The Combinator is the third *departure from the plan*, and the only one of those that is not a sound. It makes no signal of its own
// worth listening to; what it does is move other modules' *parameters*, which is the one thing a cable in
// this rack cannot do — an inlet is a buffer, a param is a slot, and `modulation.ts` explains at length why
// joining them would be worse than having both. It is Reason's Modulation Routing and it needed no change
// to the graph, the plan, or the message ABI.
//
// Adding one is a class, a def and a test. Nothing here needs to know about it beyond this list,
// and `modules.test.ts` holds every entry to the same structural rules, so a new module gets that
// coverage for free the moment it is listed.

/**
 * In the order a picker would sensibly show them, and **grouped**, which is new.
 *
 * The order always implied these groups — sources, then filters, then shapers, then control, then the
 * output — but nothing stated them and nothing could read them, so a picker got a list of names in a
 * row. Each def now carries its own `group`, and this list is sorted to agree: every module of a group is
 * contiguous, and the groups run in signal order. `modules.test.ts` holds it to that, because a list that
 * has drifted out of group order reads as a bug in the picker rather than as a bug here.
 *
 * Nothing depends on the order — `compile` reads the registry by key — but a UI that iterates it should
 * not have to sort.
 */
export const MODULE_LIST: readonly ModuleDef[] = [
  GROOVEBOX_MODULE,
  AUDIO_INPUT_MODULE,
  VCO_MODULE,
  VOICE_MODULE,
  NOISE_MODULE,
  SAMPLER_MODULE,

  LADDER_MODULE,
  SVF_MODULE,
  ALLIGATOR_MODULE,
  VOCODER_MODULE,

  VCA_MODULE,
  DRIVE_MODULE,
  DISTORTION_MODULE,
  CABINET_MODULE,
  EQ_MODULE,
  IMAGER_MODULE,
  COMPRESSOR_MODULE,
  LIMITER_MODULE,

  DELAY_MODULE,
  PING_PONG_MODULE,
  PHASER_MODULE,
  REVERB_MODULE,
  LOOPER_MODULE,

  ADSR_MODULE,
  LFO_MODULE,
  FOLLOWER_MODULE,
  SAMPLE_HOLD_MODULE,
  OFFSET_MODULE,
  QUANTIZER_MODULE,
  // Last of the modulation sources, because a Combinator is not in a signal chain at all — it sits over
  // the top of one, and every other module on this shelf makes a CV that travels down a cable.
  COMBI_MODULE,

  TRANSPORT_MODULE,
  CLOCK_MODULE,
  SEQ_MODULE,
  TRACKER_MODULE,
  ARRANGER_MODULE,
  ARP_MODULE,
  MIDI_MODULE,

  METER_MODULE,
  TUNER_MODULE,

  MIXER_MODULE,
  OUT_MODULE,
]

export const MODULES: Registry = Object.fromEntries(
  MODULE_LIST.map((def) => [def.type, def]),
)

export { ADSR_MODULE, AdsrProcessor } from './adsr.js'
export { AUDIO_INPUT_MODULE, AudioInputProcessor } from './audio-input.js'
export { ARP_MODULE, ArpProcessor } from './arp.js'
export { ARRANGER_MODULE, ARRANGER_SECTIONS, ArrangerProcessor } from './arranger.js'
export { ALLIGATOR_BANDS, ALLIGATOR_MODULE, AlligatorProcessor } from './alligator.js'
export { CABINET_MODULE, CabinetProcessor } from './cabinet.js'
export { CLOCK_MODULE, ClockProcessor } from './clock.js'
export { COMBI_CONTROLS, COMBI_MODULE, COMBI_ROTARY_MAX, CombiProcessor } from './combi.js'
export { DELAY_MODULE, DelayProcessor } from './delay.js'
export { DISTORTION_MODULE, DistortionProcessor } from './distortion.js'
export { DRIVE_MODULE, DriveProcessor } from './drive.js'
export { FOLLOWER_MODULE, FollowerProcessor } from './follower.js'
export { GROOVEBOX_MODULE, GROOVEBOX_PORTS, GrooveboxProcessor } from './groovebox.js'
export { IMAGER_MODULE, ImagerProcessor } from './imager.js'
export { LADDER_MODULE, LadderProcessor } from './ladder.js'
export { LIMITER_MODULE, LimiterProcessor } from './limiter.js'
export { LFO_MODULE, LfoProcessor } from './lfo.js'
export { LOOPER_MODULE, LooperProcessor } from './looper.js'
export { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './midi.js'
export { METER_MODULE, MeterProcessor } from './meter.js'
export { MIXER_MODULE, MixerProcessor } from './mixer.js'
export { NOISE_MODULE, NoiseProcessor } from './noise.js'
export { OFFSET_MODULE, OffsetProcessor } from './offset.js'
export { OUT_MODULE, OutProcessor } from './out.js'
export { PHASER_MODULE, PhaserProcessor } from './phaser.js'
export { PING_PONG_MODULE, PingPongProcessor } from './ping-pong.js'
export { QUANTIZER_MODULE, QuantizerProcessor } from './quantizer.js'
export { SAMPLE_HOLD_MODULE, SampleHoldProcessor } from './sample-hold.js'
export { SAMPLER_MODULE, SamplerProcessor } from './sampler.js'
export { SEQ_MODULE, SeqProcessor } from './seq.js'
export { SVF_MODULE, SvfProcessor } from './svf.js'
export { COMPRESSOR_MODULE, CompressorProcessor } from './compressor.js'
export { REVERB_MODULE, ReverbProcessor } from './reverb.js'
export { TRACKER_LANES, TRACKER_MODULE, TrackerProcessor } from './tracker.js'
export { TRANSPORT_MODULE, TransportProcessor } from './transport.js'
export { TUNER_MODULE, TunerProcessor } from './tuner.js'
export { VCA_MODULE, VcaProcessor } from './vca.js'
export { VCO_MODULE, VcoProcessor } from './vco.js'
export { VOICE_MODULE, VoiceProcessor } from './voice.js'
export {
  VOCODER_BAND_COUNTS,
  VOCODER_MAX_BANDS,
  VOCODER_MODULE,
  VOCODER_RANGE_HZ,
  VocoderProcessor,
} from './vocoder.js'
