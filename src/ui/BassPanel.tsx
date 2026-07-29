import { BASS_VOICES, DEFAULT_BASS_PARAMS, type BassParams } from '../engine'
import { useBox } from '../store'
import { Knob } from './Knob'
import { SendKnobs } from './SendKnobs'

// The 303's channel strip. Different knobs from a drum voice's, because a 303 is a
// synthesiser rather than a drum: the six that matter are the ones on the front of the
// machine, and cutoff / resonance / env mod are three of them.

const KNOBS: { key: keyof BassParams; label: string }[] = [
  { key: 'tune', label: 'Tune' },
  { key: 'wave', label: 'Wave' },
  { key: 'cutoff', label: 'Cutoff' },
  { key: 'resonance', label: 'Reso' },
  { key: 'envMod', label: 'Env Mod' },
  { key: 'decay', label: 'Decay' },
  { key: 'accent', label: 'Accent' },
  { key: 'level', label: 'Level' },
]

const percent = (v: number) => `${Math.round(v * 100)}`
const wave = (v: number) => (v < 0.5 ? 'saw' : 'sqr')

const ACCENT = '#ffb02e'

export function BassPanel() {
  const selectedBass = useBox((s) => s.selectedBass)
  const song = useBox((s) => s.song)
  const setBassParam = useBox((s) => s.setBassParam)
  const selectBass = useBox((s) => s.selectBass)
  const usingLadder = useBox((s) => s.engine?.usingLadder)

  const voice = BASS_VOICES.find((v) => v.id === selectedBass) ?? BASS_VOICES[0]
  const params = song.kit.bass?.[voice.id] ?? DEFAULT_BASS_PARAMS

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <span className="panel-machine" style={{ color: ACCENT }}>
            TB-303
          </span>
          <h2>{voice.name}</h2>
        </div>
        <div className="bass-pick">
          {BASS_VOICES.map((v) => (
            <button
              key={v.id}
              className={v.id === voice.id ? 'on' : ''}
              onClick={() => selectBass(v.id)}
            >
              {v.id.slice(-1).toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Only shown when the fallback is in use. "The basslines sound tame" has exactly
          one likely cause, and it should not take a debugging session to find it. */}
      {usingLadder === false && (
        <p className="panel-note">
          No AudioWorklet here — the 303s are running a two-pole biquad instead of the
          ladder, so they sweep but do not squelch.
        </p>
      )}

      <div className="knobs bass-knobs">
        {KNOBS.map(({ key, label }) => (
          <Knob
            key={key}
            label={label}
            colour={ACCENT}
            value={params[key]}
            format={key === 'wave' ? wave : percent}
            onChange={(value) => setBassParam(voice.id, key, value)}
          />
        ))}
      </div>

      <SendKnobs voiceId={voice.id} colour={ACCENT} />
    </section>
  )
}
