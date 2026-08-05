import {
  CLIP_LAUNCH_QUANTIZATIONS,
  type ClipLaunchQuantization,
  type GrooveboxSection,
  type Pattern,
  type Song,
} from '@driftbox/engine'
import {
  automationSummary,
  sectionLooping,
  liveStatus,
  type ArrangementView,
  type Launch,
} from './groovebox-editor.js'
import {
  automationArmTitle,
  automationStatus,
  sectionName,
} from './groovebox-format.js'
import type { GrooveboxTransport } from '../groovebox-host.js'

interface Props {
  song: Song
  pattern: Pattern
  section: GrooveboxSection
  arrangement: ArrangementView
  setArrangementSection: (index: number) => void
  setClip: (section: number, machine: GrooveboxSection, patternId: string) => void
  setSwing: (value: number) => void
  automationRecording: boolean
  running: boolean
  toggleAutomationRecording: () => void
  clearAutomation: () => void
  launch?: (
    machine: GrooveboxSection,
    patternId: string | null,
    quantization?: ClipLaunchQuantization,
  ) => boolean
  live: Launch | undefined
  launchQuantization: ClipLaunchQuantization
  setLaunchQuantization?: (quantization: ClipLaunchQuantization) => void
  launchRecording: boolean
  toggleLaunchRecording?: () => void
  transport?: GrooveboxTransport
  loop?: { start: number; bars: number } | null
  loopStart: number
  setLoopStart: (bar: number) => void
  loopBars: number
  setLoopBars: (bars: number) => void
}

/**
 * Everything about when this machine's material plays: automation, the arrangement, the live clip and
 * the hosted transport.
 *
 * Four rows rather than one component each, because they are four views of the same timeline and only
 * make sense beside each other — a clip override in section three, a launch queued for the next bar and
 * a loop over section three are three different answers to "what am I about to hear".
 */
export function GrooveboxArrangement({
  song,
  pattern,
  section,
  arrangement,
  setArrangementSection,
  setClip,
  setSwing,
  automationRecording,
  running,
  toggleAutomationRecording,
  clearAutomation,
  launch,
  live,
  launchQuantization,
  setLaunchQuantization,
  launchRecording,
  toggleLaunchRecording,
  transport,
  loop,
  loopStart,
  setLoopStart,
  loopBars,
  setLoopBars,
}: Props) {
  const { chain, shownSection, chainStep, sectionStart, totalBars } = arrangement
  const automation = automationSummary(song)
  const clipPattern = chainStep.clips?.[section] ?? chainStep.pattern
  const looping = sectionLooping(loop, sectionStart, chainStep.repeat)

  return (
    <>
      <div className="rk-groovebox-automation" aria-label="Groovebox automation recorder">
        <button
          type="button"
          aria-pressed={automationRecording}
          aria-label={
            automationRecording
              ? 'Disarm Groovebox automation recording'
              : 'Arm Groovebox automation recording'
          }
          title={automationArmTitle(automationRecording, running)}
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
          {automationStatus(automationRecording, running, automation.lanes, automation.points)}
        </span>
        <button
          type="button"
          disabled={automation.lanes === 0}
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
        <label>
          Quantize
          <select
            aria-label="Clip launch quantization"
            value={launchQuantization}
            disabled={launchRecording}
            onChange={(event) =>
              setLaunchQuantization?.(event.target.value as ClipLaunchQuantization)
            }
          >
            {CLIP_LAUNCH_QUANTIZATIONS.map((quantization) => (
              <option value={quantization} key={quantization}>
                {quantization}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rk-groovebox-live-record"
          disabled={!toggleLaunchRecording}
          aria-pressed={launchRecording}
          aria-label={
            launchRecording ? 'Disarm clip launch recording' : 'Arm clip launch recording'
          }
          title={
            launchRecording
              ? 'Writing active launches into the retained arrangement at bar boundaries'
              : 'Record live clip choices into the retained arrangement at bar boundaries'
          }
          onClick={toggleLaunchRecording}
        >
          <span aria-hidden="true">●</span> write
        </button>
        <button
          type="button"
          disabled={!launch}
          onClick={() => launch?.(section, pattern.id, launchQuantization)}
          title={`Queue for the next ${launchQuantization}`}
        >
          Launch {pattern.name}
        </button>
        <button
          type="button"
          disabled={!launch}
          onClick={() => launch?.(section, null, launchQuantization)}
          title={`Follow the song from the next ${launchQuantization}`}
        >
          Follow song
        </button>
        <span aria-live="polite">{liveStatus(song, live, launchRecording)}</span>
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
          aria-pressed={looping}
          onClick={() =>
            looping ? transport?.clearLoop() : transport?.setLoop(sectionStart, chainStep.repeat)
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
    </>
  )
}
