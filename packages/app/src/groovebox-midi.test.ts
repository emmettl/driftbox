import { describe, expect, it, vi } from 'vitest'
import { AUTOMATION_TARGET } from '@driftbox/engine'
import {
  applyGrooveboxMidiTarget,
  grooveboxMidiTargets,
  type GrooveboxMidiActions,
} from './groovebox-midi.js'

const actions = (): GrooveboxMidiActions => ({
  setBpm: vi.fn(),
  setSwing: vi.fn(),
  setParam: vi.fn(),
  setBassParam: vi.fn(),
  setSend: vi.fn(),
  setVoiceSwing: vi.fn(),
  setFx: vi.fn(),
})

describe('groovebox MIDI learn targets', () => {
  it('uses stable voice identities rather than a mutable selected-knob slot', () => {
    const first = grooveboxMidiTargets(false, '808.bd', '303.a')
    const second = grooveboxMidiTargets(false, '909.sd', '303.a')
    expect(first.some((target) => target.param === AUTOMATION_TARGET.voice('808.bd', 'level'))).toBe(true)
    expect(second.some((target) => target.param === AUTOMATION_TARGET.voice('909.sd', 'level'))).toBe(true)
    expect(second.some((target) => target.param.includes('808.bd'))).toBe(false)
  })

  it('offers the authored bass controls and routing in bass view', () => {
    const targets = grooveboxMidiTargets(true, '808.bd', '303.b')
    expect(targets.some((target) => target.param === AUTOMATION_TARGET.bass('303.b', 'cutoff'))).toBe(true)
    expect(targets.some((target) => target.param === AUTOMATION_TARGET.send('303.b', 'delay'))).toBe(true)
    expect(targets.find((target) => target.param === AUTOMATION_TARGET.bass('303.b', 'wave'))?.stepped).toBe(true)
  })
})

describe('applying learned controls', () => {
  it('dispatches every target family through the editor actions', () => {
    const a = actions()
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.bpm, 132, a)).toBe(true)
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.voice('808.bd', 'decay'), 0.4, a)).toBe(true)
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.bass('303.a', 'cutoff'), 0.8, a)).toBe(true)
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.send('909.sd', 'reverb'), 0.3, a)).toBe(true)
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.voiceSwing('909.sd'), 0.6, a)).toBe(true)
    expect(applyGrooveboxMidiTarget(AUTOMATION_TARGET.fx('delayTone'), 0.2, a)).toBe(true)
    expect(a.setBpm).toHaveBeenCalledWith(132)
    expect(a.setParam).toHaveBeenCalledWith('808.bd', 'decay', 0.4)
    expect(a.setBassParam).toHaveBeenCalledWith('303.a', 'cutoff', 0.8)
    expect(a.setSend).toHaveBeenCalledWith('909.sd', 'reverb', 0.3)
    expect(a.setVoiceSwing).toHaveBeenCalledWith('909.sd', 0.6)
    expect(a.setFx).toHaveBeenCalledWith('delayTone', 0.2)
  })

  it('leaves an unknown persisted target inert', () => {
    const a = actions()
    expect(applyGrooveboxMidiTarget('future/device/brightness', 0.5, a)).toBe(false)
    expect(Object.values(a).every((fn) => !vi.mocked(fn).mock.calls.length)).toBe(true)
  })
})
