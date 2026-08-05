import { RACK_LIVE_INPUT } from '@driftbox/rack'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  audioInputFailure,
  enumerateAudioInputs,
  openAudioInput,
  type AudioInputDevice,
  type AudioInputHandle,
  type AudioInputState,
} from './audio-input.js'
import type { RackNodes } from './nodes.js'
import { useRack } from './store.js'

// The host side of the Audio Input module: permission, device choice and the sentence shown when one of
// those goes wrong.
//
// None of it belongs in the patch. A patch records that it *wants* a live input; the device id of one
// particular computer is local, permission-gated browser state, and putting it in a shared document would
// make somebody else's link open asking for a microphone that only exists here.

export interface RackAudioInput {
  /** Whether the patch asks for a live input at all. */
  hasAudioInput: boolean
  state: AudioInputState
  error: string | null
  devices: AudioInputDevice[]
  selected: string
  connect: (deviceId?: string) => Promise<void>
  close: () => void
}

export function useAudioInput(nodes: RackNodes): RackAudioInput {
  const hasAudioInput = useRack((s) => s.patch.modules.some((m) => m.type === 'audio-input'))
  const handle = useRef<AudioInputHandle | null>(null)
  const [devices, setDevices] = useState<AudioInputDevice[]>([])
  const [selected, setSelected] = useState('')
  const [state, setState] = useState<AudioInputState>('off')
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    handle.current?.close()
    handle.current = null
    setState('off')
    setError(null)
  }, [])

  const connect = useCallback(
    async (deviceId?: string) => {
      const live = nodes.rack.current
      const context = live?.output?.context as AudioContext | undefined
      const destination = live?.input(RACK_LIVE_INPUT)
      if (!context || !destination) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable')
        setError('Audio capture is unavailable here. Use a secure HTTPS or localhost page.')
        return
      }

      const previous = handle.current
      setState('opening')
      setError(null)
      try {
        // Open first, close second: a rejected device switch leaves the sounding input alone.
        const next = await openAudioInput(context, destination, deviceId)
        previous?.close()
        handle.current = next
        setSelected(next.deviceId)
        setState('on')
        if (context.state === 'suspended') await context.resume()
        try {
          setDevices(await enumerateAudioInputs())
        } catch {
          // Capture works without enumeration; only the picker loses its other choices.
          setDevices([{ id: next.deviceId, label: next.label }])
        }
      } catch (failure) {
        const outcome = audioInputFailure(failure, Boolean(previous))
        setState(outcome.state)
        setError(outcome.message)
      }
    },
    [nodes],
  )

  // Removing the last source module releases the microphone/interface immediately.
  useEffect(() => {
    if (!hasAudioInput) close()
  }, [close, hasAudioInput])

  // Keep the selector current while interfaces are plugged in or removed.
  useEffect(() => {
    if (state !== 'on' || !navigator.mediaDevices?.addEventListener) return
    const refresh = () => {
      void enumerateAudioInputs()
        .then(setDevices)
        .catch(() => {})
    }
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [state])

  // Let go of the device on the way out, so a reload does not leave a stream open on a closed page.
  useEffect(() => () => handle.current?.close(), [])

  return { hasAudioInput, state, error, devices, selected, connect, close }
}
