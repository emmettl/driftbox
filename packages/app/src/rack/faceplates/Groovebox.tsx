import {
  ALL_VOICES,
  DEFAULT_BASS_PARAMS,
  DEFAULT_FX,
  DEFAULT_PARAMS,
  DEFAULT_SENDS,
  GROOVEBOX_SECTIONS,
  REST,
  alterBassLine,
  alterTrack,
  bassStepAt,
  chainBarAt,
  clearBassLine,
  clearTrack,
  copyBassLine,
  copyDrumLane,
  cycleStep,
  cyclePcfStep,
  decodeSong,
  delayDivision,
  pcfAt,
  pcfDecaySeconds,
  pcfFrequency,
  flamAt,
  randomizeBassLine,
  randomizeTrack,
  rotateBassLine,
  rotateTrack,
  pasteBassLine,
  pasteDrumLane,
  setBassStep,
  songBars,
  stepAt,
  swingFor,
  toggleFlam,
  transposeBassLine,
  type BassParams,
  type BassLineClipboard,
  type DrumLaneClipboard,
  type FxParams,
  type GrooveboxSection,
  type Pattern,
  type SendLevels,
  type VoiceParams,
} from '@driftbox/engine'
import { GROOVEBOX_PORTS } from '@driftbox/rack'
import { useEffect, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { Knob } from '../../ui/Knob.js'
import { useMeter } from '../meter.js'
import { useRack, type GrooveboxTapTarget } from '../store.js'
import { meterLabel, meterPosition } from './meter-display.js'
import type { FaceplateProps } from './types.js'

const sectionName = (section: (typeof GROOVEBOX_SECTIONS)[number]): string =>
  section === 'tr808'
    ? '808'
    : section === 'tr909'
      ? '909'
      : section === '303.a'
        ? '303 A'
        : '303 B'

function SectionMeter({ id, name }: { id: string; name: string }) {
  const reading = useMeter(id)
  const position = meterPosition(reading.envelope)
  const db = reading.level > 0
    ? Math.max(-48, 20 * Math.log10(reading.level))
    : -48

  return (
    <div
      className="rk-groovebox-meter"
      data-clip={reading.peak > 1 ? 'yes' : 'no'}
      role="meter"
      aria-label={`${name} output level`}
      aria-valuemin={-48}
      aria-valuemax={3}
      aria-valuenow={db}
      title={meterLabel(reading.level)}
    >
      <i style={{ width: `${position * 100}%` }} />
    </div>
  )
}

const PAGE = 16

const stepState = (value: number): string =>
  value === 2 ? 'accent' : value === 1 ? 'hit' : 'rest'

const DRUM_KNOBS: readonly { key: keyof VoiceParams; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'tune', label: 'Tune' },
  { key: 'decay', label: 'Decay' },
  { key: 'tone', label: 'Tone' },
  { key: 'colour', label: 'Colour' },
  { key: 'pan', label: 'Pan' },
]

const BASS_KNOBS: readonly { key: keyof BassParams; label: string }[] = [
  { key: 'tune', label: 'Tune' },
  { key: 'wave', label: 'Wave' },
  { key: 'cutoff', label: 'Cutoff' },
  { key: 'resonance', label: 'Reso' },
  { key: 'envMod', label: 'Env Mod' },
  { key: 'decay', label: 'Decay' },
  { key: 'accent', label: 'Accent' },
  { key: 'level', label: 'Level' },
]

const SEND_KNOBS: readonly { key: keyof SendLevels; label: string }[] = [
  { key: 'delay', label: 'Delay' },
  { key: 'reverb', label: 'Reverb' },
]

