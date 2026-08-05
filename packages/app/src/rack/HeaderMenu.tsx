import { useEffect, useRef, useState, type ReactNode } from 'react'

// One header button that opens a short list of related ones.
//
// **Used once, for the five ways of getting something out of the rack**, and the count is the argument.
// Copy link, Patch WAV, Patch stems, Song WAV and Song stems are five controls somebody touches at the end
// of a session, sitting in the same row and the same shape as Play — so a quarter of the toolbar was
// permanently spent on the rarest quarter of the work, and every scan for Automation had to read past all
// of it. Behind one named button they are easier to find rather than harder: "Export" says what they are
// for, which five separate labels never did.
//
// **Nothing else in this header goes in one.** A disclosure is a cost — one more press, and a thing that
// can be open or shut — and it is worth paying only where the alternative is worse. Play, Add module and
// Back are not, and a "View" menu holding one button would be pure ceremony.
//
// A disclosure rather than `role="menu"`, deliberately. A menu role promises arrow-key navigation and a
// particular focus contract; what this is is a button that reveals more buttons, and saying so leaves the
// browser's own tab order — which already works — in charge.

interface Props {
  /** The trigger's label. Callers pass progress text through it, so a running render stays visible shut. */
  label: string
  title?: string
  children: ReactNode
}

export function HeaderMenu({ label, title, children }: Props) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Capture, and stopped here: Escape in the rack cancels an armed cable, and shutting a menu must
      // not also undo the patch somebody was halfway through making behind it.
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
    <span className="rk-menu" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((shut) => !shut)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="rk-menu-panel"
          // Closed by anything inside it that actually did something. Delegated rather than wrapped round
          // each child's handler, so a caller adds an action without having to remember to shut the menu —
          // and a disabled one does not close it, because nothing happened.
          onClick={(event) => {
            const button = (event.target as HTMLElement).closest('button')
            if (button && !button.disabled) setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </span>
  )
}
