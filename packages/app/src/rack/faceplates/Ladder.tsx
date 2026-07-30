import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

// The 303's filter, and the only module in the rack whose front panel says where it came from.
//
// Hand-built for one reason: the resonance knob deserves a warning. Past about three quarters this
// filter self-oscillates — that is the squelch, it is the whole point of it being a ladder rather than
// the SVF next to it, and it also means the module makes sound with nothing patched in. A generic
// faceplate would give you a knob called "Res" and no hint that the top of it is a different
// instrument.

export function Ladder({ def, value, onChange, routed }: FaceplateProps) {
  const param = (id: string) => def.params.find((p) => p.id === id)!
  const resonance = value('resonance')

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Ladder</span>
        <span className="rk-ports">{resonance > 0.75 ? 'squelch' : '4-pole'}</span>
      </header>
      <div className="rk-controls">
        <ParamControl
          def={param('cutoff')}
          value={value('cutoff')}
          onChange={(v) => onChange('cutoff', v)}
          colour="var(--three)"
          routed={routed?.('cutoff')}
        />
        <ParamControl
          def={param('resonance')}
          value={resonance}
          onChange={(v) => onChange('resonance', v)}
          colour={resonance > 0.75 ? 'var(--eight)' : 'var(--three)'}
          routed={routed?.('resonance')}
        />
      </div>
    </>
  )
}