const FX_KNOBS: readonly {
  key: keyof FxParams
  label: string
  format: (value: number) => string
}[] = [
  { key: 'drive', label: 'Drive', format: (value) => value === 0 ? 'clean' : percent(value) },
  { key: 'pcfAmount', label: 'PCF', format: (value) => value === 0 ? 'off' : percent(value) },
  { key: 'pcfCutoff', label: 'Cutoff', format: (value) => `${Math.round(pcfFrequency(value))}Hz` },
  { key: 'pcfResonance', label: 'Reso', format: (value) => percent(value) },
  { key: 'pcfEnv', label: 'Env', format: (value) => percent(value) },
  { key: 'pcfDecay', label: 'Decay', format: (value) => `${Math.round(pcfDecaySeconds(value) * 1000)}ms` },
  { key: 'compressor', label: 'Comp', format: (value) => value === 0 ? 'off' : percent(value) },
  { key: 'delayTime', label: 'Time', format: (value) => `${delayDivision(value)}/16` },
  { key: 'delayFeedback', label: 'F.back', format: (value) => percent(value) },
  { key: 'delayTone', label: 'FX Tone', format: (value) => percent(value) },
  { key: 'reverbSize', label: 'Size', format: (value) => `${(0.3 + value * 3.5).toFixed(1)}s` },
  { key: 'reverbDamping', label: 'Damp', format: (value) => percent(value) },
]

const percent = (value: number): string => `${Math.round(value * 100)}`
const pan = (value: number): string => {
  const amount = Math.round((value - 0.5) * 200)
  return amount === 0 ? 'C' : amount < 0 ? `L${-amount}` : `R${amount}`
}
const wave = (value: number): string => (value < 0.5 ? 'saw' : 'sqr')

type FocusClipboard =
  | {
      kind: 'drum'
      label: string
      section: GrooveboxSection
      lanes: DrumLaneClipboard[]
    }
  | { kind: 'bass'; label: string; line: BassLineClipboard }

