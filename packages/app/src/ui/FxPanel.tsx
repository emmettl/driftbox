import { DEFAULT_FX, delayDivision, type FxParams } from '@driftbox/engine'
import { useBox } from '../store'
import { Knob } from './Knob'

// The two effects themselves. One panel for the whole song rather than one per voice,
// because these are sends: the per-voice knobs decide how much of each voice arrives,
// and this decides what it arrives in.

const KNOBS: { key: keyof FxParams; label: string; format: (v: number) => string }[] = [
  // Shown in steps rather than as a percentage, because the value is snapped to musical
  // divisions and a knob reading "62" would hide that entirely.
  { key: 'delayTime', label: 'Time', format: (v) => `${delayDivision(v)}/16` },
  { key: 'delayFeedback', label: 'F.back', format: (v) => `${Math.round(v * 100)}` },
  { key: 'delayTone', label: 'Tone', format: (v) => `${Math.round(v * 100)}` },
  { key: 'reverbSize', label: 'Size', format: (v) => `${(0.3 + v * 3.5).toFixed(1)}s` },
  { key: 'reverbDamping', label: 'Damp', format: (v) => `${Math.round(v * 100)}` },
]

const COLOUR = '#9d95c8'

export function FxPanel() {
  const fx = useBox((s) => s.song.fx) ?? DEFAULT_FX
  const setFx = useBox((s) => s.setFx)

  return (
    <section className="scope fx">
      <header>
        <h3>Delay · Reverb</h3>
      </header>
      <div className="knobs fx-knobs">
        {KNOBS.map(({ key, label, format }) => (
          <Knob
            key={key}
            label={label}
            colour={COLOUR}
            value={fx[key]}
            format={format}
            onChange={(value) => setFx(key, value)}
          />
        ))}
      </div>
    </section>
  )
}
