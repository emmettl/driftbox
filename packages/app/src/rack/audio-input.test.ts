import { describe, expect, it } from 'vitest'
import { audioCaptureConstraints, audioInputDevices, audioInputFailure } from './audio-input.js'

describe('audio input capture', () => {
  it('requests unprocessed stereo-capable audio from an exact selected device', () => {
    expect(audioCaptureConstraints('interface-2')).toEqual({
      video: false,
      audio: {
        deviceId: { exact: 'interface-2' },
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  })

  it('does not constrain the device before one is selected', () => {
    const audio = audioCaptureConstraints().audio
    expect(audio).not.toHaveProperty('deviceId')
  })

  it('keeps audio inputs only and gives permission-hidden devices a useful label', () => {
    const devices = [
      { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
      { kind: 'audioinput', deviceId: 'one', label: '' },
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
      { kind: 'audioinput', deviceId: 'two', label: 'USB Interface' },
    ] as MediaDeviceInfo[]

    expect(audioInputDevices(devices)).toEqual([
      { id: 'one', label: 'Audio input 1' },
      { id: 'two', label: 'USB Interface' },
    ])
  })
})

// A refused microphone is the one failure here that a person can do something about, so the sentence has
// to say which failure it was. It also has to stop short of claiming the input is off when a *switch*
// failed and the previous device is still sounding.
describe('an input the browser would not open', () => {
  it('names a refusal as a refusal, and offers the state that can be granted', () => {
    const denied = audioInputFailure(new DOMException('no', 'NotAllowedError'), false)
    expect(denied).toEqual({ state: 'denied', message: 'Audio-input permission was denied.' })
  })

  it('separates a device that has gone from a browser that never had capture', () => {
    expect(audioInputFailure(new DOMException('gone', 'NotFoundError'), false).message).toBe(
      'That audio input is no longer available.',
    )
    expect(audioInputFailure(new DOMException('narrow', 'OverconstrainedError'), false).message).toBe(
      'That audio input is no longer available.',
    )
    // Nothing to grant from the address bar, so this must not read as a refusal.
    expect(audioInputFailure(new DOMException('nope', 'NotSupportedError'), false).state).toBe(
      'unavailable',
    )
  })

  it('leaves a sounding input reported as on when a switch away from it fails', () => {
    const switched = audioInputFailure(new DOMException('no', 'NotAllowedError'), true)
    expect(switched.state).toBe('on')
    expect(switched.message).toBe('Audio-input permission was denied.')
  })

  it('does not guess from the name of something that is not a DOMException', () => {
    const error = new Error('boom')
    error.name = 'NotAllowedError'
    expect(audioInputFailure(error, false)).toEqual({
      state: 'denied',
      message: 'The browser could not open that audio input.',
    })
    expect(audioInputFailure(undefined, false).message).toBe(
      'The browser could not open that audio input.',
    )
  })
})
