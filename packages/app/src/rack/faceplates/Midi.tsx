import { MODULES } from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import type { FaceplateProps } from './types.js'

// Hand-built for one reason: **is my keyboard connected?**
//
// That is the first question anybody has about a MIDI module, and it is the one thing a faceplate generated
// from the def could never answer — the incoming note is not a param anybody turns, it is performance state
// arriving from outside. So this one reaches into the store for it, which is also why it is the only
// faceplate that does: everything else can be drawn from `FaceplateProps` alone.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI 36 is C2 — the same C2 that 0 V means everywhere else in this rack. */
function noteName(note: number): string {
  const rounded = Math.round(note)
  return `${NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

export function Midi({ def, value, onChange }: FaceplateProps) {
  const note = useRack((s) => s.midiNote)
  const inputs = useRack((s) => s.midiInputs)
  const param = (id: string) => def.params.find((p) => p.id === id)!

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">MIDI</span>
        <span className="rk-ports">
          {note !== null ? noteName(note) : inputs.length > 0 ? 'listening' : 'no input'}
        </span>
      </header>
      <div className="rk-controls">
        {MODULES.midi.params
          .filter((p) => !p.hidden)
          .map((p) => (
            <ParamControl
              key={p.id}
              def={param(p.id)}
              value={value(p.id)}
              onChange={(next) => onChange(p.id, next)}
              colour={p.id === 'transpose' ? 'var(--eight)' : undefined}
              // Omni is 0, which reads better as a word than as a number.
              options={p.id === 'channel' ? ['Omni', ...Array.from({ length: 16 }, (_, i) => String(i + 1))] : undefined}
            />
          ))}
      </div>
    </>
  )
}