export function GrooveboxPatternEditor({
  encoded,
  setPattern,
  setClip,
  setVoiceParam,
  setBassParam,
  setFlamWidth,
  setSwing,
  setVoiceSwing,
  setSend,
  setFx,
  tapRecording = false,
  tapStep = 0,
  toggleTapRecording,
  setTapTarget,
  setTapStep,
  automationRecording = false,
  running = false,
  toggleAutomationRecording,
  clearAutomation,
  launch,
  launches,
  transport,
  loop,
  initialSection = 'tr808',
}: {
  encoded?: string
  setPattern: (pattern: Pattern, discrete?: boolean) => void
  setClip: (section: number, machine: GrooveboxSection, patternId: string) => void
  setVoiceParam: (
    voiceId: string,
    key: keyof VoiceParams,
    value: number,
  ) => void
  setBassParam: (
    voiceId: '303.a' | '303.b',
    key: keyof BassParams,
    value: number,
  ) => void
  setFlamWidth: (value: number) => void
  setSwing: (value: number) => void
  setVoiceSwing: (voiceId: string, value: number) => void
  setSend: (voiceId: string, key: keyof SendLevels, value: number) => void
  setFx: (key: keyof FxParams, value: number) => void
  tapRecording?: boolean
  tapStep?: number
  toggleTapRecording: () => void
  setTapTarget: (target: GrooveboxTapTarget) => void
  setTapStep?: (step: number) => void
  automationRecording?: boolean
  running?: boolean
  toggleAutomationRecording: () => void
  clearAutomation: () => void
  launch?: (
    machine: GrooveboxSection,
    patternId: string | null,
  ) => boolean
  launches?: Partial<
    Record<
      GrooveboxSection,
      { patternId: string | null; phase: 'queued' | 'active' }
    >
  >
  transport?: {
    startAt: (bar: number) => boolean
    setLoop: (start: number, bars: number) => boolean
    clearLoop: () => void
  }
  loop?: { start: number; bars: number } | null
  /** Initial machine for static hosts and focused tests; the live faceplate starts on 808. */
  initialSection?: GrooveboxSection
}) {
  const song = encoded ? decodeSong(encoded) : null
  const [wantedPattern, setWantedPattern] = useState('')
  const [section, setSection] = useState<GrooveboxSection>(initialSection)
  const [wantedVoice, setWantedVoice] = useState('')
  const [page, setPage] = useState(0)
  const [selectedStep, setSelectedStep] = useState(0)
  const [arrangementSection, setArrangementSection] = useState(0)
  const [loopStart, setLoopStart] = useState(1)
  const [loopBars, setLoopBars] = useState(1)
  const [wholeMachine, setWholeMachine] = useState(false)
  const [flamMode, setFlamMode] = useState(false)
  const [clipboard, setClipboard] = useState<FocusClipboard | null>(null)
  useEffect(() => {
    if (!loop) return
    setLoopStart(loop.start + 1)
    setLoopBars(loop.bars)
  }, [loop])

  if (!song || song.patterns.length === 0) {
    return <p className="rk-groovebox-editor-empty">Retained song unavailable.</p>
  }

  const pattern =
    song.patterns.find((candidate) => candidate.id === wantedPattern) ?? song.patterns[0]
  const pages = Math.max(1, Math.ceil(pattern.length / PAGE))
  const shownPage = Math.min(page, pages - 1)
  const firstStep = shownPage * PAGE
  const steps = Array.from(
    { length: Math.min(PAGE, pattern.length - firstStep) },
    (_, index) => firstStep + index,
  )
  const voices = ALL_VOICES.filter((voice) => voice.machine === section)
  const voice =
    voices.find((candidate) => candidate.id === wantedVoice) ?? voices[0]
  const bass = section === '303.a' || section === '303.b'
  const selected = bass
    ? ((Math.floor(tapStep) % pattern.length) + pattern.length) % pattern.length
    : Math.min(pattern.length - 1, Math.max(0, selectedStep))
  const bassStep = bass ? bassStepAt(pattern, section, selected) : REST
  const chain =
    song.chain.length > 0
      ? song.chain
      : [{ pattern: song.patterns[0].id, repeat: 1 }]
  const shownSection = Math.min(arrangementSection, chain.length - 1)
  const chainStep = chain[shownSection]
  const sectionStart = chainBarAt(song, shownSection)
  const totalBars = Math.max(1, songBars(song))
  const sectionLooping =
    loop?.start === sectionStart && loop.bars === Math.max(1, chainStep.repeat)
  const automationLanes = song.automation?.length ?? 0
  const automationPoints =
    song.automation?.reduce((total, lane) => total + lane.points.length, 0) ?? 0
  const clipPattern = chainStep.clips?.[section] ?? chainStep.pattern
  const live = launches?.[section]
  const livePattern =
    live?.patternId === null
      ? 'song'
      : song.patterns.find((candidate) => candidate.id === live?.patternId)?.name ??
        live?.patternId
  const drumParams = voice
    ? song.kit.params[voice.id] ?? DEFAULT_PARAMS
    : DEFAULT_PARAMS
  const bassParams = bass
    ? song.kit.bass?.[section] ?? DEFAULT_BASS_PARAMS
    : DEFAULT_BASS_PARAMS
  const routingVoice = bass ? section : voice?.id
  const routingName = bass ? sectionName(section) : voice?.name ?? sectionName(section)
  const routingColour = bass ? '#ffb02e' : section === 'tr909' ? '#5ff0d0' : '#ff7ad9'
  const sends = routingVoice
    ? song.kit.sends?.[routingVoice] ?? DEFAULT_SENDS
    : DEFAULT_SENDS
  const swingOffset = routingVoice ? song.kit.swing?.[routingVoice] ?? 0.5 : 0.5
  const effectiveSwing = routingVoice
    ? Math.round(swingFor(song, routingVoice) * 100)
    : Math.round(song.swing * 100)
  const fx = song.fx ?? DEFAULT_FX

  const save = (next: Pattern, discrete = false) => {
    if (next !== pattern) setPattern(next, discrete)
  }
  const rotate = (delta: number) => {
    let next = pattern
    if (bass) {
      next = rotateBassLine(next, section, delta)
    } else {
      const targets = wholeMachine
        ? voices.map((candidate) => candidate.id)
        : voice
          ? [voice.id]
          : []
      for (const target of targets) next = rotateTrack(next, target, delta)
    }
    save(next, true)
  }
  const randomize = () => {
    if (bass) save(randomizeBassLine(pattern, section), true)
    else if (voice) save(randomizeTrack(pattern, voice.id), true)
  }
  const alter = () => {
    if (bass) save(alterBassLine(pattern, section), true)
    else if (voice) save(alterTrack(pattern, voice.id), true)
  }
  const focusedTarget = bass
    ? sectionName(section)
    : voice?.name ?? sectionName(section)
  const rotateTarget =
    !bass && wholeMachine ? `whole ${sectionName(section)}` : focusedTarget
  const tapTarget = (
    patternId: string,
    nextSection: GrooveboxSection,
    voiceId?: string,
  ): GrooveboxTapTarget => ({
    patternId,
    section: nextSection,
    voiceId:
      nextSection === '303.a' || nextSection === '303.b'
        ? nextSection
        : voiceId ?? ALL_VOICES.find((candidate) => candidate.machine === nextSection)?.id ?? '',
  })
  const focusedDrums = wholeMachine ? voices : voice ? [voice] : []
  const copyFocused = (): FocusClipboard | null => {
    if (bass) {
      const copied: FocusClipboard = {
        kind: 'bass',
        label: sectionName(section),
        line: copyBassLine(pattern, section),
      }
      setClipboard(copied)
      return copied
    }
    if (focusedDrums.length === 0) return null
    const copied: FocusClipboard = {
      kind: 'drum',
      label: wholeMachine ? `whole ${sectionName(section)}` : focusedDrums[0].name,
      section,
      lanes: focusedDrums.map((candidate) => copyDrumLane(pattern, candidate.id)),
    }
    setClipboard(copied)
    return copied
  }
  const cutFocused = () => {
    if (!copyFocused()) return
    let next = pattern
    if (bass) next = clearBassLine(next, section)
    else for (const candidate of focusedDrums) next = clearTrack(next, candidate.id)
    save(next, true)
  }
  const canPaste =
    clipboard?.kind === (bass ? 'bass' : 'drum') &&
    (clipboard?.kind !== 'drum' || clipboard.lanes.length === 1 || clipboard.section === section)
  const pasteFocused = () => {
    if (!clipboard || !canPaste) return
    let next = pattern
    if (clipboard.kind === 'bass' && bass) {
      next = pasteBassLine(next, section, clipboard.line)
    } else if (clipboard.kind === 'drum' && !bass) {
      const targets = clipboard.lanes.length > 1 ? voices : focusedDrums.slice(0, 1)
      targets.forEach((candidate, index) => {
        const lane = clipboard.lanes[index]
        if (lane) next = pasteDrumLane(next, candidate.id, lane)
      })
    }
    save(next, true)
  }

  return (
    <section className="rk-groovebox-editor" aria-label="Groovebox pattern editor">
      <div className="rk-groovebox-editor-bar">
        <label>
          Pattern
          <select
            aria-label="Pattern to edit"
            value={pattern.id}
            onChange={(event) => {
              setWantedPattern(event.target.value)
              setPage(0)
              setSelectedStep(0)
              setTapStep?.(0)
              setTapTarget(tapTarget(event.target.value, section, voice?.id))
            }}
          >
            {song.patterns.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Machine
          <select
            aria-label="Machine to edit"
            value={section}
            onChange={(event) => {
              const next = event.target.value as GrooveboxSection
              setSection(next)
              setWantedVoice('')
              setTapTarget(tapTarget(pattern.id, next))
            }}
          >
            {GROOVEBOX_SECTIONS.map((candidate) => (
              <option value={candidate} key={candidate}>
                {sectionName(candidate)}
              </option>
            ))}
          </select>
        </label>
        {!bass && voice && (
          <label>
            Voice
            <select
              aria-label="Drum voice to edit"
              value={voice.id}
              onChange={(event) => {
                setWantedVoice(event.target.value)
                setTapTarget(tapTarget(pattern.id, section, event.target.value))
              }}
            >
              {voices.map((candidate) => (
                <option value={candidate.id} key={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="rk-groovebox-page">
          <button
            type="button"
            disabled={shownPage === 0}
            onClick={() => setPage(Math.max(0, shownPage - 1))}
            aria-label="Previous 16 steps"
          >
            ←
          </button>
          {firstStep + 1}–{firstStep + steps.length}
          <button
            type="button"
            disabled={shownPage >= pages - 1}
            onClick={() => setPage(Math.min(pages - 1, shownPage + 1))}
            aria-label="Next 16 steps"
          >
            →
          </button>
        </span>
      </div>

      <div className="rk-groovebox-steps">
        {steps.map((step) => {
          if (bass) {
            const value = bassStepAt(pattern, section, step)
            const label =
              value.note === null
                ? 'rest'
                : `note ${value.note}${value.accent ? ', accent' : ''}${value.slide ? ', slide' : ''}`
            return (
              <button
                type="button"
                key={step}
                data-state={value.note === null ? 'rest' : value.accent ? 'accent' : 'hit'}
                aria-pressed={selected === step}
                aria-label={`${sectionName(section)} step ${step + 1}: ${label}`}
                onClick={() => {
                  setSelectedStep(step)
                  setTapStep?.(step)
                }}
              >
                {step + 1}
              </button>
            )
          }

          const value = voice ? stepAt(pattern, voice.id, step) : 0
          const flam =
            section === 'tr909' && voice ? flamAt(pattern, voice.id, step) : false
          return (
            <button
              type="button"
              key={step}
              data-state={stepState(value)}
              data-flam={flam ? 'yes' : undefined}
              aria-label={`${voice?.name ?? 'Drum'} step ${step + 1}: ${stepState(value)}${flam ? ', flam' : ''}`}
              onClick={() => {
                if (!voice) return
                save(
                  section === 'tr909' && flamMode
                    ? toggleFlam(pattern, voice.id, step)
                    : cycleStep(pattern, voice.id, step),
                )
              }}
            >
              {step + 1}
            </button>
          )
        })}
      </div>

      <div className="rk-groovebox-pcf" aria-label="Pattern-controlled filter steps">
        <strong>PCF</strong>
        <div className="rk-groovebox-steps">
          {steps.map((step) => {
            const value = pcfAt(pattern, step)
            return (
              <button
                key={step}
                type="button"
                data-state={value === 0 ? 'rest' : value === 1 ? 'hit' : 'accent'}
                onClick={() => save(cyclePcfStep(pattern, step), true)}
                aria-label={`PCF step ${step + 1}: ${value === 0 ? 'off' : value === 1 ? 'on' : 'accent'}`}
                aria-pressed={value !== 0}
              >
                {step + 1}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rk-groovebox-tools" aria-label="Groovebox pattern transforms">
        <strong>{rotateTarget}</strong>
        <button
          type="button"
          className="rk-groovebox-tap"
          aria-pressed={tapRecording}
          aria-label={
            tapRecording
              ? 'Disarm Groovebox tap recording'
              : 'Arm Groovebox tap recording'
          }
          title={
            tapRecording
              ? bass
                ? `303 entry armed — stopped: cursor step ${selected + 1}; playing: hosted playhead`
                : running
                  ? `Recording keyboard taps into ${focusedTarget} at the hosted playhead`
                  : 'Tap recording armed — start playback, then play the rack keyboard'
              : `Quantise rack keyboard taps into the focused ${focusedTarget} clip`
          }
          onClick={() => {
            setTapTarget(tapTarget(pattern.id, section, voice?.id))
            toggleTapRecording()
          }}
        >
          <span aria-hidden="true">●</span> tap
        </button>
        {!bass && (
          <button
            type="button"
            aria-pressed={wholeMachine}
            onClick={() => setWholeMachine((current) => !current)}
            title={`Rotate ${wholeMachine ? `only ${voice?.name ?? 'the selected lane'}` : `the whole ${sectionName(section)}`}`}
          >
            {wholeMachine ? 'all' : 'lane'}
          </button>
        )}
        {section === 'tr909' && (
          <button
            type="button"
            aria-pressed={flamMode}
            onClick={() => setFlamMode((current) => !current)}
            title="Program a second, closely spaced strike on 909 steps"
          >
            flam
          </button>
        )}
        <button type="button" onClick={() => rotate(-1)} aria-label={`Rotate ${rotateTarget} left`}>
          ←
        </button>
        <button type="button" onClick={() => rotate(1)} aria-label={`Rotate ${rotateTarget} right`}>
          →
        </button>
        {section === 'tr909' && flamMode ? (
          <label>
            Flam width
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={song.kit.flam ?? 0.4}
              onChange={(event) => setFlamWidth(Number(event.target.value))}
              aria-label="Groovebox flam width"
            />
          </label>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Randomise ${focusedTarget}? This replaces that lane.`)) randomize()
              }}
            >
              random
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Alter ${focusedTarget}? This rearranges its existing material.`)) alter()
              }}
            >
              alter
            </button>
          </>
        )}
        {bass && (
          <>
            <button
              type="button"
              onClick={() => save(transposeBassLine(pattern, section, -1), true)}
              aria-label={`Transpose ${focusedTarget} down`}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => save(transposeBassLine(pattern, section, 1), true)}
              aria-label={`Transpose ${focusedTarget} up`}
            >
              +
            </button>
          </>
        )}
      </div>

      <div className="rk-groovebox-clipboard" aria-label="Groovebox focused clipboard">
        <strong>{rotateTarget}</strong>
        <button type="button" onClick={cutFocused} aria-label={`Cut ${rotateTarget}`}>
          cut
        </button>
        <button type="button" onClick={copyFocused} aria-label={`Copy ${rotateTarget}`}>
          copy
        </button>
        <button
          type="button"
          disabled={!canPaste}
          onClick={pasteFocused}
          aria-label={`Paste into ${rotateTarget}`}
          title={
            canPaste && clipboard
              ? `Paste ${clipboard.label} into ${rotateTarget}`
              : clipboard?.kind === 'drum' && clipboard.lanes.length > 1
                ? 'A whole-machine clipboard pastes into the same drum machine'
              : `Copy a ${bass ? '303 line' : 'drum lane or machine'} first`
          }
        >
          paste
        </button>
        <span aria-live="polite">
          {clipboard ? `${clipboard.label} copied` : 'clipboard empty'}
        </span>
      </div>

      <div className="rk-groovebox-automation" aria-label="Groovebox automation recorder">
        <button
          type="button"
          aria-pressed={automationRecording}
          aria-label={
            automationRecording
              ? 'Disarm Groovebox automation recording'
              : 'Arm Groovebox automation recording'
          }
          title={
            automationRecording
              ? running
                ? 'Recording supported controls at the hosted song playhead'
                : 'Automation armed — start playback, then move a supported control'
              : 'Record tempo, swing and instrument controls into the retained song'
          }
          onClick={toggleAutomationRecording}
        >
          <span aria-hidden="true">●</span> auto
        </button>
        <label>
          Swing
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={song.swing}
            onChange={(event) => setSwing(Number(event.target.value))}
            aria-label="Groovebox swing"
          />
          <b>{Math.round(song.swing * 100)}</b>
        </label>
        <span aria-live="polite">
          {automationRecording ? (running ? 'recording' : 'armed') : `${automationLanes} lanes`}
          {automationPoints > 0 ? ` · ${automationPoints} points` : ''}
        </span>
        <button
          type="button"
          disabled={automationLanes === 0}
          onClick={clearAutomation}
          aria-label="Clear Groovebox automation"
          title="Clear all retained automation lanes; rack undo can restore them"
        >
          clear
        </button>
      </div>

      <div className="rk-groovebox-clip" aria-label="Groovebox clip arrangement">
        <label>
          Section
          <select
            aria-label="Arrangement section"
            value={shownSection}
            onChange={(event) => setArrangementSection(Number(event.target.value))}
          >
            {chain.map((step, index) => (
              <option value={index} key={index}>
                {index + 1} · {step.repeat} bar{step.repeat === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <label>
          {sectionName(section)} clip
          <select
            aria-label={`${sectionName(section)} clip in section ${shownSection + 1}`}
            value={clipPattern}
            onChange={(event) => setClip(shownSection, section, event.target.value)}
          >
            {song.patterns.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {clipPattern === chainStep.pattern ? (
          <span>follows section</span>
        ) : (
          <span>machine override</span>
        )}
      </div>

      <div className="rk-groovebox-live" aria-label={`${sectionName(section)} live clip`}>
        <button
          type="button"
          disabled={!launch}
          onClick={() => launch?.(section, pattern.id)}
        >
          Launch {pattern.name}
        </button>
        <button
          type="button"
          disabled={!launch}
          onClick={() => launch?.(section, null)}
        >
          Follow song
        </button>
        <span aria-live="polite">
          {live ? `${live.phase} ${livePattern}` : 'follows song'}
        </span>
      </div>

      <div className="rk-groovebox-transport" aria-label="Groovebox transport">
        <button
          type="button"
          disabled={!transport}
          onClick={() => transport?.startAt(sectionStart)}
          aria-label={`Play from section ${shownSection + 1}`}
        >
          ▶ section
        </button>
        <button
          type="button"
          disabled={!transport}
          aria-pressed={sectionLooping}
          onClick={() =>
            sectionLooping
              ? transport?.clearLoop()
              : transport?.setLoop(sectionStart, chainStep.repeat)
          }
          aria-label={`Loop section ${shownSection + 1}`}
        >
          loop section
        </button>
        <label>
          From
          <input
            type="number"
            min={1}
            max={totalBars}
            value={loopStart}
            onChange={(event) => setLoopStart(Number(event.target.value))}
            aria-label="Groovebox loop start bar"
          />
        </label>
        <label>
          Bars
          <input
            type="number"
            min={1}
            max={Math.max(1, totalBars - loopStart + 1)}
            value={loopBars}
            onChange={(event) => setLoopBars(Number(event.target.value))}
            aria-label="Groovebox loop length in bars"
          />
        </label>
        <button
          type="button"
          disabled={!transport}
          onClick={() => transport?.setLoop(loopStart - 1, loopBars)}
        >
          set
        </button>
        <button
          type="button"
          disabled={!transport || !loop}
          onClick={() => transport?.clearLoop()}
        >
          clear
        </button>
      </div>

      <div
        className="rk-groovebox-instrument"
        aria-label={`${bass ? sectionName(section) : voice?.name ?? sectionName(section)} instrument controls`}
      >
        {bass
          ? BASS_KNOBS.map(({ key, label }) => (
              <Knob
                key={key}
                label={label}
                value={bassParams[key]}
                colour="#ffb02e"
                format={key === 'wave' ? wave : percent}
                onChange={(value) =>
                  setBassParam(section as '303.a' | '303.b', key, value)
                }
              />
            ))
          : voice &&
            DRUM_KNOBS.map(({ key, label }) => (
              <Knob
                key={key}
                label={label}
                value={drumParams[key]}
                colour={section === 'tr909' ? '#5ff0d0' : '#ff7ad9'}
                format={key === 'pan' ? pan : percent}
                onChange={(value) => setVoiceParam(voice.id, key, value)}
              />
            ))}
      </div>

      {routingVoice && (
        <div
          className="rk-groovebox-mix"
          aria-label={`${routingName} sends and shared effects`}
        >
          {SEND_KNOBS.map(({ key, label }) => (
            <Knob
              key={`send:${key}`}
              label={label}
              value={sends[key]}
              colour={routingColour}
              format={percent}
              onChange={(value) => setSend(routingVoice, key, value)}
            />
          ))}
          <Knob
            label="Swing"
            value={swingOffset}
            colour={routingColour}
            format={() => (swingOffset === 0.5 ? `· ${effectiveSwing}` : `${effectiveSwing}`)}
            onChange={(value) => setVoiceSwing(routingVoice, value)}
          />
          {FX_KNOBS.map(({ key, label, format }) => (
            <Knob
              key={`fx:${key}`}
              label={label}
              value={fx[key]}
              colour="#9d95c8"
              format={format}
              onChange={(value) => setFx(key, value)}
            />
          ))}
        </div>
      )}

      {bass && (
        <div className="rk-groovebox-bass" aria-label={`${sectionName(section)} selected step`}>
          <strong>Step {selected + 1}</strong>
          <button
            type="button"
            aria-pressed={bassStep.note !== null}
            onClick={() =>
              save(
                setBassStep(
                  pattern,
                  section,
                  selected,
                  bassStep.note === null ? { note: 0, accent: false, slide: false } : { ...REST },
                ),
              )
            }
          >
            {bassStep.note === null ? 'Add note' : 'Rest'}
          </button>
          <button
            type="button"
            disabled={bassStep.note === null || bassStep.note <= 0}
            aria-label="Lower selected note"
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  note: Math.max(0, (bassStep.note ?? 0) - 1),
                }),
              )
            }
          >
            −
          </button>
          <span className="rk-groovebox-note">
            {bassStep.note === null ? '—' : bassStep.note}
          </span>
          <button
            type="button"
            disabled={bassStep.note === null || bassStep.note >= 24}
            aria-label="Raise selected note"
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  note: Math.min(24, (bassStep.note ?? 0) + 1),
                }),
              )
            }
          >
            +
          </button>
          <button
            type="button"
            disabled={bassStep.note === null}
            aria-pressed={bassStep.accent}
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  accent: !bassStep.accent,
                }),
              )
            }
          >
            Accent
          </button>
          <button
            type="button"
            disabled={bassStep.note === null}
            aria-pressed={bassStep.slide}
            onClick={() =>
              save(
                setBassStep(pattern, section, selected, {
                  ...bassStep,
                  slide: !bassStep.slide,
                }),
              )
            }
          >
            Slide
          </button>
        </div>
      )}
    </section>
  )
}

