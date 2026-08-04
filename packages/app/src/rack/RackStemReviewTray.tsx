import {
  MODULES,
  patchStemTargets,
  renderPatchStems,
  type Patch,
  type PatchStem,
} from '@driftbox/rack'
import { useCallback, useMemo, useRef } from 'react'
import { AudioStemReviewTray } from '../ui/StemTray.js'

type RenderData = Record<string, Record<string, Float32Array>>

interface Props {
  patch: Patch
  running: boolean
  stopTransport: () => void
  filePrefix?: string
  prepareData: (patch: Patch) => Promise<RenderData>
  onClose: () => void
  onExported: (count: number) => void
}

/** Rack-native adapter: every terminal Out strip is one stable, named stem bus. */
export function RackStemReviewTray({
  patch,
  running,
  stopTransport,
  filePrefix = 'driftbox-rack',
  prepareData,
  onClose,
  onExported,
}: Props) {
  const items = useMemo(() => patchStemTargets(patch, MODULES), [patch])
  // Break generation can be expensive and loaded samples can be large. Prepare one immutable source set per
  // open desk; the rack renderer makes its own transferable copy for every isolated Out render.
  const prepared = useRef<Promise<RenderData> | null>(null)
  const data = useCallback(() => {
    prepared.current ??= prepareData(patch).catch((error: unknown) => {
      // A transient generated-break failure should not poison every later preview until the desk is closed.
      prepared.current = null
      throw error
    })
    return prepared.current
  }, [patch, prepareData])

  const renderOne = useCallback(async (
    id: string,
    options: { bars: number; tail?: number },
  ): Promise<PatchStem | null> => {
    const [stem] = await renderPatchStems(patch, {
      registry: MODULES,
      only: [id],
      sampleRate: 44100,
      data: await data(),
      ...options,
    })
    return stem ?? null
  }, [data, patch])

  const renderPreview = useCallback(
    (id: string) => renderOne(id, { bars: 2, tail: 1 }),
    [renderOne],
  )
  const renderFull = useCallback(
    (id: string) => renderOne(id, { bars: 8 }),
    [renderOne],
  )

  return (
    <AudioStemReviewTray
      items={items}
      running={running}
      stopTransport={stopTransport}
      filePrefix={filePrefix}
      intro="Hear each terminal Out bus in isolation, then save one or export the complete rack stem set."
      empty="Add an Out module to define a rack stem."
      summary={(count) => `${count} Out ${count === 1 ? 'stem' : 'stems'} in this patch`}
      renderPreview={renderPreview}
      renderFull={renderFull}
      onClose={onClose}
      onExported={onExported}
    />
  )
}
