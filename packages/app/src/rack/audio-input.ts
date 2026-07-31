/**
 * Browser capture for the rack's Audio Input module.
 *
 * The module lives in the patch; this handle deliberately does not. Device ids are local,
 * permission-gated browser state and would make a shared patch machine-specific.
 */
export interface AudioInputDevice {
  id: string
  label: string
}

export interface AudioInputHandle {
  deviceId: string
  label: string
  close(): void
}

type MediaAccess = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>

/** Capture raw interface audio rather than speech-processed microphone audio. */
export function audioCaptureConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    video: false,
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  }
}

/** Stable, presentable input options after `enumerateDevices()`. */
export function audioInputDevices(devices: readonly MediaDeviceInfo[]): AudioInputDevice[] {
  let unnamed = 0
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({
      id: device.deviceId,
      // Labels are intentionally hidden by browsers until capture permission has been granted.
      label: device.label || `Audio input ${++unnamed}`,
    }))
}

export async function enumerateAudioInputs(
  media: Pick<MediaAccess, 'enumerateDevices'> = navigator.mediaDevices,
): Promise<AudioInputDevice[]> {
  return audioInputDevices(await media.enumerateDevices())
}

/**
 * Open one input and connect it to the rack. The caller owns replacement ordering so a
 * failed device switch can leave the currently sounding stream alone.
 */
export async function openAudioInput(
  context: AudioContext,
  destination: AudioNode,
  deviceId?: string,
  media: MediaAccess = navigator.mediaDevices,
): Promise<AudioInputHandle> {
  const stream = await media.getUserMedia(audioCaptureConstraints(deviceId))
  let source: MediaStreamAudioSourceNode
  try {
    source = context.createMediaStreamSource(stream)
    source.connect(destination)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    throw error
  }

  const track = stream.getAudioTracks()[0]
  const actualId = track?.getSettings().deviceId || deviceId || ''
  const label = track?.label || 'Audio input'
  let closed = false
  return {
    deviceId: actualId,
    label,
    close() {
      if (closed) return
      closed = true
      source.disconnect()
      for (const captured of stream.getTracks()) captured.stop()
    },
  }
}
