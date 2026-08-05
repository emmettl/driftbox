import { useEffect, useRef, useState } from 'react'

// What the rack can do to a module, as opposed to what the module does: move it, take it out of circuit,
// copy it, remove it.
//
// **Behind a disclosure, because the corner it lives in is already full.** These five buttons and the
// device patch browser were both anchored to the top-right of the faceplate, one on top of the other — so
// selecting a module covered its own patch browser, and on a half-width panel it covered the port readout
// and the name as well. Sitting them side by side is not available: the tools are 130 design units wide
// and the browser is 168, which is more than the 214 a half-width title strip has in total before the name
// and the readout have taken any of it. Something had to give, and it is the thing you touch least.
//
// The same bargain `HeaderMenu` records for Export, for the same reason and with the same reservation: a
// disclosure is a cost, and it is worth paying only where the alternative is worse. Here the alternative
// was a corner where two controls fought and one always lost.
//
// **The panel drops over the faceplate rather than over the browser.** It is open only while you are using
// it, and covering a knob for that moment is cheaper than covering the browser permanently — which is the
// bug this replaced. It stays inside the module, which is why it is a row of five and not a list: the
// shortest module in the rack is 120 units tall, and a stacked menu would be clipped by the faceplate it
// belongs to.

interface Props {
  bypassed: boolean
  /** How many modules Remove would take. More than one when this module is part of a selected group. */
  group: number
  onMove: (by: number) => void
  onBypass: () => void
  onDuplicate: () => void
  onRemove: () => void
}

export function ModuleTools({ bypassed, group, onMove, onBypass, onDuplicate, onRemove }: Props) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Capture, and stopped here: Escape in the rack cancels an armed cable, and shutting this must not
      // also undo a patch somebody was halfway through making behind it. `HeaderMenu` learned the same.
      event.stopImmediatePropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    const onOutside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onOutside)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onOutside)
    }
  }, [open])

  return (
    <div
      className="rk-module-tools"
      ref={wrap}
      // The section beneath selects on pointerdown, so without this a click on Remove first collapsed the
      // group to this one module and then removed only it — while the button still said "Remove 4
      // modules", because the label was decided at render and the action read the store afterwards.
      // Operating a module's own tools is not a selection gesture.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        className="rk-module-tools-trigger"
        aria-expanded={open}
        aria-label="Module tools"
        title="Move, bypass, duplicate, remove"
        onClick={() => setOpen((shut) => !shut)}
      >
        ⋯
      </button>
      {open && (
        <div className="rk-module-tools-panel">
          <button type="button" onClick={() => { onMove(-1); setOpen(false) }} aria-label="Move up">
            ↑
          </button>
          <button type="button" onClick={() => { onMove(1); setOpen(false) }} aria-label="Move down">
            ↓
          </button>
          {/* The one button that leaves the panel open. Half of why anybody bypasses something is to
              compare it against itself, and a toggle you have to reopen the menu to undo cannot do that. */}
          <button
            type="button"
            onClick={onBypass}
            aria-label="Bypass"
            aria-pressed={bypassed}
            title="Bypass — out of circuit, its input passed straight through"
          >
            ⏻
          </button>
          {/* Next to Remove rather than next to the arrows: both of these change what is in the rack,
              while the arrows only change where it sits. */}
          <button
            type="button"
            onClick={() => { onDuplicate(); setOpen(false) }}
            aria-label="Duplicate"
            title="Duplicate — a copy with the same settings, unpatched"
          >
            ⧉
          </button>
          {/* Removes the whole group when this module is part of one — in one edit, so four modules are one
              undo rather than four. The label says how many, because a button that quietly took four things
              away when you expected one is the worst kind of surprise. */}
          <button
            type="button"
            onClick={() => { onRemove(); setOpen(false) }}
            aria-label={group > 1 ? `Remove ${group} modules` : 'Remove'}
            title={group > 1 ? `Remove all ${group} selected` : undefined}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
