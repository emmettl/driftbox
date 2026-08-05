import { multisampleSlot, packMultisampleZones, type Patch, type Rack } from '@driftbox/rack'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BREAKS, renderBreak } from './breaks.js'
import { suggestMultisampleZones } from './multisample.js'
import type { RackNodes } from './nodes.js'
import {
  guessBars,
  normalise,
  previewSampleRate,
  sampleName,
  tempoForBars,
  toMono,
  waveformPeaks,
} from './sample.js'
import { useRack } from './store.js'

// Every piece of audio the patch is made of, and the four ways one gets in: a shipped break, a dropped
// file, a folder of them, or the export asking for all of it back.
//
// One hook rather than four, because they share the retained PCM and the reason it is retained. `setData`
// **transfers** a buffer to the audio thread — the array is empty on this side the moment it is sent — so
// anything that needs the audio again keeps its own copy here. Exporting needs it, a second Sampler needs
// its own copy, and a preview needs to put it back into a buffer. A shipped break can be rendered again
// from its id; somebody's own file cannot be re-made and this is the only place it exists.

/** Which break is loaded, by id as well as name — the id so an export can render it again. */
export interface LoadedBreak {
  id: string
  name: string
}

export interface SampleBank {
  loadedBreak: LoadedBreak | null
  /**
   * The break this patch is written around, whether or not one has been pushed to the audio thread yet.
   *
   * Separate from `loadedBreak` on purpose, and the export is why. Exporting before pressing play used to
   * produce a file with the bass and no drums: `loadedBreak` only becomes true once `loadBreak` has run,
   * and the render does not need a live rack at all. Showing a break as loaded when it is not would be a
   * lie; exporting the wrong file silently is worse. So there are two facts and they are both recorded.
   */
  intendedBreak: string | null
  setIntendedBreak: (id: string | null) => void
  loadBreak: (id: string) => Promise<void>
  /** Rebuild the session-only audio that an offline patch or stem render needs. */
  patchRenderData: (patch: Patch) => Promise<Record<string, Record<string, Float32Array>>>
  /** Push every retained buffer into a rack that has only just been built. */
  hydrate: (live: Rack) => void
}

