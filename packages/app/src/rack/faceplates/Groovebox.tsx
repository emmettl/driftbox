import { GROOVEBOX_SECTIONS } from '@driftbox/engine'
import { GROOVEBOX_PORTS } from '@driftbox/rack'
import { ParamControl } from '../ParamControl.js'
import type { FaceplateProps } from './types.js'

const sectionName = (section: (typeof GROOVEBOX_SECTIONS)[number]): string =>
  section === 'tr808'
    ? '808'
    : section === 'tr909'
      ? '909'
      : section === '303.a'
        ? '303 A'
        : '303 B'

/**
 * Four source strips for the authored machines retained inside a rack document.
 *
 * These controls deliberately belong to the derived Groovebox device rather than to a
 * second copy of the sequencer. Their unity defaults leave the original song untouched;
 * once a section is patched, the strip shapes the ordinary stereo rack signal.
 */
export function Groovebox({ def, value, onChange, routed }: FaceplateProps) {
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Groovebox</span>
        <span className="rk-ports">4 stereo sources</span>
      </header>
      <div className="rk-groovebox-strips">
        {GROOVEBOX_SECTIONS.map((section) => {
          const ports = GROOVEBOX_PORTS[section]
          const name = sectionName(section)
          return (
            <section
              className="rk-groovebox-strip"
              aria-label={`${name} source strip`}
              key={section}
            >
              <strong>{name}</strong>
              <ParamControl
                def={param(ports.level)}
                value={value(ports.level)}
                onChange={(next) => onChange(ports.level, next)}
                colour="var(--nine)"
                routed={routed?.(ports.level)}
              />
              <ParamControl
                def={param(ports.pan)}
                value={value(ports.pan)}
                onChange={(next) => onChange(ports.pan, next)}
                colour="var(--eight)"
                routed={routed?.(ports.pan)}
              />
              <ParamControl
                def={param(ports.mute)}
                value={value(ports.mute)}
                onChange={(next) => onChange(ports.mute, next)}
                routed={routed?.(ports.mute)}
              />
            </section>
          )
        })}
      </div>
    </>
  )
}
