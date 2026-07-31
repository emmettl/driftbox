import {
  ALL_VOICES,
  BASS_VOICES,
  planSong,
  renderStems,
  songBars,
  toWav,
  voicesUsed,
  type Song,
  type Stem,
} from '@driftbox/engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadBlob } from '../persistence'
import { useBox } from '../store'

interface Props {
  onClose: () => void
  onExported: (count: number) => void
}

function stemName(id: string): string {
  return ALL_VOICES.find((voice) => voice.id === id)?.name
    ?? BASS_VOICES.find((voice) => voice.id === id)?.name
    ?? id
}

const fileName = (stem: Stem, index: number) => {
  const safe = stem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `driftbox-${index + 1}-${safe}.wav`
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

/**
 * A review step between “stems” and a folder full of files.
 *
 * Short previews are rendered lazily from each voice's first entrance and cached only while this tray is
 * open. Saves and the full export still render the complete arrangement at export quality. Previewing
 * stops the live song first, because hearing one isolated voice over the complete mix would claim to be
 * an audition while hiding the thing somebody is trying to check.
 */
export function StemTray({ onClose, onExported }: Props) {
  const song = useBox((state) => state.song)
  const running = useBox((state) => state.running)
  const toggleTransport = useBox((state) => state.toggleTransport)
  const exportStems = useBox((state) => state.exportStems)
  const exporting = useBox((state) => state.rendering)
  const ids = useMemo(() => voicesUsed(song), [song])
  const cache = useRef(new Map<string, Stem>())
  const pending = useRef(new Map<string, Promise<Stem | null>>())
  const context = useRef<AudioContext | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const alive = useRef(true)
  const [rendering, setRendering] = useState<string | null>(null)
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

  const ensureStem = useCallback(async (id: string): Promise<Stem | null> => {
    const cached = cache.current.get(id)
    if (cached) return cached
    const existing = pending.current.get(id)
    if (existing) return existing
    const work = renderStems(song, {
      only: [id],
      start: stemPreviewStart(song, id),
      duration: PREVIEW_SECONDS,
      tail: 1,
      sampleRate: 22050,
      useLadder: false,
    }).then(([stem]) => {
      if (!stem) return null
      cache.current.set(id, stem)
      if (alive.current) setReady((current) => new Set([...current, id]))
      return stem
    }).finally(() => {
      pending.current.delete(id)
    })
    pending.current.set(id, work)
    return work
  }, [song])

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
    if (running) toggleTransport()

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
      if (alive.current) setError(`Could not render ${stemName(id)}.`)
    } finally {
      if (alive.current) setRendering(null)
    }
  }

  const save = async (id: string, index: number) => {
    stop()
    setError(null)
    setRendering(id)
    try {
      const [stem] = await renderStems(song, { only: [id] })
      if (!stem || !alive.current) return
      downloadBlob(toWav(stem.buffer), fileName(stem, index))
    } catch {
      if (alive.current) setError(`Could not render ${stemName(id)}.`)
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

  useEffect(() => () => {
    alive.current = false
    stop(false)
    const audio = context.current
    context.current = null
    if (audio && audio.state !== 'closed') void audio.close()
  }, [stop])

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
          Hear a short window around each voice’s first entrance, then save one or export the full set.
        </p>

        <div className="stem-list">
          {ids.length === 0 && <p className="stem-empty">Nothing in this arrangement produces a stem.</p>}
          {ids.map((id, index) => {
            const stem = cache.current.get(id)
            const isPlaying = playing === id
            const isRendering = rendering === id || exporting === id
            return (
              <div key={id} className={isPlaying ? 'stem-row stem-row-playing' : 'stem-row'}>
                <button
                  type="button"
                  className="stem-play"
                  disabled={busy !== null && !isPlaying}
                  aria-label={isPlaying ? `Stop ${stemName(id)} stem` : `Preview ${stemName(id)} stem`}
                  aria-pressed={isPlaying}
                  onClick={() => void preview(id)}
                >
                  {isRendering ? '…' : isPlaying ? '■' : '▶'}
                </button>
                <span className="stem-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="stem-name">
                  <strong>{stemName(id)}</strong>
                  <small>
                    {id}{stem ? ` · ${stem.buffer.duration.toFixed(1)}s` : ready.has(id) ? ' · ready' : ''}
                  </small>
                </span>
                <span className="stem-status">
                  {isRendering ? 'rendering' : isPlaying ? 'playing' : stem ? 'ready' : 'not rendered'}
                </span>
                <button
                  type="button"
                  className="stem-save"
                  disabled={busy !== null}
                  onClick={() => void save(id, index)}
                >
                  save
                </button>
              </div>
            )
          })}
        </div>

        <footer>
          <span>{error ?? (busy ? `Rendering ${stemName(busy)}…` : `${ids.length} stems in this song`)}</span>
          <button
            type="button"
            className="stem-export"
            disabled={busy !== null || ids.length === 0}
            onClick={() => {
              stop()
              void exportStems().then(onExported)
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
