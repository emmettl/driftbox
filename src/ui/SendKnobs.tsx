import { DEFAULT_SENDS, swingFor, type SendLevels } from '../engine'
import { useBox } from '../store'
import { Knob } from './Knob'

// The bottom half of a channel strip, shared by the drums and the 303s. Everything above
// it changes what a voice sounds like; these three change where it goes and when it
// lands, which is why they are divided off rather than being three more knobs.

const SENDS: { key: keyof SendLevels; label: string }[] = [
  { key: 'delay', label: 'Delay' },
  { key: 'reverb', label: 'Reverb' },
]

const percent = (v: number) => `${Math.round(v * 100)}`

export function SendKnobs({ voiceId, colour }: { voiceId: string; colour: string }) {
  const song = useBox((s) => s.song)
  const setSend = useBox((s) => s.setSend)
  const setVoiceSwing = useBox((s) => s.setVoiceSwing)

  const sends = song.kit.sends?.[voiceId] ?? DEFAULT_SENDS
  // Centred: 0.5 is "however the song swings". Knob already resets to 0.5 on a double
  // click, so going back to following the song is a gesture people already have.
  const swingOffset = song.kit.swing?.[voiceId] ?? 0.5
  const effective = Math.round(swingFor(song, voiceId) * 100)

  return (
    <div className="sends">
      <span className="sends-label">Out</span>
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
        <Knob
          label="Swing"
          colour={colour}
          value={swingOffset}
          // Shows where the voice actually ends up rather than the offset, because the
          // useful question is "how much does this shuffle", not "how far from the song".
          // A dot marks the voice sitting exactly where the song does.
          format={() => (swingOffset === 0.5 ? `· ${effective}` : `${effective}`)}
          onChange={(value) => setVoiceSwing(voiceId, value)}
        />
      </div>
    </div>
  )
}
