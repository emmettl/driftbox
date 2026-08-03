import type { ModuleDef, ParamDef, Port } from '@driftbox/rack'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../ui/HelpDialog.css'
import './ModuleGuide.css'

interface Props {
  def: ModuleDef
  onClose: () => void
}

function portLabel(port: Port): string {
  return port.stereo ? `${port.name} · stereo` : port.name
}

function paramRange(param: ParamDef): string {
  if (param.labels?.length) return param.labels.join(' · ')
  return `${param.min}–${param.max} · starts at ${param.default}`
}

/** Contextual reference assembled from the def, with authored teaching copy where the device needs it. */
export function ModuleGuide({ def, onClose }: Props) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const closeDialog = useRef(onClose)
  closeDialog.current = onClose
  const visibleParams = def.params.filter((param) => !param.hidden)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()

    // The rack has global note, transport and delete shortcuts. A key used inside help must never reach it.
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

  return createPortal(
    <div
      className="help-layer"
      data-module-guide={def.type}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article
        ref={dialog}
        className="help-dialog module-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="help-head">
          <div>
            <span>Driftbox / {def.group ?? 'Device'} / Module guide</span>
            <h2 id={titleId}>{def.name}</h2>
          </div>
          <button ref={close} type="button" className="help-close" onClick={onClose} aria-label="Close module guide">
            ×
          </button>
        </header>

        <div className="help-body module-guide-body">
          <section className="help-section module-guide-intro">
            <h3>What it does</h3>
            <p className="help-copy">{def.guide?.overview ?? def.blurb ?? `${def.name} is a rack module.`}</p>
          </section>

          <section className="help-section">
            <h3>Signal flow</h3>
            <div className="module-guide-flow">
              <div>
                <strong>In</strong>
                {def.inlets.length ? (
                  <ul>{def.inlets.map((port) => <li key={port.id}>{portLabel(port)}</li>)}</ul>
                ) : <p>None — this device creates or controls signals.</p>}
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <strong>Out</strong>
                {def.outlets.length ? (
                  <ul>{def.outlets.map((port) => <li key={port.id}>{portLabel(port)}</li>)}</ul>
                ) : <p>None — this device ends or manages the signal.</p>}
              </div>
            </div>
          </section>

          {def.guide && (
            <>
              <section className="help-section module-guide-wide">
                <h3>How it works</h3>
                <dl className="help-definitions module-guide-concepts">
                  {def.guide.concepts.map((concept) => (
                    <div key={concept.title}>
                      <dt>{concept.title}</dt>
                      <dd>{concept.body}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="help-section">
                <h3>Try this first</h3>
                <ol className="help-steps">
                  {def.guide.firstPatch.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </section>
            </>
          )}

          <section className="help-section">
            <h3>Controls</h3>
            {visibleParams.length ? (
              <dl className="module-guide-controls">
                {visibleParams.map((param) => (
                  <div key={param.id}>
                    <dt>{param.name}</dt>
                    <dd>{paramRange(param)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="help-copy">No front-panel controls.</p>}
          </section>

          {def.guide?.watchFor?.length ? (
            <section className="help-section module-guide-wide">
              <h3>Watch for</h3>
              <ul className="module-guide-notes">
                {def.guide.watchFor.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className="help-foot">
          <span>Reference is generated from this module’s own definition.</span>
          <span>Press <kbd>Esc</kbd> to close</span>
        </footer>
      </article>
    </div>,
    document.body,
  )
}
