import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

// The faceplate a module gets when nobody has drawn it one.
//
// Everything here comes from the def and nothing from a table of special cases, so it cannot fall out
// of step with the module it is describing — a param added to a def appears here on the next render,
// and a module type this build has never seen still arrives with something you can turn.
//
// It is meant to look plain rather than unfinished. A hand-built faceplate should be recognisably
// nicer; a generic one should not look broken.

export function Generic({ def, value, onChange }: FaceplateProps) {
  return (
    <>
      <header className="rk-title">
        <span className="rk-name">{def.name}</span>
        <span className="rk-ports">
          {def.inlets.length} in · {def.outlets.length} out
        </span>
      </header>
      {def.params.length > 0 && (
        <div className="rk-controls">
          {def.params.map((param) => (
            <ParamControl
              key={param.id}
              def={param}
              value={value(param.id)}
              onChange={(next) => onChange(param.id, next)}
            />
          ))}
        </div>
      )}
    </>
  )
}
