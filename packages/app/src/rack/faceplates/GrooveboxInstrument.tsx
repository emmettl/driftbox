import {
  DEFAULT_FX,
  bassStepSounds,
  setBassStep,
  setBassStepGate,
  setBassStepSlide,
  type BassParams,
  type BassStep,
  type FxParams,
  type Pattern,
  type SendLevels,
  type Song,
  type VoiceParams,
} from '@driftbox/engine'
import { Knob } from '../../ui/Knob.js'
import {
  bassParamsOf,
  drumParamsOf,
  grooveboxRouting,
  type Routing,
} from './groovebox-editor.js'
import type { Focus } from './groovebox-focus.js'
import { bassNoteReadout, fxFormat, pan, percent, sectionName, wave } from './groovebox-format.js'

const DRUM_KNOBS: readonly { key: keyof VoiceParams; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'tune', label: 'Tune' },
  { key: 'decay', label: 'Decay' },
  { key: 'tone', label: 'Tone' },
  { key: 'colour', label: 'Colour' },
  { key: 'pan', label: 'Pan' },
]

const BASS_KNOBS: readonly { key: keyof BassParams; label: string }[] = [
  { key: 'tune', label: 'Tune' },
  { key: 'wave', label: 'Wave' },
  { key: 'cutoff', label: 'Cutoff' },
  { key: 'resonance', label: 'Reso' },
  { key: 'envMod', label: 'Env Mod' },
  { key: 'decay', label: 'Decay' },
  { key: 'accent', label: 'Accent' },
  { key: 'level', label: 'Level' },
]

const SEND_KNOBS: readonly { key: keyof SendLevels; label: string }[] = [
  { key: 'delay', label: 'Delay' },
  { key: 'reverb', label: 'Reverb' },
]

const FX_KNOBS: readonly {
  key: keyof FxParams
  label: string
  format: (value: number) => string
}[] = [
  { key: 'drive', label: 'Drive', format: fxFormat.drive },
  { key: 'pcfAmount', label: 'PCF', format: fxFormat.pcfAmount },
  { key: 'pcfCutoff', label: 'Cutoff', format: fxFormat.pcfCutoff },
  { key: 'pcfResonance', label: 'Reso', format: percent },
  { key: 'pcfEnv', label: 'Env', format: percent },
  { key: 'pcfDecay', label: 'Decay', format: fxFormat.pcfDecay },
  { key: 'compressor', label: 'Comp', format: fxFormat.compressor },
  { key: 'delayTime', label: 'Time', format: fxFormat.delayTime },
  { key: 'delayFeedback', label: 'F.back', format: percent },
  { key: 'delayTone', label: 'FX Tone', format: percent },
  { key: 'reverbSize', label: 'Size', format: fxFormat.reverbSize },
  { key: 'reverbDamping', label: 'Damp', format: percent },
]

interface Props {
  song: Song
  pattern: Pattern
  focus: Focus
  /** The step the 303 controls edit. Ignored by a drum machine, which edits in the grid. */
  selected: number
  bassStep: BassStep
  setVoiceParam: (voiceId: string, key: keyof VoiceParams, value: number) => void
  setBassParam: (voiceId: '303.a' | '303.b', key: keyof BassParams, value: number) => void
  setSend: (voiceId: string, key: keyof SendLevels, value: number) => void
  setVoiceSwing: (voiceId: string, value: number) => void
  setFx: (key: keyof FxParams, value: number) => void
  save: (next: Pattern, discrete?: boolean) => void
}

/**
 * The knobs: the focused instrument's own controls, its sends into the shared effects, and — on a 303 —
 * the note under the cursor.
 *
 * The mix strip is drawn from `grooveboxRouting` rather than from the focus directly, because sends and
 * swing belong to a kit entry and a drum machine has one per lane. The same strip in the same place
 * writes to a different row of the kit depending on which lane is selected above it.
 */