function PatternEditor() {
  const encoded = useRack((state) => state.patch.groovebox)
  const setPattern = useRack((state) => state.setGrooveboxPattern)
  const setClip = useRack((state) => state.setGrooveboxClip)
  const setVoiceParam = useRack((state) => state.setGrooveboxVoiceParam)
  const setBassParam = useRack((state) => state.setGrooveboxBassParam)
  const setFlamWidth = useRack((state) => state.setGrooveboxFlamWidth)
  const setSwing = useRack((state) => state.setGrooveboxSwing)
  const setVoiceSwing = useRack((state) => state.setGrooveboxVoiceSwing)
  const setSend = useRack((state) => state.setGrooveboxSend)
  const setFx = useRack((state) => state.setGrooveboxFx)
  const tapRecording = useRack((state) => state.grooveboxTapRecording)
  const toggleTapRecording = useRack((state) => state.toggleGrooveboxTapRecording)
  const setTapTarget = useRack((state) => state.setGrooveboxTapTarget)
  const tapStep = useRack((state) => state.grooveboxTapStep)
  const setTapStep = useRack((state) => state.setGrooveboxTapStep)
  const automationRecording = useRack((state) => state.grooveboxAutomationRecording)
  const running = useRack((state) => state.running)
  const toggleAutomationRecording = useRack(
    (state) => state.toggleGrooveboxAutomationRecording,
  )
  const clearAutomation = useRack((state) => state.clearGrooveboxAutomation)
  const launch = useRack((state) => state.grooveboxLauncher)
  const launches = useRack((state) => state.grooveboxLaunches)
  const transport = useRack((state) => state.grooveboxTransport)
  const loop = useRack((state) => state.grooveboxLoop)
  return (
    <GrooveboxPatternEditor
      encoded={encoded}
      setPattern={setPattern}
      setClip={setClip}
      setVoiceParam={setVoiceParam}
      setBassParam={setBassParam}
      setFlamWidth={setFlamWidth}
      setSwing={setSwing}
      setVoiceSwing={setVoiceSwing}
      setSend={setSend}
      setFx={setFx}
      tapRecording={tapRecording}
      tapStep={tapStep}
      toggleTapRecording={toggleTapRecording}
      setTapTarget={setTapTarget}
      setTapStep={setTapStep}
      automationRecording={automationRecording}
      running={running}
      toggleAutomationRecording={toggleAutomationRecording}
      clearAutomation={clearAutomation}
      launch={launch ?? undefined}
      launches={launches}
      transport={transport ?? undefined}
      loop={loop}
    />
  )
}

