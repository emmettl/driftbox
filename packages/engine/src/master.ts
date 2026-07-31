// The mastered Groovebox route, shared by live playback and offline mix export.
//
// These values used to live only inside DriftboxEngine. An offline mix that copied them
// locally could drift into a different master the next time the live bus was tuned, which
// would make "export" a subtly different song. Keep the small, node-only contract here;
// scheduling and song ownership still belong to their respective hosts.

export const MIX_BUS_GAIN = 0.9
export const MIX_MASTER_GAIN = 0.7

export function configureMixCompressor(compressor: DynamicsCompressorNode): void {
  compressor.threshold.value = -14
  compressor.knee.value = 8
  compressor.ratio.value = 4
  compressor.attack.value = 0.004
  compressor.release.value = 0.18
}
