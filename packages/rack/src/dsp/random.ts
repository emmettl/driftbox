// A small deterministic PRNG, shared by the modules that need randomness.
//
// `Math.random()` would be shorter and is wrong here twice over. It cannot be reproduced, so a
// noise module could only be tested against statistics rather than against a value; and worse, a
// patch containing noise would sound slightly different every time it was rebuilt, which quietly
// makes "the same patch is the same sound" false — the property the whole URL-sharing idea rests on.
//
// So the seed comes from the module's **id**, which the Graph passes to every processor it builds.
// An id is chosen by the patch and stays put, so:
//
//   - the same patch produces the same noise in every session, on every machine, and after any
//     unrelated edit that happens to rebuild the graph;
//   - two Noise modules have different ids and therefore decorrelate, which matters because two
//     identical noise sources summed are one source 6dB louder rather than two sources 3dB louder —
//     audible, and the kind of wrong that reads as a gain bug.
//
// It is a shared **dep** rather than three copies of xorshift pasted into three modules — the
// mechanism `worklet.ts` built for `Ladder`, used the way it was meant to be. Modules that want it
// declare `deps: { Random }` and look it up by string key, never by identifier.
//
// This class is SELF-CONTAINED: no imports, no references to anything at module scope, because
// `worklet.ts` serialises it with toString() into a scope that shares nothing with this module.

export class Random {
  private state: number

  /** Seeded from a string — a module id — or from a number directly, which is what the tests use. */
  constructor(seed: string | number) {
    let hash = 0x811c9dc5
    if (typeof seed === 'number') {
      hash = seed | 0
    } else {
      // FNV-1a. Cheap, and it spreads ids that differ only in their last character — `osc1` and
      // `osc2` — far enough apart that they do not start out correlated.
      for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i)
        hash = (hash * 0x01000193) | 0
      }
    }
    // Any non-zero state will do; xorshift is stuck at zero forever otherwise.
    this.state = hash || 0x9e3779b9
  }

  /** Uniform in [-1, 1). xorshift32: three shifts and three xors, and a period long enough that
   *  nobody will hear it repeat. */
  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x | 0
    // Divide by 2^31 rather than masking, so the sign of the 32-bit integer is the sign of the
    // sample and the distribution stays symmetrical about zero.
    return (x | 0) / 2147483648
  }
}
