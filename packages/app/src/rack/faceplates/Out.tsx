import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

// The end of the rack. Half-width, because it has two knobs and taking a whole row for them would be
// the clearest possible argument against fixed-width modules.
//
// It is also the proof that the half-width path works: `layout.ts` pairs two adjacent half-width
// modules into one row, so two Outs sit side by side and a lone one leaves the other half empty.
//
// **A hand-built faceplate does not follow its def.** Pan was added to `OUT_MODULE` and did not appear
// here, because this file names its params rather than walking them — which is the whole point of the
// escape hatch and also its one hazard. `faceplates.test.ts` now checks that every param a hand-built
// faceplate's module declares is actually reachable, so the next one fails a test instead of going
// missing.

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
        {/* Pan is applied by the Graph, not by the Out's processor — a module's outlets are mono. See the
            note at the top of `modules/out.ts`. */}
        <ParamControl
          def={def.params[1]}
          value={value('pan')}
          onChange={(v) => onChange('pan', v)}
          colour="var(--eight)"
        />
      </div>
    </>
  )
}
