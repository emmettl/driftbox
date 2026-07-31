import type { ClipSlot } from './pattern.js'

export type ClipSelection = Partial<Record<ClipSlot, string>>
export type ClipLaunchPhase = 'queued' | 'active'

export interface ClipLaunchEvent {
  section: ClipSlot
  patternId: string | null
  phase: ClipLaunchPhase
}

/**
 * Session-only machine clip overrides.
 *
 * A launch is performance state, not song data: sharing or saving a song after a set
 * must not silently rewrite its arrangement. Pending selections become active together
 * at a bar boundary, before that bar's length and notes are planned.
 */
export class ClipLauncher {
  private readonly active: ClipSelection = {}
  private readonly pending: Partial<Record<ClipSlot, string | null>> = {}
  private readonly listeners = new Set<(event: ClipLaunchEvent) => void>()

  get selection(): ClipSelection {
    return { ...this.active }
  }

  queue(section: ClipSlot, patternId: string | null): void {
    this.pending[section] = patternId
    this.emit({ section, patternId, phase: 'queued' })
  }

  activate(): void {
    for (const section of Object.keys(this.pending) as ClipSlot[]) {
      const patternId = this.pending[section] ?? null
      if (patternId === null) delete this.active[section]
      else this.active[section] = patternId
      delete this.pending[section]
      this.emit({ section, patternId, phase: 'active' })
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
