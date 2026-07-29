import { voiceById, type VoiceParams } from '../engine'
import { useBox } from '../store'
import { Knob } from './Knob'
import { VoiceWaveform } from './VoiceWaveform'

// The channel strip for whichever voice is selected. Six knobs, the same six on every
// voice, because a consistent panel is worth more than a bespoke one per instrument —
// you learn where "decay" is once.

const KNOBS: { key: keyof VoiceParams; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'tune', label: 'Tune' },
  { key: 'decay', label: 'Decay' },
  { key: 'tone', label: 'Tone' },
  { key: 'colour', label: 'Colour' },
  { key: 'pan', label: 'Pan' },
]

const percent = (v: number) => `${Math.round(v * 100)}`
const bipolar = (v: number) => {
  const n = Math.round((v - 0.5) * 200)
  return n === 0 ? 'C' : n < 0 ? `L${-n}` : `R${n}`
}

export function VoicePanel() {
  const selectedVoice = useBox((s) => s.selectedVoice)
  const song = useBox((s) => s.song)
  const setParam = useBox((s) => s.setParam)
  const audition = useBox((s) => s.audition)

  const voice = voiceById(selectedVoice)
  const params = song.kit.params[selectedVoice]
  if (!voice || !params) return null

  const accent = voice.machine === 'tr909' ? '#5ff0d0' : '#ff7ad9'

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <span className="panel-machine" style={{ color: accent }}>
            {voice.machine === 'tr909' ? 'TR-909' : 'TR-808'}
          </span>
          <h2>{voice.name}</h2>
        </div>
        <button className="audition" onClick={() => audition(voice.id)}>
          hit it
        </button>
      </header>

      <VoiceWaveform voice={voice} params={params} colour={accent} />

      <div className="knobs">
        {KNOBS.map(({ key, label }) => (
          <Knob
            key={key}
            label={label}
            colour={accent}
            value={params[key]}
            format={key === 'pan' ? bipolar : percent}
            onChange={(value) => setParam(voice.id, key, value)}
          />
        ))}
      </div>
    </section>
  )
}
