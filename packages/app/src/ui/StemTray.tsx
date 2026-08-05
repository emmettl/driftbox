import { renderStems, toWav, voicesUsed, type Song } from '@driftbox/engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadBlob } from '../persistence'
import { useBox } from '../store'
import {
  PREVIEW_SECONDS,
  PROBLEMS,
  StemCache,
  stemFileName,
  stemName,
  stemPreviewStart,
  stemRow,
  trayStatus,
} from './stem-review.js'
import './StemTray.css'

interface Props {
  onClose: () => void
  onExported: (count: number) => void
}

interface ReviewProps extends Props {
  song: Song
  running: boolean
  stopTransport: () => void
  /** Prefix shared by one-off saves and the complete set. */
  filePrefix?: string
}

export interface StemReviewItem {
  id: string
  name: string
}

export interface ReviewStem {
  buffer: AudioBuffer
  name: string
}

interface AudioReviewProps extends Props {
  items: readonly StemReviewItem[]
  running: boolean
  stopTransport: () => void
  /** Prefix shared by one-off saves and the complete set. */
  filePrefix?: string
  intro: string
  empty: string
  summary: (count: number) => string
  renderPreview: (id: string) => Promise<ReviewStem | null>
  renderFull: (id: string) => Promise<ReviewStem | null>
}