export function GrooveboxInstrument({
  song,
  pattern,
  focus,
  selected,
  bassStep,
  setVoiceParam,
  setBassParam,
  setSend,
  setVoiceSwing,
  setFx,
  save,
}: Props) {
  const { bass, section, voice } = focus
  const routing: Routing = grooveboxRouting(song, section, voice)
  const drumParams = drumParamsOf(song, voice)
  const bassParams = bassParamsOf(song, section)
  const fx = song.fx ?? DEFAULT_FX
  const routingVoice = routing.voiceId

  return (
    <>
      <div
        className="rk-groovebox-instrument"
        aria-label={`${bass ? sectionName(section) : voice?.name ?? sectionName(section)} instrument controls`}
      >
        {bass
          ? BASS_KNOBS.map(({ key, label }) => (
              <Knob
                key={key}
                label={label}
                value={bassParams[key]}
                colour="#ffb02e"
                format={key === 'wave' ? wave : percent}
                onChange={(value) => setBassParam(section as '303.a' | '303.b', key, value)}
              />
            ))
          : voice &&
            DRUM_KNOBS.map(({ key, label }) => (
              <Knob
                key={key}
                label={label}
                value={drumParams[key]}
                colour={routing.colour}
                format={key === 'pan' ? pan : percent}
                onChange={(value) => setVoiceParam(voice.id, key, value)}
              />
            ))}
      </div>

      {routingVoice && (
        <div className="rk-groovebox-mix" aria-label={`${routing.name} sends and shared effects`}>
          {SEND_KNOBS.map(({ key, label }) => (
            <Knob
              key={`send:${key}`}
              label={label}
              value={routing.sends[key]}
              colour={routing.colour}
              format={percent}
              onChange={(value) => setSend(routingVoice, key, value)}
            />
          ))}
          <Knob
            label="Swing"
            value={routing.swingOffset}
            colour={routing.colour}
            format={() =>
              routing.swingOffset === 0.5
                ? `· ${routing.effectiveSwing}`
                : `${routing.effectiveSwing}`
            }
            onChange={(value) => setVoiceSwing(routingVoice, value)}
          />
          {FX_KNOBS.map(({ key, label, format }) => (
            <Knob
              key={`fx:${key}`}
              label={label}
              value={fx[key]}
              colour="#9d95c8"
              format={format}
              onChange={(value) => setFx(key, value)}
            />
          ))}
        </div>
      )}

      {bass && (
        <div className="rk-groovebox-bass" aria-label={`${sectionName(section)} selected step`}>
          <strong>Step {selected + 1}</strong>
          <button
            type="button"
            aria-pressed={bassStepSounds(bassStep)}
            onClick={() =>
              save(
                setBassStep(
                  pattern,
                  section,
                  selected,
                  setBassStepGate(bassStep, !bassStepSounds(bassStep)),
                ),
              )
            }
          >
            {bassStepSounds(bassStep) ? 'Pause' : 'Note'}
          </button>
          <button
            type="button"
            disabled={bassStep.note === null || bassStep.note <= 0}
            aria-label="Lower selected note"
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  note: Math.max(0, (bassStep.note ?? 0) - 1),
                }),
              )
            }
          >
            −
          </button>
          <span className="rk-groovebox-note">{bassNoteReadout(bassStep)}</span>
          <button
            type="button"
            disabled={bassStep.note === null || bassStep.note >= 24}
            aria-label="Raise selected note"
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  note: Math.min(24, (bassStep.note ?? 0) + 1),
                }),
              )
            }
          >
            +
          </button>
          <button
            type="button"
            disabled={!bassStepSounds(bassStep)}
            aria-pressed={bassStep.accent}
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  accent: !bassStep.accent,
                }),
              )
            }
          >
            Accent
          </button>
          <button
            type="button"
            aria-pressed={bassStep.slide}
            onClick={() =>
              save(
                setBassStep(
                  pattern,
                  section,
                  selected,
                  setBassStepSlide(bassStep, !bassStep.slide),
                ),
              )
            }
          >
            Slide
          </button>
        </div>
      )}
    </>
  )
}
