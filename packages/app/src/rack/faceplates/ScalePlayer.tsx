import { ParamControl } from '../ParamControl.js'
import { useRack } from '../store.js'
import { scalePlayerMask } from './scale-player-display.js'
import type { FaceplateProps } from './types.js'

const IDS = ['key', 'scale', 'filter'] as const
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK = new Set([1, 3, 6, 8, 10])

// The generic panel can select a key and scale, but it cannot show what either means. Scale Map turns the
// twelve pitch classes into the editor: presets are visible immediately, and clicking one makes an editable
// Custom copy without a mode switch or dialog. The mask remains PatchModule data and every declared param
// still uses ParamControl, so display and playback share one contract.
export function ScalePlayer({ def, module, value, onChange, routed }: FaceplateProps) {
  const setData = useRack((state) => state.setData)
  const key = Math.max(0, Math.min(11, Math.round(value('key'))))
  const scale = Math.max(0, Math.min(13, Math.round(value('scale'))))
  const filtering = Math.round(value('filter')) === 1
  const custom = module.data?.customScale ?? []
  const mask = scalePlayerMask(scale, custom)
  const count = mask.reduce((total, enabled) => total + (enabled >= 0.5 ? 1 : 0), 0)
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!
  const scaleName = param('scale').labels?.[scale] ?? `Scale ${scale + 1}`

  const toggle = (note: number) => {
    if (mask[note] >= 0.5 && count <= 1) return
    const next = [...mask]
    next[note] = next[note] >= 0.5 ? 0 : 1
    setData(module.id, 'customScale', next)
    if (scale !== 13) onChange('scale', 13)
  }

  return (
    <>
      <header className="rk-title rk-scale-title">
        <span className="rk-name">Scale Map</span>
        <span className="rk-scale-model">SP—13</span>
        <span className="rk-scale-readout">
          {NOTES[key]} {scaleName} · {filtering ? 'filter' : 'correct'}
        </span>
      </header>

      <div className="rk-scale-display" data-routed={routed?.('scale') ? 'yes' : undefined}>
        <div className="rk-scale-keyboard" role="group" aria-label="Scale notes">
          {mask.map((enabled, relative) => {
            const actual = (key + relative) % 12
            const name = NOTES[actual]
            const included = enabled >= 0.5
            const description = `${name} ${included ? 'included in' : 'excluded from'} ${NOTES[key]} ${scaleName}`
            return (
              <button
                key={relative}
                type="button"
                className="rk-scale-key"
                data-black={BLACK.has(actual) ? 'yes' : 'no'}
                data-enabled={included ? 'yes' : 'no'}
                aria-pressed={included}
                aria-label={description}
                title={`${description}; click to edit a Custom scale`}
                onClick={() => toggle(relative)}
              >
                <span>{name}</span>
                {relative === 0 && <i>root</i>}
              </button>
            )
          })}
        </div>
        <div className="rk-scale-legend">
          <span>{count} notes</span>
          <strong>{scale === 13 ? 'custom map' : 'click a key to customise'}</strong>
          <span>{filtering ? 'wrong notes silent' : 'nearest note · ties down'}</span>
        </div>
      </div>

      <div className="rk-scale-controls">
        {IDS.map((id) => (
          <ParamControl
            key={id}
            def={param(id)}
            value={value(id)}
            onChange={(next) => onChange(id, next)}
            colour={id === 'key' ? 'var(--three)' : id === 'scale' ? 'var(--nine)' : undefined}
            routed={routed?.(id)}
          />
        ))}
      </div>
    </>
  )
}
