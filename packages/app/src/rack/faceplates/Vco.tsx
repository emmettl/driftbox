import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

// A hand-built faceplate, and the demonstration of what hand-building buys.
//
// Against the generic version: the shape selector is named rather than numbered, the tune knob is the
// big one because it is the one you reach for, and the pulse width is dimmed when the shape is not a
// pulse — because a knob that does nothing should say so. None of that could be derived from the def,
// and all of it is the reason the registry has an escape hatch.

const SHAPES = ['Saw', 'Pulse', 'Tri'] as const

export function Vco({ def, value, onChange, routed }: FaceplateProps) {
  const param = (id: string) => def.params.find((p) => p.id === id)!
  const shape = Math.round(value('shape'))

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">VCO</span>
        <span className="rk-ports">{SHAPES[shape] ?? '—'}</span>
      </header>
      <div className="rk-controls rk-controls-vco">
        <div className="rk-big">
          <ParamControl
            def={param('tune')}
            value={value('tune')}
            onChange={(v) => onChange('tune', v)}
            colour="var(--three)"
            routed={routed?.('tune')}
          />
        </div>
        {/* The shape names live on the def now rather than here, so the generic faceplate shows them
            too — see `ParamDef.labels`. This faceplate keeps the emphasis and the dimming. */}
        <ParamControl
          def={param('shape')}
          value={value('shape')}
          onChange={(v) => onChange('shape', v)}
        />
        <div className={shape === 1 ? undefined : 'rk-inactive'}>
          <ParamControl
            def={param('width')}
            value={value('width')}
            onChange={(v) => onChange('width', v)}
            colour="var(--three)"
            routed={routed?.('width')}
          />
        </div>
      </div>
    </>
  )
}
