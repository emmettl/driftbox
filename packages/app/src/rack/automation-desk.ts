import {
  automationLength,
  type AutoLane,
  type Patch,
  type ParamDef,
  type Registry,
} from '@driftbox/rack'

export interface LanePointView {
  at: number
  value: number
  position: string
  x: number
  y: number
}

export interface AutomationLaneView {
  key: string
  moduleId: string
  paramId: string
  moduleName: string
  paramName: string
  curve: 'linear' | 'hold'
  stepped: boolean
  min?: number
  max?: number
  points: readonly LanePointView[]
  pointCount: number
  from: string
  to: string
  path: string
}

export const automationPositionLabel = (at: number): string =>
  `${Math.floor(at / 16) + 1}.${(at % 16) + 1}`

/** Parse the desk's one-based `bar.step` notation into the rack's zero-based sixteenth timeline. */
export function automationPosition(value: string): number | null {
  const match = /^\s*(\d+)\.(\d+)\s*$/.exec(value)
  if (!match) return null
  const bar = Number(match[1])
  const step = Number(match[2])
  if (!Number.isSafeInteger(bar) || bar < 1 || !Number.isSafeInteger(step) || step < 1 || step > 16) {
    return null
  }
  const position = (bar - 1) * 16 + step - 1
  return Number.isSafeInteger(position) ? position : null
}

function range(lane: AutoLane, param?: ParamDef): [number, number] {
  if (param && param.max > param.min) return [param.min, param.max]
  const values = lane.points.map((point) => point.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  return high > low ? [low, high] : [low - 0.5, high + 0.5]
}

/** Resolve saved ids into readable lanes and one compact timeline path per lane. */
export function automationLaneViews(
  patch: Patch,
  registry: Registry,
  width = 180,
  height = 38,
): AutomationLaneView[] {
  const end = Math.max(16, automationLength(patch.automation))
  return (patch.automation ?? []).map((lane) => {
    const [moduleId, paramId] = lane.target
    const module = patch.modules.find((candidate) => candidate.id === moduleId)
    const def = module ? registry[module.type] : undefined
    const param = def?.params.find((candidate) => candidate.id === paramId)
    const [low, high] = range(lane, param)
    const points = lane.points.map((point) => {
      const value = Math.max(0, Math.min(1, (point.value - low) / (high - low)))
      return {
        at: point.at,
        value: point.value,
        position: automationPositionLabel(point.at),
        x: 4 + (Math.max(0, point.at) / end) * (width - 8),
        y: 4 + (1 - value) * (height - 8),
      }
    })
    const curve = lane.curve === 'hold' ? 'hold' : 'linear'
    let path = ''
    for (const [index, point] of points.entries()) {
      if (index === 0) path = `M ${point.x} ${point.y}`
      else if (curve === 'hold') path += ` H ${point.x} V ${point.y}`
      else path += ` L ${point.x} ${point.y}`
    }
    return {
      key: `${moduleId}:${paramId}`,
      moduleId,
      paramId,
      moduleName: def?.name ?? module?.type ?? moduleId,
      paramName: param?.name ?? paramId,
      curve,
      stepped: param?.stepped === true,
      min: param?.min,
      max: param?.max,
      points,
      pointCount: lane.points.length,
      from: automationPositionLabel(lane.points[0]?.at ?? 0),
      to: automationPositionLabel(lane.points[lane.points.length - 1]?.at ?? 0),
      path,
    }
  })
}
