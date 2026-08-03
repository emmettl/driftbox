import { useEffect, useId, useRef, type ReactNode } from 'react'
import './HelpDialog.css'

type HelpSurface = 'groovebox' | 'rack'

interface HelpDialogProps {
  surface: HelpSurface
  onClose: () => void
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Shortcut({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <li>
      <kbd>{keys}</kbd>
      <span>{children}</span>
    </li>
  )
}

function GrooveboxHelp() {
  return (
    <>
      <HelpSection title="Make a beat">
        <ol className="help-steps">
          <li><strong>Press play.</strong> Pick 808, 909, or 303 in the top bar.</li>
          <li><strong>Choose a pattern,</strong> then click steps to switch notes on. Drag across a drum row to paint.</li>
          <li><strong>Build the song.</strong> The + at the end of the Song strip adds the pattern you are editing.</li>
        </ol>
      </HelpSection>

      <HelpSection title="Gestures that are easy to miss">
        <dl className="help-definitions">
          <div><dt>Drum steps</dt><dd>Click to cycle off, normal, and accent. Drag to paint or erase.</dd></div>
          <div><dt>303 notes</dt><dd>Click a note cell to add it; drag vertically to change pitch. Accent and slide have their own rows.</dd></div>
          <div><dt>Knobs</dt><dd>Drag vertically. Double-click a knob to return it to the midpoint.</dd></div>
          <div><dt>Automation</dt><dd>Arm auto, start playback, then move a supported control. Clear auto removes every recorded lane.</dd></div>
        </dl>
      </HelpSection>

      <HelpSection title="The other views">
        <dl className="help-definitions">
          <div><dt>Vibes</dt><dd>Full-screen visuals and a filter pad. Drag anywhere; use edit to return.</dd></div>
          <div><dt>Keys</dt><dd>Play either 303—or a selected pitched drum—from the on-screen or computer keyboard.</dd></div>
          <div><dt>Rack</dt><dd>Opens the complete song as sources in the modular rack, ready for patching and processing.</dd></div>
        </dl>
      </HelpSection>

      <HelpSection title="Keyboard">
        <ul className="help-shortcuts">
          <Shortcut keys="Space">Play or stop</Shortcut>
          <Shortcut keys="V">Open or leave Vibes</Shortcut>
          <Shortcut keys="C">Change the visual scene</Shortcut>
          <Shortcut keys="X">Change the scope</Shortcut>
          <Shortcut keys="A–K">Play the visible keyboard</Shortcut>
          <Shortcut keys="Z / X">Keyboard octave down / up</Shortcut>
          <Shortcut keys="?">Open this guide</Shortcut>
        </ul>
      </HelpSection>
    </>
  )
}

function RackHelp() {
  return (
    <>
      <HelpSection title="Patch something">
        <ol className="help-steps">
          <li><strong>Start audio,</strong> then add a module or open a complete patch from Patches.</li>
          <li><strong>Turn the rack around.</strong> Outputs and inputs live on the back.</li>
          <li><strong>Drag from one jack to another.</strong> A cable runs from an output to an input; × beside an input unplugs it.</li>
        </ol>
      </HelpSection>

      <HelpSection title="How the rack behaves">
        <dl className="help-definitions">
          <div><dt>Front</dt><dd>Drag knobs vertically. Double-click one to return it to the midpoint.</dd></div>
          <div><dt>Back</dt><dd>Patch signal and control cables. Select a cable or jack with the keyboard and press Delete to unplug.</dd></div>
          <div><dt>Keyboard</dt><dd>Playing a note adds the MIDI plumbing when it is missing. Hardware MIDI is optional.</dd></div>
          <div><dt>Voices</dt><dd>Polyphony needs a MIDI module to distribute different notes; otherwise voices stack the same note.</dd></div>
        </dl>
      </HelpSection>

      <HelpSection title="Views and song hand-off">
        <dl className="help-definitions">
          <div><dt>Rack</dt><dd>The instrument and its controls.</dd></div>
          <div><dt>Split</dt><dd>Keep patching while using the performance filter pad beside the rack.</dd></div>
          <div><dt>Pad</dt><dd>Give the performance surface the whole stage. Tab still reveals its rear creature.</dd></div>
          <div><dt>Sequencer →</dt><dd>Returns to the retained groovebox song. Rack-only additions remain saved in rack mode.</dd></div>
        </dl>
      </HelpSection>

      <HelpSection title="Keyboard">
        <ul className="help-shortcuts">
          <Shortcut keys="Tab">Turn the rack around</Shortcut>
          <Shortcut keys="⌘/Ctrl Z">Undo</Shortcut>
          <Shortcut keys="⇧ ⌘/Ctrl Z">Redo</Shortcut>
          <Shortcut keys="Z–M / Q–U">Play the rack keyboard</Shortcut>
          <Shortcut keys=", / .">Keyboard octave down / up</Shortcut>
          <Shortcut keys="?">Open this guide</Shortcut>
        </ul>
      </HelpSection>
    </>
  )
}

/** A shared, focus-safe guide for both app entry points. */
export function HelpDialog({ surface, onClose }: HelpDialogProps) {
  const titleId = useId()
  const close = useRef<HTMLButtonElement>(null)
  const closeDialog = useRef(onClose)
  closeDialog.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()

    // Capture before the instrument's global shortcuts: keys pressed in the guide must not play a note,
    // turn the rack around, or start the transport behind it.
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog.current()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        close.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const name = surface === 'rack' ? 'Rack guide' : 'Groovebox guide'

  return (
    <div
      className="help-layer"
      data-help-dialog=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article className="help-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="help-head">
          <div>
            <span>Driftbox / Help</span>
            <h2 id={titleId}>{name}</h2>
          </div>
          <button ref={close} type="button" className="help-close" onClick={onClose} aria-label="Close help">
            ×
          </button>
        </header>
        <div className="help-body">
          {surface === 'rack' ? <RackHelp /> : <GrooveboxHelp />}
        </div>
        <footer className="help-foot">
          <span>Press <kbd>Esc</kbd> to close</span>
          <span>Open this guide any time with <kbd>?</kbd></span>
        </footer>
      </article>
    </div>
  )
}
