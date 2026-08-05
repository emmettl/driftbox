import {
  GROOVEBOX_SECTIONS,
  REST,
  bassStepAt,
  decodeSong,
  setTrackLength,
  trackLength,
  type BassParams,
  type ClipLaunchQuantization,
  type FxParams,
  type GrooveboxSection,
  type Pattern,
  type SendLevels,
  type VoiceParams,
} from '@driftbox/engine'
import { GROOVEBOX_PORTS } from '@driftbox/rack'
import { useEffect, useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useMeter } from '../meter.js'
import { useRack, type GrooveboxTapTarget } from '../store.js'
import { GrooveboxArrangement } from './GrooveboxArrangement.js'
import { GrooveboxInstrument } from './GrooveboxInstrument.js'
import { GrooveboxSteps } from './GrooveboxSteps.js'
import { GrooveboxTools } from './GrooveboxTools.js'
import {
  arrangementView,
  focusedStep,
  stepWindow,
  tapTarget,
  type Launch,
} from './groovebox-editor.js'
import { grooveboxFocus, type FocusClipboard } from './groovebox-focus.js'
import { sectionName } from './groovebox-format.js'
import { meterLabel, meterPosition } from './meter-display.js'
import type { FaceplateProps } from './types.js'

// The Groovebox faceplate is the rack's window onto a retained song, and the editor behind it is a
// sequencer. It reached twelve hundred lines honestly — four machines, a pattern list, an arrangement,
// live clips, a hosted transport, an automation recorder and two clipboards is that much instrument —
// but almost none of it was about the component, and the only way to ask it a question was to open a
// browser and click.
//
// What moved out, by what a test can hold a claim against:
//
//   groovebox-format.ts   every string it puts on screen, including the ones only a reader hears
//   groovebox-editor.ts   which steps, which section, which voice the knobs are wired to
//   groovebox-focus.ts    what "the focus" is, and every edit that rewrites it at once
//   GrooveboxSteps        the step grid and the filter row
//   GrooveboxTools        the transforms and the clipboard
//   GrooveboxArrangement  automation, the chain, the live clip and the hosted transport
//   GrooveboxInstrument   the knobs, the sends and the note under the 303 cursor

function SectionMeter({ id, name }: { id: string; name: string }) {
  const reading = useMeter(id)
  const position = meterPosition(reading.envelope)
  const db = reading.level > 0 ? Math.max(-48, 20 * Math.log10(reading.level)) : -48

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
  launchQuantization = 'bar',
  setLaunchQuantization,
  launchRecording = false,
  toggleLaunchRecording,
  transport,
  loop,
  initialSection = 'tr808',
}: {
  encoded?: string
  setPattern: (pattern: Pattern, discrete?: boolean) => void
  setClip: (section: number, machine: GrooveboxSection, patternId: string) => void
  setVoiceParam: (voiceId: string, key: keyof VoiceParams, value: number) => void
  setBassParam: (voiceId: '303.a' | '303.b', key: keyof BassParams, value: number) => void
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
    quantization?: ClipLaunchQuantization,
  ) => boolean
  launches?: Partial<Record<GrooveboxSection, Launch>>
  launchQuantization?: ClipLaunchQuantization
  setLaunchQuantization?: (quantization: ClipLaunchQuantization) => void
  launchRecording?: boolean
  toggleLaunchRecording?: () => void
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
  const { pages, shownPage, firstStep, steps } = stepWindow(pattern.length, page)
  const focus = grooveboxFocus(section, wantedVoice, wholeMachine)
  const { bass, voice, voices } = focus
  const selected = focusedStep(bass, tapStep, selectedStep, pattern.length)
  const bassStep = bass ? bassStepAt(pattern, section, selected) : REST
  const arrangement = arrangementView(song, arrangementSection)

  const save = (next: Pattern, discrete = false) => {
    if (next !== pattern) setPattern(next, discrete)
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
          <>
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
            <label>
              Lane steps
              <input
                type="number"
                min={1}
                max={pattern.length}
                value={trackLength(pattern, voice.id)}
                onChange={(event) =>
                  save(setTrackLength(pattern, voice.id, Number(event.target.value)), true)
                }
                aria-label="Drum lane steps"
              />
            </label>
          </>
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

      <GrooveboxSteps
        pattern={pattern}
        focus={focus}
        steps={steps}
        selected={selected}
        flamMode={flamMode}
        onSelect={(step) => {
          setSelectedStep(step)
          setTapStep?.(step)
        }}
        save={save}
      />

      <GrooveboxTools
        song={song}
        pattern={pattern}
        focus={focus}
        selected={selected}
        tapRecording={tapRecording}
        running={running}
        flamMode={flamMode}
        setFlamMode={setFlamMode}
        setWholeMachine={setWholeMachine}
        clipboard={clipboard}
        setClipboard={setClipboard}
        armTap={() => {
          setTapTarget(tapTarget(pattern.id, section, voice?.id))
          toggleTapRecording()
        }}
        setFlamWidth={setFlamWidth}
        save={save}
      />

      <GrooveboxArrangement
        song={song}
        pattern={pattern}
        section={section}
        arrangement={arrangement}
        setArrangementSection={setArrangementSection}
        setClip={setClip}
        setSwing={setSwing}
        automationRecording={automationRecording}
        running={running}
        toggleAutomationRecording={toggleAutomationRecording}
        clearAutomation={clearAutomation}
        launch={launch}
        live={launches?.[section]}
        launchQuantization={launchQuantization}
        setLaunchQuantization={setLaunchQuantization}
        launchRecording={launchRecording}
        toggleLaunchRecording={toggleLaunchRecording}
        transport={transport}
        loop={loop}
        loopStart={loopStart}
        setLoopStart={setLoopStart}
        loopBars={loopBars}
        setLoopBars={setLoopBars}
      />

      <GrooveboxInstrument
        song={song}
        pattern={pattern}
        focus={focus}
        selected={selected}
        bassStep={bassStep}
        setVoiceParam={setVoiceParam}
        setBassParam={setBassParam}
        setSend={setSend}
        setVoiceSwing={setVoiceSwing}
        setFx={setFx}
        save={save}
      />
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
  const launchQuantization = useRack((state) => state.grooveboxLaunchQuantization)
  const setLaunchQuantization = useRack((state) => state.setGrooveboxLaunchQuantization)
  const launchRecording = useRack((state) => state.grooveboxLaunchRecording)
  const toggleLaunchRecording = useRack((state) => state.toggleGrooveboxLaunchRecording)
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
      launchQuantization={launchQuantization}
      setLaunchQuantization={setLaunchQuantization}
      launchRecording={launchRecording}
      toggleLaunchRecording={toggleLaunchRecording}
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
