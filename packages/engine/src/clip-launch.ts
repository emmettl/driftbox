import type { ClipSlot } from './pattern.js'

export type ClipSelection = Partial<Record<ClipSlot, string>>
export type ClipLaunchPhase = 'queued' | 'active'
export const CLIP_LAUNCH_QUANTIZATIONS = ['step', 'beat', 'bar'] as const
export type ClipLaunchQuantization = (typeof CLIP_LAUNCH_QUANTIZATIONS)[number]

export interface ClipLaunchEvent {
  section: ClipSlot
  patternId: string | null
  phase: ClipLaunchPhase
  quantization: ClipLaunchQuantization
  /** Exact transport bar for an active launch. Queued events have not reached one yet. */
  bar?: number
}

interface PendingLaunch {
  patternId: string | null
  quantization: ClipLaunchQuantization
}

/**
 * Session-only machine clip overrides.
 *
 * A launch is performance state, not song data: sharing or saving a song after a set
 * must not silently rewrite its arrangement. Bar remains the default, while a performance
 * host may opt into beat or step boundaries without changing the authored song.
 */
export class ClipLauncher {
  private readonly active: ClipSelection = {}
  private readonly pending: Partial<Record<ClipSlot, PendingLaunch>> = {}
  private readonly listeners = new Set<(event: ClipLaunchEvent) => void>()

  get selection(): ClipSelection {
    return { ...this.active }
  }

  queue(
    section: ClipSlot,
    patternId: string | null,
    quantization: ClipLaunchQuantization = 'bar',
  ): void {
    this.pending[section] = { patternId, quantization }
    this.emit({ section, patternId, phase: 'queued', quantization })
  }

  activate(boundary: ClipLaunchQuantization = 'bar', bar?: number): void {
    const boundaryRank = CLIP_LAUNCH_QUANTIZATIONS.indexOf(boundary)
    for (const section of Object.keys(this.pending) as ClipSlot[]) {
      const pending = this.pending[section]
      if (!pending || CLIP_LAUNCH_QUANTIZATIONS.indexOf(pending.quantization) > boundaryRank) {
        continue
      }
      const { patternId, quantization } = pending
      if (patternId === null) delete this.active[section]
      else this.active[section] = patternId
      delete this.pending[section]
      this.emit({
        section,
        patternId,
        phase: 'active',
        quantization,
        ...(bar === undefined ? {} : { bar }),
      })
    }
  }

  clear(): void {
    for (const section of Object.keys(this.pending) as ClipSlot[]) delete this.pending[section]
    for (const section of Object.keys(this.active) as ClipSlot[]) delete this.active[section]
  }

  onChange(listener: (event: ClipLaunchEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ClipLaunchEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
