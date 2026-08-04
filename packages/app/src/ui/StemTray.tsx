import {
  ALL_VOICES,
  BASS_VOICES,
  planSong,
  renderStems,
  songBars,
  toWav,
  voicesUsed,
  type Song,
} from '@driftbox/engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadBlob } from '../persistence'
import { useBox } from '../store'
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

function stemName(id: string): string {
  return ALL_VOICES.find((voice) => voice.id === id)?.name
    ?? BASS_VOICES.find((voice) => voice.id === id)?.name
    ?? id
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

const fileName = (stem: ReviewStem, index: number, prefix = 'driftbox') => {
  const safe = stem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const document = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${document || 'driftbox'}-${index + 1}-${safe}.wav`
}

const PREVIEW_SECONDS = 4

function stemPreviewStart(song: Song, id: string): number {
  const plan = planSong(song, songBars(song))
  const times = plan.flatMap((step) => [
    ...step.drums.filter((hit) => hit.voiceId === id).map((hit) => hit.time),
    ...step.bass.filter((hit) => hit.voiceId === id).map((hit) => hit.time),
  ])
  return Math.max(0, (times[0] ?? 0) - 0.25)
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
  const cache = useRef(new Map<string, ReviewStem>())
  const pending = useRef(new Map<string, Promise<ReviewStem | null>>())
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

  const ensureStem = useCallback(async (id: string): Promise<ReviewStem | null> => {
    const cached = cache.current.get(id)
    if (cached) return cached
    const existing = pending.current.get(id)
    if (existing) return existing
    const work = renderPreview(id).then((stem) => {
      if (!stem) return null
      cache.current.set(id, stem)
      if (alive.current) setReady((current) => new Set([...current, id]))
      return stem
    }).finally(() => {
      pending.current.delete(id)
    })
    pending.current.set(id, work)
    return work
  }, [renderPreview])

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
      if (alive.current) setError(`Could not render ${names.get(id) ?? id}.`)
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
      downloadBlob(toWav(stem.buffer), fileName(stem, index, filePrefix))
    } catch {
      if (alive.current) setError(`Could not render ${names.get(id) ?? id}.`)
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
        downloadBlob(toWav(stem.buffer), fileName(stem, index, filePrefix))
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
        setError('Could not export the complete stem set.')
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
            const stem = cache.current.get(item.id)
            const isPlaying = playing === item.id
            const isRendering = rendering === item.id || exporting === item.id
            return (
              <div key={item.id} className={isPlaying ? 'stem-row stem-row-playing' : 'stem-row'}>
                <button
                  type="button"
                  className="stem-play"
                  disabled={busy !== null && !isPlaying}
                  aria-label={isPlaying ? `Stop ${item.name} stem` : `Preview ${item.name} stem`}
                  aria-pressed={isPlaying}
                  onClick={() => void preview(item.id)}
                >
                  {isRendering ? '…' : isPlaying ? '■' : '▶'}
                </button>
                <span className="stem-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="stem-name">
                  <strong>{item.name}</strong>
                  <small>
                    {item.id}{stem ? ` · ${stem.buffer.duration.toFixed(1)}s` : ready.has(item.id) ? ' · ready' : ''}
                  </small>
                </span>
                <span className="stem-status">
                  {isRendering ? 'rendering' : isPlaying ? 'playing' : stem ? 'ready' : 'not rendered'}
                </span>
                <button
                  type="button"
                  className="stem-save"
                  disabled={busy !== null}
                  onClick={() => void save(item.id, index)}
                >
                  save
                </button>
              </div>
            )
          })}
        </div>

        <footer>
          <span>{error ?? (busy ? `Rendering ${names.get(busy) ?? busy}…` : summary(items.length))}</span>
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
