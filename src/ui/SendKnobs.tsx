import { DEFAULT_SENDS, type SendLevels } from '../engine'
import { useBox } from '../store'
import { Knob } from './Knob'

// The two send knobs, shared by the drum channel strip and the 303 one — the routing is
// identical for both, and a voice is a voice as far as a send is concerned.
//
// Kept visually separate from the knobs above them, because they are a different kind of
// control: everything else on a channel strip changes what the voice sounds like, and
// these two change where it goes.

const SENDS: { key: keyof SendLevels; label: string }[] = [
  { key: 'delay', label: 'Delay' },
  { key: 'reverb', label: 'Reverb' },
]

const percent = (v: number) => `${Math.round(v * 100)}`

export function SendKnobs({ voiceId, colour }: { voiceId: string; colour: string }) {
  const sends = useBox((s) => s.song.kit.sends?.[voiceId]) ?? DEFAULT_SENDS
  const setSend = useBox((s) => s.setSend)

  return (
    <div className="sends">
      <span className="sends-label">Sends</span>
      <div className="knobs">
        {SENDS.map(({ key, label }) => (
          <Knob
            key={key}
            label={label}
            colour={colour}
            value={sends[key]}
            format={percent}
            onChange={(value) => setSend(voiceId, key, value)}
          />
        ))}
      </div>
    </div>
  )
}
