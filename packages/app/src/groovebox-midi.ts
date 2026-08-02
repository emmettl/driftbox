import {
  AUTOMATION_TARGET,
  type BassParams,
  type FxParams,
  type SendLevels,
  type VoiceParams,
} from '@driftbox/engine'
import type { CcParamRange } from './midi-cc.js'

/** A stable namespace inside the shared hardware-binding store. Rack module ids cannot
 * collide with it because the groovebox targets live in their own host document. */
export const GROOVEBOX_MIDI_MODULE = 'groovebox'

export interface GrooveboxMidiTarget extends CcParamRange {
  param: string
  label: string
}

const VOICE: readonly { key: keyof VoiceParams; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'tune', label: 'Tune' },
  { key: 'decay', label: 'Decay' },
  { key: 'tone', label: 'Tone' },
  { key: 'colour', label: 'Colour' },
  { key: 'pan', label: 'Pan' },
]
const BASS: readonly { key: keyof BassParams; label: string; stepped?: boolean }[] = [
  { key: 'tune', label: 'Tune' },
  { key: 'wave', label: 'Wave', stepped: true },
  { key: 'cutoff', label: 'Cutoff' },
  { key: 'resonance', label: 'Resonance' },
  { key: 'envMod', label: 'Env mod' },
  { key: 'decay', label: 'Decay' },
  { key: 'accent', label: 'Accent' },
  { key: 'level', label: 'Level' },
]
const SEND: readonly { key: keyof SendLevels; label: string }[] = [
  { key: 'delay', label: 'Delay send' },
  { key: 'reverb', label: 'Reverb send' },
]
const FX: readonly { key: keyof FxParams; label: string }[] = [
  { key: 'drive', label: 'Drive' },
  { key: 'pcfAmount', label: 'PCF amount' },
  { key: 'pcfCutoff', label: 'PCF cutoff' },
  { key: 'pcfResonance', label: 'PCF resonance' },
  { key: 'pcfEnv', label: 'PCF envelope' },
  { key: 'pcfDecay', label: 'PCF decay' },
  { key: 'compressor', label: 'Compressor' },
  { key: 'delayTime', label: 'Delay time' },
  { key: 'delayFeedback', label: 'Delay feedback' },
  { key: 'delayTone', label: 'Delay tone' },
  { key: 'reverbSize', label: 'Reverb size' },
  { key: 'reverbDamping', label: 'Reverb damping' },
]

const normal = (param: string, label: string, stepped = false): GrooveboxMidiTarget => ({
  param,
  label,
  min: 0,
  max: 1,
  ...(stepped ? { stepped: true } : {}),
})

/** The useful learn surface for the editor's current context. Identities include the
 * voice, so changing selection never silently retargets a learned hardware knob. */
export function grooveboxMidiTargets(
  bassView: boolean,
  selectedVoice: string,
  selectedBass: string,
): GrooveboxMidiTarget[] {
  const focused = bassView
    ? BASS.map(({ key, label, stepped }) =>
        normal(AUTOMATION_TARGET.bass(selectedBass, key), `303 · ${label}`, stepped),
      )
    : VOICE.map(({ key, label }) =>
        normal(AUTOMATION_TARGET.voice(selectedVoice, key), `${selectedVoice} · ${label}`),
      )
  const routingVoice = bassView ? selectedBass : selectedVoice
  return [
    { param: AUTOMATION_TARGET.bpm, label: 'Song · BPM', min: 60, max: 180, stepped: true },
    normal(AUTOMATION_TARGET.swing, 'Song · Swing'),
    ...focused,
    ...SEND.map(({ key, label }) =>
      normal(AUTOMATION_TARGET.send(routingVoice, key), `${routingVoice} · ${label}`),
    ),
    normal(AUTOMATION_TARGET.voiceSwing(routingVoice), `${routingVoice} · Swing`),
    ...FX.map(({ key, label }) => normal(AUTOMATION_TARGET.fx(key), `FX · ${label}`)),
  ]
}

/** Resolve a persisted target even when its voice is not currently selected, so learned
 * controls keep working while the editor is looking somewhere else. */
export function grooveboxMidiTargetRange(param: string): CcParamRange | null {
  if (param === AUTOMATION_TARGET.bpm) return { min: 60, max: 180, stepped: true }
  if (param === AUTOMATION_TARGET.swing) return { min: 0, max: 1 }
  const [kind, voiceId, key, extra] = param.split('/')
  if (extra !== undefined || !voiceId) return null
  if (kind === 'voice' && key && VOICE_KEYS.has(key)) return { min: 0, max: 1 }
  if (kind === 'bass' && key && BASS_KEYS.has(key)) {
    return { min: 0, max: 1, ...(key === 'wave' ? { stepped: true } : {}) }
  }
  if (kind === 'send' && key && SEND_KEYS.has(key)) return { min: 0, max: 1 }
  if (kind === 'swing' && key === undefined) return { min: 0, max: 1 }
  if (kind === 'fx' && key === undefined && FX_KEYS.has(voiceId)) return { min: 0, max: 1 }
  return null
}

export interface GrooveboxMidiActions {
  setBpm(value: number): void
  setSwing(value: number): void
  setParam(voiceId: string, key: keyof VoiceParams, value: number): void
  setBassParam(voiceId: string, key: keyof BassParams, value: number): void
  setSend(voiceId: string, key: keyof SendLevels, value: number): void
  setVoiceSwing(voiceId: string, value: number): void
  setFx(key: keyof FxParams, value: number): void
}

const VOICE_KEYS = new Set<string>(VOICE.map(({ key }) => key))
const BASS_KEYS = new Set<string>(BASS.map(({ key }) => key))
const SEND_KEYS = new Set<string>(SEND.map(({ key }) => key))
const FX_KEYS = new Set<string>(FX.map(({ key }) => key))

/** Apply one stable target through the editor actions. Going through these actions is
 * essential: it updates the visible song, autosave and armed automation exactly as a
 * mouse turn does. Unknown old/future targets remain stored but safely do nothing. */
export function applyGrooveboxMidiTarget(
  param: string,
  value: number,
  actions: GrooveboxMidiActions,
): boolean {
  if (param === AUTOMATION_TARGET.bpm) {
    actions.setBpm(value)
    return true
  }
  if (param === AUTOMATION_TARGET.swing) {
    actions.setSwing(value)
    return true
  }

  const [kind, voiceId, key, extra] = param.split('/')
  if (extra !== undefined) return false
  if (kind === 'voice' && voiceId && key && VOICE_KEYS.has(key)) {
    actions.setParam(voiceId, key as keyof VoiceParams, value)
    return true
  }
  if (kind === 'bass' && voiceId && key && BASS_KEYS.has(key)) {
    actions.setBassParam(voiceId, key as keyof BassParams, value)
    return true
  }
  if (kind === 'send' && voiceId && key && SEND_KEYS.has(key)) {
    actions.setSend(voiceId, key as keyof SendLevels, value)
    return true
  }
  if (kind === 'swing' && voiceId && key === undefined) {
    actions.setVoiceSwing(voiceId, value)
    return true
  }
  if (kind === 'fx' && voiceId && key === undefined && FX_KEYS.has(voiceId)) {
    actions.setFx(voiceId as keyof FxParams, value)
    return true
  }
  return false
}
