import {
  DEFAULT_FX,
  delayDivision,
  pcfDecaySeconds,
  pcfFrequency,
  type FxParams,
} from '@driftbox/engine'
import { useBox } from '../store'
import { Knob } from './Knob'
import { Panel } from './Panel'

// The song-wide effect path: authored inserts first, then the two shared sends. One panel
// because this is the part of the instrument every voice meets in common.

const KNOBS: { key: keyof FxParams; label: string; format: (v: number) => string }[] = [
  { key: 'drive', label: 'Drive', format: (v) => (v === 0 ? 'clean' : `${Math.round(v * 100)}`) },
  { key: 'pcfAmount', label: 'PCF', format: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}`) },
  { key: 'pcfCutoff', label: 'Cutoff', format: (v) => `${Math.round(pcfFrequency(v))}Hz` },
  { key: 'pcfResonance', label: 'Reso', format: (v) => `${Math.round(v * 100)}` },
  { key: 'pcfEnv', label: 'Env', format: (v) => `${Math.round(v * 100)}` },
  { key: 'pcfDecay', label: 'Decay', format: (v) => `${Math.round(pcfDecaySeconds(v) * 1000)}ms` },
  { key: 'compressor', label: 'Comp', format: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}`) },
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
    <Panel id="fx" className="scope fx" title="Master FX · Sends">
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
    </Panel>
  )
}
