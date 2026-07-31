// Which knob on your desk moves which knob on the screen.
//
// The Combinator exists to be **played** — four rotaries that move a dozen parameters at once is a
// performance idea, and performing it with a mouse is one gesture at a time. This is the other half of
// that feature, and the reason the rotaries run 0..127 in the first place: that is a MIDI controller's
// range, and `modules/combi.ts` says so.
//
// **Learn, not fixed controller numbers.** A fixed table — CC 16 is rotary one, and so on — is less code
// and quietly demands that everybody reconfigure their hardware to match us. Most cheap controllers cannot
// be reconfigured at all. Learn works with whatever is plugged in, which is the difference between a
// feature and a feature with a prerequisite.
//
// **Bindings are not part of the patch**, and this is the decision worth defending. A patch travels in a
// URL; a binding describes the box on your desk. Sharing a patch that silently re-aimed somebody else's
// controller would be wrong, and a patch that carried a mapping for hardware nobody else owns would be
// carrying noise. So bindings live beside the patch, in storage, the same way `SampleInfo` and the panel
// fold states do.
//
// **Storage is a parameter**, defaulting to `localStorage`, so all of this is testable in Node against a
// plain Map — the same trade `library.ts` makes and for the same reason. A mapping nobody can test is a
// mapping that quietly stops working.
//
// Nothing here knows about the Combinator specifically. A binding names a module and a param, so learning
// a CC onto a filter's cutoff works exactly as well; the Combinator is only where the UI surfaces it first,
// because that is where it is worth the most.

const KEY = 'driftbox.midi.cc.v1'
const LEGACY_KEY = 'driftbox.rack.cc.v1'

/** Just enough of `Storage` to be swapped out in a test. */
export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CcBinding {
  /** Controller number, 0-127. */
  cc: number
  /**
   * MIDI channel, 1-16, or 0 for any.
   *
   * Any is the default and the right one: a controller's knobs and its keys often sit on different
   * channels, and somebody who has just turned a knob to teach it does not want to be told the wrong
   * channel was listening. Binding to a specific channel is what you reach for with two controllers.
   */
  channel: number
  module: string
  param: string
}

/** The range information a MIDI mapping needs. Rack ParamDef objects and groovebox
 * targets both satisfy this without either editor depending on the other package. */
export interface CcParamRange {
  min: number
  max: number
  stepped?: boolean
}

/** The browser's, or nothing if it cannot be reached. Read lazily: at module scope this would throw on
 *  import in a context that blocks storage, and take the whole page with it. */
function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const isBinding = (value: unknown): value is CcBinding => {
  const b = value as CcBinding | null
  return (
    !!b &&
    typeof b.cc === 'number' &&
    Number.isInteger(b.cc) &&
    b.cc >= 0 &&
    b.cc <= 127 &&
    typeof b.channel === 'number' &&
    Number.isInteger(b.channel) &&
    b.channel >= 0 &&
    b.channel <= 16 &&
    typeof b.module === 'string' &&
    b.module !== '' &&
    typeof b.param === 'string' &&
    b.param !== ''
  )
}

/** Read what was learned. Anything unreadable is no bindings rather than an error — storage can be
 *  unavailable, full, or hold what an older build wrote, and none of those is worth a broken page. */
export function loadBindings(store: Store | null = browserStore()): CcBinding[] {
  if (!store) return []
  try {
    // Read the rack-only key as a migration path. Saving writes the shared key while
    // retaining every binding, so existing Combinator mappings survive this extraction.
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? store.getItem(LEGACY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isBinding) : []
  } catch {
    return []
  }
}

export function saveBindings(bindings: readonly CcBinding[], store: Store | null = browserStore()): void {
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(bindings))
  } catch {
    // Full, or blocked. Losing a mapping is not worth an error in front of somebody playing.
  }
}

/**
 * Learn a controller onto a parameter.
 *
 * **One binding per target, and a controller may drive several targets.** That is the useful way round and
 * it mirrors the rack: an inlet takes one cable, an outlet feeds as many as you like. Teaching a rotary a
 * new knob replaces what it had — otherwise the old one would still be moving it and the fault would be
 * invisible — while one hardware knob sweeping three parameters at once is a thing people do on purpose.
 */
export function learn(bindings: readonly CcBinding[], binding: CcBinding): CcBinding[] {
  return [...bindings.filter((b) => !(b.module === binding.module && b.param === binding.param)), binding]
}

/** Forget the binding on one parameter, if it has one. */
export function forget(
  bindings: readonly CcBinding[],
  module: string,
  param: string,
): CcBinding[] {
  return bindings.filter((b) => !(b.module === module && b.param === param))
}

/** Everything a module has learned, keyed by param — for a faceplate that wants to say so. */
export function bindingsFor(
  bindings: readonly CcBinding[],
  module: string,
): Map<string, CcBinding> {
  const out = new Map<string, CcBinding>()
  for (const binding of bindings) {
    if (binding.module === module) out.set(binding.param, binding)
  }
  return out
}

/** Every target an incoming controller message should move. A binding on channel 0 hears every channel. */
export function targets(
  bindings: readonly CcBinding[],
  cc: number,
  channel: number,
): CcBinding[] {
  return bindings.filter((b) => b.cc === cc && (b.channel === 0 || b.channel === channel))
}

/**
 * What a controller's 0..127 means for one parameter, in that parameter's own units.
 *
 * Normalised and denormalised rather than assumed, so a CC reaches a cutoff in Hz and a Combinator rotary
 * — which is already 0..127 — as itself. Stepped params round, for the reason `ParamDef.stepped` exists at
 * all: a controller two thirds of the way between saw and pulse is not a sound.
 */
export function ccValue(raw: number, param: CcParamRange): number {
  const clamped = raw < 0 ? 0 : raw > 127 ? 127 : raw
  const value = param.min + (clamped / 127) * (param.max - param.min)
  return param.stepped ? Math.round(value) : value
}

/** `CC 74` / `CC 74 ch 3`, for a faceplate. Short, because it sits under a knob. */
export function describeBinding(binding: CcBinding): string {
  return binding.channel === 0 ? `CC ${binding.cc}` : `CC ${binding.cc} ch${binding.channel}`
}
