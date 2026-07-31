import {
  ALL_VOICES,
  GROOVEBOX_SECTIONS,
  REST,
  bassStepAt,
  cycleStep,
  decodeSong,
  setBassStep,
  stepAt,
  type GrooveboxSection,
  type Pattern,
} from '@driftbox/engine'
import { GROOVEBOX_PORTS } from '@driftbox/rack'
import { useState } from 'react'
import { ParamControl } from '../ParamControl.js'
import { useMeter } from '../meter.js'
import { useRack } from '../store.js'
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

export function GrooveboxPatternEditor({
  encoded,
  setPattern,
  setClip,
  launch,
  launches,
}: {
  encoded?: string
  setPattern: (pattern: Pattern) => void
  setClip: (section: number, machine: GrooveboxSection, patternId: string) => void
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
}) {
  const song = encoded ? decodeSong(encoded) : null
  const [wantedPattern, setWantedPattern] = useState('')
  const [section, setSection] = useState<GrooveboxSection>('tr808')
  const [wantedVoice, setWantedVoice] = useState('')
  const [page, setPage] = useState(0)
  const [selectedStep, setSelectedStep] = useState(0)
  const [arrangementSection, setArrangementSection] = useState(0)

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
  const selected = Math.min(pattern.length - 1, Math.max(0, selectedStep))
  const bassStep = bass ? bassStepAt(pattern, section, selected) : REST
  const chain =
    song.chain.length > 0
      ? song.chain
      : [{ pattern: song.patterns[0].id, repeat: 1 }]
  const shownSection = Math.min(arrangementSection, chain.length - 1)
  const chainStep = chain[shownSection]
  const clipPattern = chainStep.clips?.[section] ?? chainStep.pattern
  const live = launches?.[section]
  const livePattern =
    live?.patternId === null
      ? 'song'
      : song.patterns.find((candidate) => candidate.id === live?.patternId)?.name ??
        live?.patternId

  const save = (next: Pattern) => setPattern(next)

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
              setSection(event.target.value as GrooveboxSection)
              setWantedVoice('')
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
              onChange={(event) => setWantedVoice(event.target.value)}
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
                onClick={() => setSelectedStep(step)}
              >
                {step + 1}
              </button>
            )
          }

          const value = voice ? stepAt(pattern, voice.id, step) : 0
          return (
            <button
              type="button"
              key={step}
              data-state={stepState(value)}
              aria-label={`${voice?.name ?? 'Drum'} step ${step + 1}: ${stepState(value)}`}
              onClick={() => {
                if (voice) save(cycleStep(pattern, voice.id, step))
              }}
            >
              {step + 1}
            </button>
          )
        })}
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
  const launch = useRack((state) => state.grooveboxLauncher)
  const launches = useRack((state) => state.grooveboxLaunches)
  return (
    <GrooveboxPatternEditor
      encoded={encoded}
      setPattern={setPattern}
      setClip={setClip}
      launch={launch ?? undefined}
      launches={launches}
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
