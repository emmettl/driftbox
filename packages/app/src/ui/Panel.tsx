import type { ReactNode } from 'react'
import { useBox } from '../store'

// A panel that folds away, and remembers.
//
// One component rather than a collapse toggle bolted onto each section, because the
// moment they differ — one animating, one not, one remembering, one not — the console
// stops feeling like one object. The state is keyed by id and kept out of the Song: which
// panels you have open is a property of your screen, not of the music, and it must not
// travel in a shared link.

interface Props {
  /** Stable key for remembering the folded state. Changing it forgets. */
  id: string
  title: ReactNode
  /** Shown in the header, to the right of the title — the scope's wave/xy switch. */
  aside?: ReactNode
  className?: string
  children: ReactNode
}

export function Panel({ id, title, aside, className = '', children }: Props) {
  const collapsed = useBox((s) => s.collapsed[id] ?? false)
  const toggleCollapsed = useBox((s) => s.toggleCollapsed)

  return (
    <section className={`fold ${className}${collapsed ? ' collapsed' : ''}`}>
      <header className="fold-head">
        <button
          className="fold-toggle"
          onClick={() => toggleCollapsed(id)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show' : 'Hide'}
        >
          <span className="fold-chevron">▾</span>
          <h3>{title}</h3>
        </button>
        {/* Outside the toggle button, or clicking the scope's wave/xy switch would also
            fold the panel it lives in. */}
        {aside && <div className="fold-aside">{aside}</div>}
      </header>

      {/* Unmounted rather than hidden when folded. These panels each run an animation
          frame loop — the scope, the voice waveform — and a hidden panel still drawing
          sixty times a second is exactly the cost somebody folded it away to avoid. */}
      {!collapsed && <div className="fold-body">{children}</div>}
    </section>
  )
}