export function useSampleBank(nodes: RackNodes): SampleBank {
  const setTempo = useRack((s) => s.setTempo)
  const setBreak = useRack((s) => s.setBreak)
  const setRunning = useRack((s) => s.setRunning)
  const ensureSampler = useRack((s) => s.ensureSampler)

  const [loadedBreak, setLoadedBreak] = useState<LoadedBreak | null>(null)
  const [intendedBreak, setIntendedBreak] = useState<string | null>(null)

  /**
   * The audio behind every loaded sample, by module id.
   *
   * A ref rather than store state: it is megabytes, the store is compared on every render, and keeping it
   * there would put it one careless `encodePatch` away from a shared link. The store holds only what a
   * faceplate needs to *say* — see `SampleInfo`.
   */
  const sampleAudio = useRef(new Map<string, Float32Array>())
  /** Multisampler PCM, retained for export just like `sampleAudio`, ordered to match `sampleN` slots. */
  const multisampleAudio = useRef(new Map<string, readonly Float32Array[]>())
  /** One raw-sample audition at a time, independent of the rack transport and patch cables. */
  const samplePreviewContext = useRef<AudioContext | null>(null)
  const samplePreviewSource = useRef<AudioBufferSourceNode | null>(null)
  const samplePreviewTicket = useRef(0)

  const stopSamplePreview = useCallback(() => {
    samplePreviewTicket.current++
    const source = samplePreviewSource.current
    samplePreviewSource.current = null
    source?.disconnect()
    try {
      source?.stop()
    } catch {
      // An already-ended source is stopped in every meaningful sense.
    }
    useRack.getState().setPreviewingSample(null)
  }, [])

  const previewSample = useCallback(
    async (moduleId: string) => {
      if (useRack.getState().previewingSample === moduleId) {
        stopSamplePreview()
        return
      }

      stopSamplePreview()
      const samples = sampleAudio.current.get(moduleId)
      const info = useRack.getState().samples[moduleId]
      if (!samples || !info || !(info.seconds > 0)) return

      // Audition the source, not the source layered over the running rack. The rack context suspends when
      // its transport stops; this preview owns a separate context so it remains audible.
      if (useRack.getState().running) useRack.getState().setRunning(false)

      const ticket = samplePreviewTicket.current
      const context = samplePreviewContext.current ?? new AudioContext()
      samplePreviewContext.current = context
      if (context.state === 'suspended') await context.resume()
      if (ticket !== samplePreviewTicket.current) return

      // Recover the decode rate from the retained frame count and exact duration. The preview context
      // resamples it to the output device; forcing its own rate here would change the length and pitch.
      const buffer = context.createBuffer(
        1,
        samples.length,
        previewSampleRate(samples.length, info.seconds),
      )
      buffer.getChannelData(0).set(samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.onended = () => {
        if (samplePreviewSource.current !== source) return
        samplePreviewSource.current = null
        source.disconnect()
        useRack.getState().setPreviewingSample(null)
      }
      samplePreviewSource.current = source
      useRack.getState().setPreviewingSample(moduleId)
      source.start()
    },
    [stopSamplePreview],
  )

  useEffect(() => {
    useRack.getState().setSamplePreviewer(previewSample)
    return () => {
      useRack.getState().setSamplePreviewer(null)
      stopSamplePreview()
      const context = samplePreviewContext.current
      samplePreviewContext.current = null
      if (context && context.state !== 'closed') void context.close()
    }
  }, [previewSample, stopSamplePreview])

  /**
   * Render a break and hand it to every sampler in the patch.
   *
   * A copy per sampler, because `setData` **transfers** the buffer — after the first send the array is
   * empty on this side, so loading one break into two samplers would give the second one nothing. That is
   * the cost of not copying on the audio thread's doorstep, and it is worth it; it just has to be known
   * about.
   */
  const loadBreak = useCallback(
    async (id: string) => {
      stopSamplePreview()
      const entry = BREAKS.find((candidate) => candidate.id === id)
      if (!entry) return
      // Recorded before the live-rack check, not after. This used to return early when audio had not
      // started, which meant choosing a break-backed patch from the picker and exporting it produced a
      // file with the bass and no drums — the same early-return-before-recording-the-fact shape as the
      // bug above.
      setIntendedBreak(entry.id)
      setBreak(entry.id)

      const live = nodes.rack.current
      if (!live) return

      // **If there is nowhere to put it, make somewhere.** Clicking a break used to do nothing at all when
      // the patch had no Sampler — there was a hint saying to add one, and the button stayed enabled and
      // silently no-opped. For an instrument whose whole aim is being fun in four seconds, clicking a
      // break has to produce a break; being told to go and assemble three modules first is the opposite of
      // that.
      ensureSampler()
      // The patch it may just have changed has to reach the audio thread before the data does, or the data
      // is for a module the Graph has not built yet.
      live.patch = useRack.getState().patch

      const rendered = await renderBreak(entry, { sampleRate: live.output?.context.sampleRate })
      const samplers = useRack.getState().patch.modules.filter((m) => m.type === 'sampler')
      // A copy per sampler, because `setData` transfers: after the first send the array is empty here.
      for (const module of samplers) live.setData(module.id, 'sample', rendered.slice())
      setLoadedBreak({ id: entry.id, name: entry.name })
      for (const module of samplers) {
        // Retained once for auditioning and export. Several Samplers may safely share this immutable
        // array; only the copies transferred to the worklet are detached.
        sampleAudio.current.set(module.id, rendered)
        useRack.getState().setSample(module.id, {
          name: entry.name,
          bars: 1,
          seconds: (4 * 60) / entry.tempo,
          peaks: waveformPeaks(rendered),
          source: 'break',
        })
      }

      // A break is rendered at its own tempo and only slices cleanly at that tempo, so adopting it means
      // adopting the tempo too. Letting the chop drift silently would be the worse outcome.
      if ((useRack.getState().patch.tempo ?? 120) !== entry.tempo) setTempo(entry.tempo)
      // And it should be playing. Loading a break and hearing nothing is the same failure as the stop
      // button.
      setRunning(true)
    },
    [ensureSampler, nodes, setBreak, setRunning, setTempo, stopSamplePreview],
  )

  /**
   * Load an audio file into one Sampler.
   *
   * Decoded through a throwaway `OfflineAudioContext`, so this works before audio has ever been started —
   * the same standard the export holds itself to.
   *
   * The tempo is **derived from the file** rather than asked for. The Sampler slices by equal division, so
   * a chop only lands on the beat if the buffer is a whole number of bars and the patch runs at the tempo
   * that makes it so; see the note at the top of `sample.ts`.
   */
  const loadSampleInto = useCallback(
    async (moduleId: string, file: File) => {
      stopSamplePreview()
      const bytes = await file.arrayBuffer()
      // 1 frame is the smallest legal length; nothing is rendered through it, it only decodes.
      const decoder = new OfflineAudioContext(1, 1, 44100)
      const decoded = await decoder.decodeAudioData(bytes)

      const samples = normalise(toMono(decoded))
      const seconds = decoded.length / decoded.sampleRate
      const bars = guessBars(seconds, useRack.getState().patch.tempo ?? 120)

      sampleAudio.current.set(moduleId, samples)
      useRack.getState().setSample(moduleId, {
        name: sampleName(file.name),
        bars,
        seconds,
        peaks: waveformPeaks(samples),
        source: 'file',
      })

      // A copy, because `setData` transfers and the export needs the original back.
      nodes.rack.current?.setData(moduleId, 'sample', samples.slice())
      const tempo = tempoForBars(seconds, bars)
      if (tempo > 0) setTempo(Math.round(tempo * 100) / 100)
      setRunning(true)
    },
    [nodes, setRunning, setTempo, stopSamplePreview],
  )

  useEffect(() => {
    useRack.getState().setSampleLoader(loadSampleInto)
  }, [loadSampleInto])

  /** Decode a batch, infer its root/range/layer map, and push every recording into one Multisampler. */
  const loadMultisamplesInto = useCallback(
    async (moduleId: string, files: readonly File[]) => {
      if (files.length === 0) return
      stopSamplePreview()
      const decoded = await Promise.all(
        files.map(async (file) => {
          const bytes = await file.arrayBuffer()
          const decoder = new OfflineAudioContext(1, 1, 44100)
          const audio = await decoder.decodeAudioData(bytes)
          const samples = normalise(toMono(audio))
          return {
            samples,
            info: {
              name: sampleName(file.name),
              seconds: audio.length / audio.sampleRate,
              sampleRate: audio.sampleRate,
              peaks: waveformPeaks(samples, 48),
            },
          }
        }),
      )

      const zones = suggestMultisampleZones(
        decoded.map(({ info }) => ({ name: info.name, sampleRate: info.sampleRate })),
      )
      multisampleAudio.current.set(moduleId, decoded.map(({ samples }) => samples))
      useRack.getState().setMultisamples(moduleId, decoded.map(({ info }) => info))
      // Zone metadata is document state; PCM is deliberately session-only. The store subscription pushes
      // `zones`, while these direct sends transfer copies of the retained audio into the live graph.
      useRack.getState().setData(moduleId, 'zones', packMultisampleZones(zones))
      for (let index = 0; index < decoded.length; index++) {
        nodes.rack.current?.setData(moduleId, multisampleSlot(index), decoded[index].samples.slice())
      }
      setRunning(true)
    },
    [nodes, setRunning, stopSamplePreview],
  )

  useEffect(() => {
    useRack.getState().setMultisampleLoader(loadMultisamplesInto)
  }, [loadMultisamplesInto])

  const patchRenderData = useCallback(
    async (patch: Patch) => {
      const breakId = patch.break ?? intendedBreak
      const entry = breakId ? BREAKS.find((b) => b.id === breakId) : undefined
      const data: Record<string, Record<string, Float32Array>> = {}
      // A loaded file wins over a shipped break, per sampler. Rendering the break over the top would
      // silently export something other than what is playing.
      for (const [moduleId, samples] of sampleAudio.current) {
        data[moduleId] = { sample: samples.slice() }
      }
      for (const [moduleId, samples] of multisampleAudio.current) {
        data[moduleId] = Object.fromEntries(
          samples.map((sample, index) => [multisampleSlot(index), sample.slice()]),
        )
      }
      if (entry) {
        const rendered = await renderBreak(entry, { sampleRate: 44100 })
        for (const module of patch.modules) {
          if (module.type !== 'sampler' || data[module.id]) continue
          // A copy per sampler, for the same reason `loadBreak` makes one: `setData` transfers.
          data[module.id] = { sample: rendered.slice() }
        }
      }
      return data
    },
    [intendedBreak],
  )

  /**
   * Files may be decoded before the first Start gesture. Their PCM is retained specifically because
   * `setData` transfers buffers, so hydrate a new audio thread the moment there is one; patch metadata
   * arrives separately through `live.patch`. This also closes the same pre-start hole for the original
   * break Sampler.
   */
  const hydrate = useCallback((live: Rack) => {
    for (const [moduleId, samples] of sampleAudio.current) {
      live.setData(moduleId, 'sample', samples.slice())
    }
    for (const [moduleId, samples] of multisampleAudio.current) {
      for (let index = 0; index < samples.length; index++) {
        live.setData(moduleId, multisampleSlot(index), samples[index].slice())
      }
    }
  }, [])

  return {
    loadedBreak,
    intendedBreak,
    setIntendedBreak,
    loadBreak,
    patchRenderData,
    hydrate,
  }
}
