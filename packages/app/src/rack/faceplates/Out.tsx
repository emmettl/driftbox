import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

// The end of the rack. Half-width, because it has one knob and taking a whole row for it would be
// the clearest possible argument against fixed-width modules.
//
// It is also the proof that the half-width path works: `layout.ts` pairs two adjacent half-width
// modules into one row, so two Outs sit side by side and a lone one leaves the other half empty.

export function Out({ def, value, onChange }: FaceplateProps) {
  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Out</span>
      </header>
      <div className="rk-controls">
        <ParamControl
          def={def.params[0]}
          value={value('level')}
          onChange={(v) => onChange('level', v)}
          colour="var(--nine)"
        />
      </div>
    </>
  )
}