/**
 * Four source strips for the authored machines retained inside a rack document.
 *
 * These controls deliberately belong to the derived Groovebox device rather than to a
 * second copy of the sequencer. Their unity defaults leave the original song untouched;
 * once a section is patched, the strip shapes the ordinary stereo rack signal.
 */
export function Groovebox({ def, module, value, onChange, routed }: FaceplateProps) {
  const param = (id: string) => def.params.find((candidate) => candidate.id === id)!

  return (
    <>
      <header className="rk-title">
        <span className="rk-name">Groovebox</span>
        <span className="rk-ports">4 stereo sources</span>
      </header>
      <div className="rk-groovebox-strips">
        {GROOVEBOX_SECTIONS.map((section) => {
          const ports = GROOVEBOX_PORTS[section]
          const name = sectionName(section)
          return (
            <section
              className="rk-groovebox-strip"
              aria-label={`${name} source strip`}
              key={section}
            >
              <strong>{name}</strong>
              <SectionMeter id={`${module.id}:${section}`} name={name} />
              <ParamControl
                def={param(ports.level)}
                value={value(ports.level)}
                onChange={(next) => onChange(ports.level, next)}
                colour="var(--nine)"
                routed={routed?.(ports.level)}
              />
              <ParamControl
                def={param(ports.pan)}
                value={value(ports.pan)}
                onChange={(next) => onChange(ports.pan, next)}
                colour="var(--eight)"
                routed={routed?.(ports.pan)}
              />
              <ParamControl
                def={param(ports.mute)}
                value={value(ports.mute)}
                onChange={(next) => onChange(ports.mute, next)}
                routed={routed?.(ports.mute)}
              />
            </section>
          )
        })}
      </div>
      <PatternEditor />
    </>
  )
}