/** Shared review step between “stems” and a folder full of files. */
export function AudioStemReviewTray({
  items,
  running,
  stopTransport,
  filePrefix = 'driftbox',
  intro,
  empty,
  summary,
  renderPreview,
  renderFull,
  onClose,
  onExported,
}: AudioReviewProps) {
  const names = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  // The render function follows the current song; the cache outlives it, as it always has — this tray is
  // mounted for one document at a time.
  const renderRef = useRef(renderPreview)
  renderRef.current = renderPreview
  const [cache] = useState(() => new StemCache<ReviewStem>((id) => renderRef.current(id)))
  const context = useRef<AudioContext | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const alive = useRef(true)
  const [rendering, setRendering] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback((update = true) => {
    const active = source.current
    source.current = null
    active?.disconnect()
    try {
      active?.stop()
    } catch {
      // Ending and pressing stop can arrive in the same event turn.
    }
    if (update && alive.current) setPlaying(null)
  }, [])

  const ensureStem = useCallback(
    (id: string): Promise<ReviewStem | null> =>
      cache.ensure(id, (rendered) => {
        if (alive.current) setReady((current) => new Set([...current, rendered]))
      }),
    [cache],
  )

  const preview = async (id: string) => {
    if (playing === id) {
      stop()
      return
    }
    stop()
    setError(null)
    // Create/resume during the click gesture, before the offline render, so Safari does not reject playback
    // when the rendered buffer arrives several seconds later.
    const audio = context.current ?? new AudioContext()
    context.current = audio
    if (audio.state === 'suspended') await audio.resume()
    if (running) stopTransport()

    setRendering(id)
    try {
      const stem = await ensureStem(id)
      if (!stem || !alive.current) return
      const next = audio.createBufferSource()
      next.buffer = stem.buffer
      next.connect(audio.destination)
      next.onended = () => {
        if (source.current !== next) return
        source.current = null
        next.disconnect()
        if (alive.current) setPlaying(null)
      }
      source.current = next
      setPlaying(id)
      next.start()
    } catch {
      if (alive.current) setError(PROBLEMS.render(names.get(id) ?? id))
    } finally {
      if (alive.current) setRendering(null)
    }
  }

  const save = async (id: string, index: number) => {
    stop()
    setError(null)
    setRendering(id)
    try {
      const stem = await renderFull(id)
      if (!stem || !alive.current) return
      downloadBlob(toWav(stem.buffer), stemFileName(stem.name, index, filePrefix))
    } catch {
      if (alive.current) setError(PROBLEMS.render(names.get(id) ?? id))
    } finally {
      if (alive.current) setRendering(null)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    // React's development StrictMode mounts, cleans up and mounts effects once more.
    // Reset the guard so that rehearsal does not leave every async preview looking dead.
    alive.current = true
    return () => {
      alive.current = false
      stop(false)
      const audio = context.current
      context.current = null
      if (audio && audio.state !== 'closed') void audio.close()
    }
  }, [stop])

  const exportAll = async () => {
    stop()
    setError(null)
    let written = 0
    try {
      for (const [index, item] of items.entries()) {
        if (!alive.current) return
        setExporting(item.id)
        const stem = await renderFull(item.id)
        if (!stem || !alive.current) return
        downloadBlob(toWav(stem.buffer), stemFileName(stem.name, index, filePrefix))
        written++
        // Browsers commonly collapse several downloads dispatched in one event turn.
        await new Promise((done) => setTimeout(done, 120))
      }
      if (alive.current) {
        setExporting(null)
        onExported(written)
      }
    } catch {
      if (alive.current) {
        setExporting(null)
        setError(PROBLEMS.exportAll)
      }
    }
  }

  const busy = rendering ?? exporting

  return createPortal(
    <div className="stem-layer" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="stem-tray" role="dialog" aria-modal="true" aria-labelledby="stem-title">
        <header>
          <div>
            <span>Export desk</span>
            <h2 id="stem-title">Preview stems</h2>
          </div>
          <button type="button" className="stem-close" onClick={onClose} aria-label="Close stem preview">
            ×
          </button>
        </header>

        <p className="stem-intro">
          {intro}
        </p>

        <div className="stem-list">
          {items.length === 0 && <p className="stem-empty">{empty}</p>}
          {items.map((item, index) => {
            const row = stemRow({
              id: item.id,
              duration: cache.cached(item.id)?.buffer.duration,
              ready: ready.has(item.id),
              playing: playing === item.id,
              rendering: rendering === item.id || exporting === item.id,
              busy: busy !== null,
            })
            return (
              <div
                key={item.id}
                className={row.sounding ? 'stem-row stem-row-playing' : 'stem-row'}
              >
                <button
                  type="button"
                  className="stem-play"
                  disabled={row.playDisabled}
                  aria-label={
                    row.sounding ? `Stop ${item.name} stem` : `Preview ${item.name} stem`
                  }
                  aria-pressed={row.sounding}
                  onClick={() => void preview(item.id)}
                >
                  {row.glyph}
                </button>
                <span className="stem-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="stem-name">
                  <strong>{item.name}</strong>
                  <small>{row.detail}</small>
                </span>
                <span className="stem-status">{row.status}</span>
                <button
                  type="button"
                  className="stem-save"
                  disabled={row.saveDisabled}
                  onClick={() => void save(item.id, index)}
                >
                  save
                </button>
              </div>
            )
          })}
        </div>

        <footer>
          <span>
            {trayStatus(error, busy ? names.get(busy) ?? busy : null, summary(items.length))}
          </span>
          <button
            type="button"
            className="stem-export"
            disabled={busy !== null || items.length === 0}
            onClick={() => {
              stop()
              void exportAll()
            }}
          >
            Export all stems
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

/**
 * Retained-song adapter for the shared review desk.
 *
 * Short previews are rendered lazily from each voice's first entrance and cached only while this tray is
 * open. Saves and the full export still render the complete arrangement at export quality.
 */
export function StemReviewTray({
  song,
  running,
  stopTransport,
  filePrefix = 'driftbox',
  onClose,
  onExported,
}: ReviewProps) {
  const ids = useMemo(() => voicesUsed(song), [song])
  const items = useMemo(
    () => ids.map((id) => ({ id, name: stemName(id) })),
    [ids],
  )
  const renderPreview = useCallback(async (id: string) => {
    const [stem] = await renderStems(song, {
      only: [id],
      start: stemPreviewStart(song, id),
      duration: PREVIEW_SECONDS,
      tail: 1,
      sampleRate: 22050,
      useLadder: false,
    })
    return stem ?? null
  }, [song])
  const renderFull = useCallback(async (id: string) => {
    const [stem] = await renderStems(song, { only: [id] })
    return stem ?? null
  }, [song])

  return (
    <AudioStemReviewTray
      items={items}
      running={running}
      stopTransport={stopTransport}
      filePrefix={filePrefix}
      intro="Hear a short window around each voice’s first entrance, then save one or export the full set."
      empty="Nothing in this arrangement produces a stem."
      summary={(count) => `${count} stems in this song`}
      renderPreview={renderPreview}
      renderFull={renderFull}
      onClose={onClose}
      onExported={onExported}
    />
  )
}

/** Sequencer adapter for the shared retained-song review desk. */
export function StemTray(props: Props) {
  const song = useBox((state) => state.song)
  const running = useBox((state) => state.running)
  const toggleTransport = useBox((state) => state.toggleTransport)
  return (
    <StemReviewTray
      {...props}
      song={song}
      running={running}
      stopTransport={toggleTransport}
    />
  )
}
