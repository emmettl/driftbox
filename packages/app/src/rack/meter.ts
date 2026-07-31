import type { MeterReading } from '@driftbox/rack'
import { useSyncExternalStore } from 'react'

// A tiny external store for audio-thread display data.
//
// Putting these readings in the rack's Zustand document store would make the entire chassis re-render around
// forty times a second and, worse, put ephemeral audio levels beside values that autosave. Each faceplate
// subscribes only to its own module id here. A reading is session display state: it never enters a patch.

const SILENCE: MeterReading = {
  id: '',
  level: 0,
  peak: 0,
  envelope: 0,
  waveform: new Float32Array(48),
}

const readings = new Map<string, MeterReading>()
const listeners = new Map<string, Set<() => void>>()

export function publishMeters(next: readonly MeterReading[]): void {
  for (const reading of next) {
    if (!reading || typeof reading.id !== 'string') continue
    readings.set(reading.id, reading)
    for (const listener of listeners.get(reading.id) ?? []) listener()
  }
}

export function meterSnapshot(id: string): MeterReading {
  return readings.get(id) ?? SILENCE
}

export function subscribeMeter(id: string, listener: () => void): () => void {
  const forModule = listeners.get(id) ?? new Set<() => void>()
  forModule.add(listener)
  listeners.set(id, forModule)
  return () => {
    forModule.delete(listener)
    if (forModule.size === 0) listeners.delete(id)
  }
}

export function useMeter(id: string): MeterReading {
  return useSyncExternalStore(
    (listener) => subscribeMeter(id, listener),
    () => meterSnapshot(id),
    () => SILENCE,
  )
}
