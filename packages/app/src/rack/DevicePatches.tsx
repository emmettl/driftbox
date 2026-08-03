import { completeParams, devicePatchesFor, type ModuleDef } from '@driftbox/rack'
import { useMemo, useState } from 'react'
import {
  deleteDevicePatch,
  freshDevicePatchName,
  listDevicePatches,
  saveDevicePatch,
} from './device-library.js'
import { useRack } from './store.js'

// The patch browser in the corner of a device: a name, two arrows, a list and a way to keep one.
//
// **Rendered by the Chassis rather than by each faceplate**, which is the bargain `layout.ts` strikes for
// the back panel and the Chassis already strikes for the drag grip. Every device gets a browser —
// including the eleven hand-built panels, and including a module this build has never seen — and nobody
// had to add one. Asking each faceplate to wire up its own would have quietly broken the generic
// fallback, which is the one that matters most.
//
// **Which patch you are on is derived from the knobs, never remembered.** The alternative — store the
// last patch you loaded and show its name — starts lying the moment anybody touches a knob, and a panel
// that disagrees with what is coming out of it is the failure this whole app keeps designing away from.
// Comparing the settings is cheap at this size, always true, and it gives "Custom" a meaning: you have
// moved away from every saved setting, which is exactly when the save button is worth having.

interface Props {
  moduleId: string
  def: ModuleDef
}

/** Whether two complete param sets are the same settings. Both come from `completeParams`, so the keys match. */
function same(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

export function DevicePatches({ moduleId, def }: Props) {
  const loadDevicePatch = useRack((s) => s.loadDevicePatch)
  const devicePatchOf = useRack((s) => s.devicePatchOf)
  // The params object itself, so this re-renders when a knob moves and the name stops claiming to be a
  // preset. Reference-stable while nothing changes, which keeps unrelated edits from re-rendering it.
  const params = useRack((s) => s.patch.modules.find((m) => m.id === moduleId)?.params)

  // Read once and re-read on save and on delete. `localStorage` is not reactive, and the user shelf has
  // no business being mirrored into the document store — these are settings, not part of the patch.
  //
  // The list itself rather than a counter that invalidates a memo: it makes the dependency honest, and a
  // read at mount is correct because a module's type never changes for a given id — the Chassis keys
  // these by module id, and the patch format has no way to retype a module in place.
  const [saved, setSaved] = useState(() => listDevicePatches(def.type))
  const [naming, setNaming] = useState<string | null>(null)

  const factory = useMemo(() => devicePatchesFor(def), [def])
  const bank = useMemo(() => [...factory, ...saved], [factory, saved])
  const current = useMemo(() => completeParams(def, params), [def, params])

  const at = bank.findIndex((patch) => same(patch.params, current))
  const mine = at >= 0 ? bank[at] : undefined
  // Only a patch you saved can be deleted. Settings that happen to equal the defaults match Init instead,
  // because the factory bank comes first — so the minus button cannot appear over a factory row.
  const deletable = mine !== undefined && at >= factory.length

  // A device with nothing to turn — the Noise, the Sample & Hold — gets no browser. A bank for a device
  // with no knobs is furniture. After the hooks, so the order never changes between renders.
  if (def.params.every((param) => param.hidden)) return null

  const step = (by: number) => {
    if (bank.length === 0) return
    // From Custom, forward starts at the top of the bank and back starts at the end — rather than doing
    // nothing, which is what an index of −1 gives arithmetically.
    const next = at < 0 ? (by > 0 ? 0 : bank.length - 1) : (at + by + bank.length) % bank.length
    loadDevicePatch(moduleId, bank[next])
  }

  const keep = (name: string) => {
    // Read fresh from the store rather than from `current`: this runs on a click, and the click is the
    // moment whose settings you meant to keep.
    const settings = devicePatchOf(moduleId)
    if (settings) saveDevicePatch(def.type, name, settings)
    setSaved(listDevicePatches(def.type))
    setNaming(null)
  }

  return (
    // The Chassis selects a module on pointerdown anywhere in it, and the grip above starts a drag.
    // Neither is what pressing a button in here means.
    <div className="rk-device-patches" onPointerDown={(event) => event.stopPropagation()}>
      {naming === null ? (
        <>
          <button
            type="button"
            className="rk-device-step"
            aria-label={`Previous ${def.name} patch`}
            title="Previous patch"
            onClick={() => step(-1)}
          >
            ‹
          </button>
          {/* A native select rather than a popover: keyboard-accessible for nothing, correct on a
              touchscreen, and it does not need to know where the rack has been scrolled to. */}
          <select
            className="rk-device-name"
            aria-label={`${def.name} patch`}
            value={at < 0 ? '' : String(at)}
            onChange={(event) => {
              const index = Number(event.target.value)
              if (Number.isInteger(index) && bank[index]) loadDevicePatch(moduleId, bank[index])
            }}
          >
            {at < 0 && (
              // Offered only while it is true. A permanent "Custom" row would be a thing you could
              // choose, and there is nothing for choosing it to do.
              <option value="">Custom</option>
            )}
            {bank.map((patch, index) => (
              <option key={`${patch.type}/${patch.id}`} value={String(index)}>
                {patch.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rk-device-step"
            aria-label={`Next ${def.name} patch`}
            title="Next patch"
            onClick={() => step(1)}
          >
            ›
          </button>
          <button
            type="button"
            className="rk-device-keep"
            aria-label={`Save these ${def.name} settings`}
            title="Save these settings"
            onClick={() => setNaming(freshDevicePatchName(def.type, mine?.name ?? def.name))}
          >
            +
          </button>
          {deletable && (
            <button
              type="button"
              className="rk-device-keep"
              aria-label={`Delete the ${def.name} patch ${mine.name}`}
              title={`Delete ${mine.name}`}
              onClick={() => {
                deleteDevicePatch(def.type, mine.id)
                setSaved(listDevicePatches(def.type))
              }}
            >
              −
            </button>
          )}
        </>
      ) : (
        <>
          <input
            className="rk-device-naming"
            aria-label={`Name for these ${def.name} settings`}
            value={naming}
            autoFocus
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => {
              // Stopped here rather than left to bubble: the rack binds Delete and Backspace to removing
              // the selected module, and typing a name is not an attempt to delete anything.
              event.stopPropagation()
              if (event.key === 'Enter') keep(naming)
              if (event.key === 'Escape') setNaming(null)
            }}
          />
          <button
            type="button"
            className="rk-device-keep"
            aria-label="Keep these settings"
            onClick={() => keep(naming)}
          >
            ✓
          </button>
          <button
            type="button"
            className="rk-device-keep"
            aria-label="Cancel saving these settings"
            onClick={() => setNaming(null)}
          >
            ✕
          </button>
        </>
      )}
    </div>
  )
}
