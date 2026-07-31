import { describe, expect, it } from 'vitest'
import { audioCaptureConstraints, audioInputDevices } from './audio-input.js'

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
