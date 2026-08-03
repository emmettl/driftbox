import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './HelpDialog.css'

type HelpSurface = 'groovebox' | 'rack'

interface HelpDialogProps {
  surface: HelpSurface
  onClose: () => void
  initialTopic?: string
}

interface HelpTopic {
  id: string
  label: string
}

const TOPICS: Record<HelpSurface, readonly HelpTopic[]> = {
  groovebox: [
    { id: 'start', label: 'Start here' },
    { id: 'patterns', label: 'Patterns' },
    { id: 'song', label: 'Song & automation' },
    { id: 'sound', label: 'Sound, MIDI & files' },
    { id: 'keys', label: 'Shortcuts' },
  ],
  rack: [
    { id: 'start', label: 'Start here' },
    { id: 'patching', label: 'Patching & devices' },
    { id: 'modules', label: 'Module map' },
    { id: 'performance', label: 'Play & automate' },
    { id: 'files', label: 'Files & shortcuts' },
  ],
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Shortcut({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <li>
      <kbd>{keys}</kbd>
      <span>{children}</span>
    </li>
  )
}

function GrooveboxHelp({ topic }: { topic: string }) {
  if (topic === 'patterns') {
    return (
      <>
        <HelpSection title="Patterns and machines">
          <dl className="help-definitions">
            <div><dt>808 / 909</dt><dd>Each horizontal lane is one drum voice. The highlighted name is the voice whose sound and lane tools you are editing.</dd></div>
            <div><dt>303</dt><dd>Two independent bass synths, A and B. Each step stores a note plus separate accent and slide flags.</dd></div>
            <div><dt>Pattern bank</dt><dd>The named buttons select what you edit. Double-click a name to rename; + makes a blank pattern, ⧉ duplicates, and × deletes.</dd></div>
            <div><dt>Steps</dt><dd>Sets the pattern’s main cycle from 1–64 steps. A pattern need not be sixteen steps long.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Drum programming">
          <dl className="help-definitions">
            <div><dt>Step states</dt><dd>Click repeatedly for off → normal → accent. Drag from an empty step to paint; drag from a filled step to erase.</dd></div>
            <div><dt>Lane length</dt><dd>Gives the selected drum its own shorter loop inside the pattern—for example, 15 hats against 16 kicks.</dd></div>
            <div><dt>Flam</dt><dd>On the 909, flam programs a second closely spaced strike. The slider controls the space between strikes.</dd></div>
            <div><dt>PCF row</dt><dd>Pattern-controlled master filter steps. Off bypasses it; on and accent apply two strengths of the filter envelope.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Focused pattern tools">
          <dl className="help-definitions">
            <div><dt>Lane / all</dt><dd>Chooses whether rotate, cut, and copy affect only the selected lane or the whole machine on screen.</dd></div>
            <div><dt>← / →</dt><dd>Rotates the target one step while keeping every hit or note.</dd></div>
            <div><dt>Random</dt><dd>Replaces the selected lane with a fresh rhythm. Alter rearranges its existing material without changing how much is there.</dd></div>
            <div><dt>Clipboard</dt><dd>A copied lane can move between compatible voices; a whole-machine copy pastes only into the same drum machine.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="303 editing">
          <dl className="help-definitions">
            <div><dt>Note cell</dt><dd>Click to add or remove a note. Drag vertically to change pitch; arrow keys work when the cell is focused.</dd></div>
            <div><dt>Accent</dt><dd>Makes that step louder and brighter. Slide ties pitch into the following note without retriggering the envelope.</dd></div>
            <div><dt>− / +</dt><dd>Transposes the selected A or B line by a semitone without changing its rhythm.</dd></div>
            <div><dt>Step entry</dt><dd>In Keys, arm step entry while stopped. Played notes advance; rest writes silence and tie extends the previous note.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'song') {
    return (
      <>
        <HelpSection title="What a song section contains">
          <p className="help-copy">Each card in the Song strip is a section with a duration and four clip choices: 808, 909, 303 A, and 303 B. Changing the picker edits only the machine currently on screen; the other clips in that section stay intact.</p>
          <p className="help-note">A pattern is reusable musical material. A section decides which material each machine plays, for how many bars, and in what order.</p>
        </HelpSection>

        <HelpSection title="Section controls">
          <dl className="help-definitions">
            <div><dt>‹ / ›</dt><dd>Moves the whole section earlier or later in the song.</dd></div>
            <div><dt>− / +</dt><dd>Changes how many bars the section repeats. × removes it.</dd></div>
            <div><dt>Edit</dt><dd>Opens that section’s clip for the machine on screen. ▶ starts playback at the section.</dd></div>
            <div><dt>Loop</dt><dd>Loops that complete section. “Loop from / for” can instead define any bar range.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Automation">
          <ol className="help-steps">
            <li><strong>Arm auto</strong> in the transport.</li>
            <li><strong>Start playback,</strong> then move a supported knob or control.</li>
            <li><strong>Play it back.</strong> Automation follows the song playhead, not merely the pattern loop.</li>
          </ol>
          <p className="help-note">The number on auto is the recorded lane count. Clear auto removes every automation lane and cannot be undone in the Groovebox.</p>
        </HelpSection>

        <HelpSection title="Transport and songs">
          <dl className="help-definitions">
            <div><dt>BPM / Swing</dt><dd>Tempo is global. Swing delays alternating sixteenth notes; voice-level Swing controls decide how much each drum follows it.</dd></div>
            <div><dt>Click / 1·2·3·4</dt><dd>Metronome and a one-bar count-in. Count-in applies when starting playback.</dd></div>
            <div><dt>Song menu</dt><dd>Loads a shipped song and replaces the open document after confirmation.</dd></div>
            <div><dt>Empty strip</dt><dd>With no sections, the first pattern loops. Press + at the strip’s end to begin an arrangement.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'sound') {
    return (
      <>
        <HelpSection title="Voice and synth controls">
          <dl className="help-definitions">
            <div><dt>Selected row</dt><dd>Click a drum name to select and audition it; the side panel then controls that voice. The 303 panel follows A or B.</dd></div>
            <div><dt>Knobs</dt><dd>Drag vertically; hold Shift for fine movement. Arrow keys adjust a focused knob. Double-click returns it to the midpoint.</dd></div>
            <div><dt>Pan / level</dt><dd>Place and balance a voice before it reaches the master effects.</dd></div>
            <div><dt>Delay / reverb</dt><dd>Per-voice sends: each chooses how much of that voice is fed into the shared delay or reverb.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Master FX">
          <dl className="help-definitions">
            <div><dt>Drive / Comp</dt><dd>Drive adds master saturation; Comp reduces peaks and glues the complete mix.</dd></div>
            <div><dt>PCF controls</dt><dd>Set the pattern-controlled filter’s cutoff, resonance, envelope amount, and decay. The PCF step row decides when it fires.</dd></div>
            <div><dt>Delay</dt><dd>Time, feedback, and tone shape the one shared echo receiving all delay sends.</dd></div>
            <div><dt>Reverb</dt><dd>Size and damping shape the one shared space receiving all reverb sends.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Keys and MIDI">
          <dl className="help-definitions">
            <div><dt>A / B</dt><dd>Select which 303 the keyboard plays. Selecting a pitched tom also offers that drum as a target.</dd></div>
            <div><dt>Accent</dt><dd>Hold Shift or toggle accent before playing. Holding one 303 note while pressing another creates a slide.</dd></div>
            <div><dt>MIDI</dt><dd>Enables hardware MIDI. Choose a parameter under MIDI map, press learn, then move a hardware control to bind it.</dd></div>
            <div><dt>Vibes</dt><dd>Full-screen visual performance mode. Drag anywhere for filter cutoff and resonance; scene and scope controls remain available.</dd></div>
          </dl>
        </HelpSection>

        <HelpSection title="Library, sharing, and audio files">
          <dl className="help-definitions">
            <div><dt>Library</dt><dd>Names and stores local songs in this browser. Save/load beside it exports or imports a portable song file.</dd></div>
            <div><dt>Share</dt><dd>Copies a URL containing the complete song. Reset discards the open work and returns to shipped material.</dd></div>
            <div><dt>Mix / stems</dt><dd>Mix renders the mastered stereo song. Stems preview or export one pre-master WAV per voice for mixing elsewhere.</dd></div>
            <div><dt>Rack</dt><dd>Embeds the complete song in a modular rack. The original song remains available for a lossless return to the sequencer.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'keys') {
    return (
      <>
        <HelpSection title="Global shortcuts">
          <ul className="help-shortcuts">
            <Shortcut keys="Space">Play or stop</Shortcut>
            <Shortcut keys="V">Open or leave Vibes</Shortcut>
            <Shortcut keys="Esc">Leave Vibes</Shortcut>
            <Shortcut keys="C">Change the visual scene</Shortcut>
            <Shortcut keys="X">Change the scope</Shortcut>
            <Shortcut keys="?">Open this guide</Shortcut>
          </ul>
        </HelpSection>
        <HelpSection title="Playing keys">
          <ul className="help-shortcuts">
            <Shortcut keys="A S D F G H J K">White keys from A</Shortcut>
            <Shortcut keys="W R T U I">Black keys</Shortcut>
            <Shortcut keys="Z / X">Octave down / up</Shortcut>
            <Shortcut keys="Shift">Accent while held</Shortcut>
          </ul>
        </HelpSection>
        <HelpSection title="303 step entry">
          <ul className="help-shortcuts">
            <Shortcut keys="← / →">Move the entry cursor</Shortcut>
            <Shortcut keys="Backspace">Write a rest</Shortcut>
            <Shortcut keys="Enter">Tie the previous note</Shortcut>
          </ul>
          <p className="help-note">Step-entry shortcuts apply only while 303 step entry is armed and playback is stopped.</p>
        </HelpSection>
        <HelpSection title="Keyboard focus">
          <p className="help-copy">Shortcuts pause while you type into a text, number, or menu control. Focused knobs and steps retain their own arrow-key behavior.</p>
          <p className="help-note">On touch devices, use the same visible controls; no keyboard shortcut is required for any core action.</p>
        </HelpSection>
      </>
    )
  }

  return (
    <>
      <HelpSection title="The mental model">
        <p className="help-copy">The Groovebox is four instruments sharing one song: an 808, a 909, and two 303 bass synths. Patterns hold musical material; the Song strip combines machine-specific pattern clips into ordered sections.</p>
        <p className="help-note">The machine button changes what you are looking at, not what can play. All four instruments continue together.</p>
      </HelpSection>
      <HelpSection title="Make a beat">
        <ol className="help-steps">
          <li><strong>Press play.</strong> Pick 808, 909, or 303 in the top bar.</li>
          <li><strong>Choose a pattern,</strong> then click steps to add hits or notes.</li>
          <li><strong>Shape the sound.</strong> Select a row and use its panel and FX sends.</li>
          <li><strong>Build the song.</strong> Press + at the end of the Song strip.</li>
        </ol>
      </HelpSection>
      <HelpSection title="Read the screen">
        <dl className="help-definitions">
          <div><dt>Top bar</dt><dd>Transport, tempo, machine and pattern choice, transforms, song files, and Vibes.</dd></div>
          <div><dt>Song strip</dt><dd>Ordered sections, their clips, duration, playback start, and loops.</dd></div>
          <div><dt>Main grid</dt><dd>The selected pattern for the machine on screen. The moving ruler is the live step.</dd></div>
          <div><dt>Side / bottom</dt><dd>Selected instrument, master effects and scope, plus the playable Keys panel.</dd></div>
        </dl>
      </HelpSection>
      <HelpSection title="Gestures easy to miss">
        <dl className="help-definitions">
          <div><dt>Steps</dt><dd>Repeated clicks cycle intensity; drag across a drum row to paint or erase.</dd></div>
          <div><dt>303 pitch</dt><dd>Drag a note cell vertically. Accent and slide live on separate rows.</dd></div>
          <div><dt>Knobs</dt><dd>Drag vertically, Shift for fine movement, double-click for midpoint.</dd></div>
          <div><dt>Panels</dt><dd>▾ collapses a panel. On a phone, ··· reveals the less-frequent transport controls.</dd></div>
        </dl>
      </HelpSection>
    </>
  )
}

function RackHelp({ topic }: { topic: string }) {
  if (topic === 'patching') {
    return (
      <>
        <HelpSection title="Cable rules">
          <dl className="help-definitions">
            <div><dt>Output → input</dt><dd>Drag either direction between compatible jacks. One output may feed many places; an input accepts one cable.</dd></div>
            <div><dt>Unplug</dt><dd>Use × beside the occupied input, click a cable, or focus a patched jack and press Delete.</dd></div>
            <div><dt>Stereo → mono</dt><dd>Only the left channel reaches a mono input. The cable is marked so the fold is visible.</dd></div>
            <div><dt>Feedback</dt><dd>Cycles are allowed. A marked delayed cable shows where the engine inserted one audio block to make the loop runnable.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Rear-panel controls">
          <dl className="help-definitions">
            <div><dt>Input trim</dt><dd>The small control beside every input scales or inverts the arriving signal. Double-click restores unity (1×).</dd></div>
            <div><dt>Keyboard patching</dt><dd>Enter arms a focused jack; move to a compatible jack and press Enter again. Escape cancels.</dd></div>
            <div><dt>CV and audio</dt><dd>Both are signals carried by cables. A pitch, gate, envelope, or LFO becomes control only because of the inlet receiving it.</dd></div>
            <div><dt>Signal level</dt><dd>Use Meter and Scope to find silence or clipping; use a VCA, Mixer, trim, compressor, or limiter to manage gain.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Selecting and arranging devices">
          <dl className="help-definitions">
            <div><dt>Select</dt><dd>Click a module’s empty faceplate area. Cmd/Ctrl-click toggles one; Shift-click selects a range; drag empty rack space for a selection box.</dd></div>
            <div><dt>Move</dt><dd>Drag the module grip or use ↑ / ↓. A selected group moves, bypasses, or removes together where applicable.</dd></div>
            <div><dt>Bypass</dt><dd>Takes a processor out of circuit while passing its input onward. Duplicate copies settings but leaves the new device unpatched.</dd></div>
            <div><dt>Undo / redo</dt><dd>Restores graph edits, device moves, parameter changes, and destructive rack actions.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Device patches and parameters">
          <dl className="help-definitions">
            <div><dt>Device help</dt><dd>Press the small ? beside a device patch name for its signal flow and control reference. Complex devices also include their mental model, a starter patch, and common traps.</dd></div>
            <div><dt>Patch name</dt><dd>The small device-patch control recalls settings for that one module, not the complete rack.</dd></div>
            <div><dt>Save</dt><dd>Stores the current device settings in this browser for reuse on another instance.</dd></div>
            <div><dt>Knobs</dt><dd>Drag vertically, Shift for fine movement, arrow keys when focused, and double-click for midpoint.</dd></div>
            <div><dt>Driven mark</dt><dd>A parameter marked as routed is being moved by a Combinator. It remains editable, but the routing determines its live value.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'modules') {
    return (
      <>
        <HelpSection title="Sources">
          <dl className="help-definitions">
            <div><dt>Groovebox</dt><dd>Individual 808, 909, and 303 song sources retained from the sequencer.</dd></div>
            <div><dt>VCO / Voice / Noise</dt><dd>Oscillator building blocks, a complete playable synth voice, and noise.</dd></div>
            <div><dt>Sampler</dt><dd>One audio file chopped into slices. Multisampler maps several files across keyboard zones.</dd></div>
            <div><dt>Audio input</dt><dd>Live microphone or interface signal. Use headphones to avoid speaker feedback.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Shape and space">
          <dl className="help-definitions">
            <div><dt>Filters</dt><dd>Ladder and SVF remove frequencies; Alligator rhythmically gates bands; Vocoder imposes one signal’s spectrum on another.</dd></div>
            <div><dt>Level / colour</dt><dd>VCA, Drive, Distortion, Cabinet, EQ, Imager, Compressor, and Limiter shape gain, tone, width, and peaks.</dd></div>
            <div><dt>Time effects</dt><dd>Delay, Ping Pong, Phaser, Reverb, and Looper create repeats, movement, space, or captured phrases.</dd></div>
            <div><dt>Order matters</dt><dd>Filtering before distortion sounds different from filtering after it. Cables define the order; visual module order does not.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Control and modulation">
          <dl className="help-definitions">
            <div><dt>ADSR / LFO</dt><dd>Envelope and repeating movement. Feed them into control inlets, usually through a VCA or trim when depth matters.</dd></div>
            <div><dt>Follower / S&amp;H</dt><dd>Follower turns loudness into control; Sample &amp; Hold turns a changing source into stepped values.</dd></div>
            <div><dt>Offset / Quantizer</dt><dd>Shift or invert a signal, then constrain pitch control to notes in a scale.</dd></div>
            <div><dt>Combinator</dt><dd>Maps its four rotaries and buttons directly to other modules’ parameters. Open routing from its front panel.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Notes, time, and routing">
          <dl className="help-definitions">
            <div><dt>Transport / Clock</dt><dd>Transport knows tempo and bars; Clock turns that timing into pulse divisions for other modules.</dd></div>
            <div><dt>Seq / Tracker</dt><dd>Step-based pitch/gate sources. Arranger changes scenes over bars; Arp, Scale Player, and Note Echo transform notes.</dd></div>
            <div><dt>MIDI</dt><dd>Turns on-screen or hardware notes into pitch, gate, velocity, and voice allocation for polyphony.</dd></div>
            <div><dt>Mixer / Out</dt><dd>Mixer combines paths. Out is the final audible destination; Meter and Tuner diagnose without changing the signal.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'performance') {
    return (
      <>
        <HelpSection title="Playing the rack">
          <dl className="help-definitions">
            <div><dt>On-screen keys</dt><dd>Playing the first note adds a MIDI module when needed. The keyboard stays available even without Web MIDI.</dd></div>
            <div><dt>MIDI in</dt><dd>Enables connected hardware inputs after audio starts. The MIDI module decides pitch, gate, velocity, and voice allocation.</dd></div>
            <div><dt>Voices</dt><dd>Sets polyphony. Without a MIDI module, every voice receives the same note and stacks louder instead of forming a chord.</dd></div>
            <div><dt>Velocity / octave</dt><dd>The keyboard panel controls note strength and range. Comma and full stop shift its computer-key octave.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Rack automation">
          <ol className="help-steps">
            <li><strong>Start audio</strong> so the rack transport has a live timeline.</li>
            <li><strong>Press ● Rec</strong> beside the rack transport.</li>
            <li><strong>Play and move knobs.</strong> Supported parameter moves are recorded at the current rack step.</li>
          </ol>
          <p className="help-note">Rack undo can restore recorded or cleared automation. This is separate from automation retained inside an embedded Groovebox song.</p>
        </HelpSection>
        <HelpSection title="Performance views">
          <dl className="help-definitions">
            <div><dt>Rack</dt><dd>The complete instrument and its editing controls.</dd></div>
            <div><dt>Split</dt><dd>Keeps the rack live beside the filter pad, so knobs and pad can be moved together.</dd></div>
            <div><dt>Pad</dt><dd>Gives the performance surface the whole stage. Horizontal movement controls cutoff; vertical movement controls resonance.</dd></div>
            <div><dt>Front / back</dt><dd>Tab turns both rack and performance creature around. The filter remains live on either side.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Embedded Groovebox">
          <dl className="help-definitions">
            <div><dt>Unpatched source</dt><dd>The retained machine continues through its original mastered song mix.</dd></div>
            <div><dt>Patched source</dt><dd>Connecting a Groovebox output diverts that complete machine through the rack instead.</dd></div>
            <div><dt>Clip controls</dt><dd>The Groovebox faceplate can edit patterns, choose section clips, launch clips quantized to musical boundaries, and set song loops.</dd></div>
            <div><dt>Sequencer →</dt><dd>Returns to the retained song. Rack modules and cables remain saved here when the rack has been extended.</dd></div>
          </dl>
        </HelpSection>
      </>
    )
  }

  if (topic === 'files') {
    return (
      <>
        <HelpSection title="Patch browser">
          <dl className="help-definitions">
            <div><dt>Showcase</dt><dd>Complete factory systems, already wired to demonstrate a musical technique.</dd></div>
            <div><dt>My library</dt><dd>Named racks and Groovebox songs stored locally in this browser.</dd></div>
            <div><dt>Breaks</dt><dd>Shipped breakbeats that can fill compatible samplers without choosing a file.</dd></div>
            <div><dt>Import / export</dt><dd>Portable rack files plus VCV Rack import. Unsupported VCV devices are preserved as silent placeholders.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Share and render">
          <dl className="help-definitions">
            <div><dt>Copy link</dt><dd>Embeds the patch in a URL. User-loaded audio files are not carried, so linked samplers arrive empty.</dd></div>
            <div><dt>Patch WAV</dt><dd>Renders the rack graph. It does not require real-time playback.</dd></div>
            <div><dt>Song WAV</dt><dd>Renders an embedded Groovebox song through its mastered stereo bus.</dd></div>
            <div><dt>Song stems</dt><dd>Previews or exports the embedded song as one pre-master WAV per voice.</dd></div>
          </dl>
        </HelpSection>
        <HelpSection title="Keyboard shortcuts">
          <ul className="help-shortcuts">
            <Shortcut keys="Tab">Turn the rack around</Shortcut>
            <Shortcut keys="⌘/Ctrl Z">Undo</Shortcut>
            <Shortcut keys="⇧ ⌘/Ctrl Z">Redo</Shortcut>
            <Shortcut keys="Z–M / Q–U">Play two keyboard rows</Shortcut>
            <Shortcut keys=", / .">Keyboard octave down / up</Shortcut>
            <Shortcut keys="?">Open this guide</Shortcut>
          </ul>
        </HelpSection>
        <HelpSection title="Patch keyboard controls">
          <ul className="help-shortcuts">
            <Shortcut keys="Enter">Arm or complete a cable on a focused jack</Shortcut>
            <Shortcut keys="Esc">Cancel an armed cable</Shortcut>
            <Shortcut keys="Delete">Unplug a focused patched jack</Shortcut>
            <Shortcut keys="Arrows">Adjust a focused knob or rear input trim</Shortcut>
            <Shortcut keys="Shift + arrows">Fine parameter adjustment</Shortcut>
          </ul>
        </HelpSection>
      </>
    )
  }

  return (
    <>
      <HelpSection title="The mental model">
        <p className="help-copy">The rack is a signal graph. Sources make audio or control; processors change it; sequencers and MIDI decide notes and time; Mixer and Out deliver the result. The cables—not the visual order—define what runs into what.</p>
        <p className="help-note">If a patch is silent, trace one path from a source through its processors to Out, then check gates, gain, and meters.</p>
      </HelpSection>
      <HelpSection title="Patch something">
        <ol className="help-steps">
          <li><strong>Start audio.</strong> Open Patches for a complete system, or Add module for a pre-wired chunk.</li>
          <li><strong>Turn the rack around.</strong> Outputs and inputs live on the back.</li>
          <li><strong>Drag output to input.</strong> A basic path is source → filter or effect → Out.</li>
          <li><strong>Play it.</strong> Use the bottom keyboard, a sequencer module, or MIDI hardware.</li>
        </ol>
      </HelpSection>
      <HelpSection title="Front, back, and header">
        <dl className="help-definitions">
          <div><dt>Front</dt><dd>Sound controls, pattern editors, meters, device patches, and module selection tools.</dd></div>
          <div><dt>Back</dt><dd>Signal inputs, outputs, cables, and an input trim beside each inlet.</dd></div>
          <div><dt>Add module</dt><dd>Searchable devices grouped by purpose; chunks add several devices already wired on their own channel.</dd></div>
          <div><dt>Patches</dt><dd>Complete systems, your local library, shipped breaks, and portable file import/export.</dd></div>
        </dl>
      </HelpSection>
      <HelpSection title="First useful choices">
        <dl className="help-definitions">
          <div><dt>Want a synth?</dt><dd>Add Voice for a complete instrument, or MIDI + VCO + VCA + ADSR to build one from parts.</dd></div>
          <div><dt>Want drums?</dt><dd>Use a Groovebox source, load a Sampler, or start with a break-based chunk.</dd></div>
          <div><dt>Want movement?</dt><dd>Patch an LFO or envelope into a control inlet, or use a Combinator to map several front-panel parameters.</dd></div>
          <div><dt>Want a full track?</dt><dd>Open a Showcase patch; its meters and labelled modules demonstrate the intended flow.</dd></div>
        </dl>
      </HelpSection>
    </>
  )
}

/** A shared, focus-safe guide for both app entry points. */
export function HelpDialog({ surface, onClose, initialTopic = 'start' }: HelpDialogProps) {
  const titleId = useId()
  const panelId = useId()
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const closeDialog = useRef(onClose)
  closeDialog.current = onClose
  const [topic, setTopic] = useState(initialTopic)
  const currentSurface = useRef(surface)
  const currentTopic = useRef(topic)
  currentSurface.current = surface
  currentTopic.current = topic

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()

    // Capture before the instrument's global shortcuts: keys pressed in the guide must not play a note,
    // turn the rack around, or start the transport behind it.
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog.current()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        const controls = [
          ...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ].filter((control) => control.tabIndex >= 0)
        const current = controls.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.shiftKey
          ? current <= 0 ? controls.length - 1 : current - 1
          : current < 0 || current === controls.length - 1 ? 0 : current + 1
        controls[next]?.focus()
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        (event.target as HTMLElement | null)?.getAttribute('role') === 'tab'
      ) {
        event.preventDefault()
        const tabs = TOPICS[currentSurface.current]
        const current = tabs.findIndex((entry) => entry.id === currentTopic.current)
        const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        setTopic(tabs[next].id)
        dialog.current?.querySelector<HTMLButtonElement>(`[data-help-topic="${tabs[next].id}"]`)?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const name = surface === 'rack' ? 'Rack guide' : 'Groovebox guide'

  return (
    <div
      className="help-layer"
      data-help-dialog=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <article ref={dialog} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="help-head">
          <div>
            <span>Driftbox / Help</span>
            <h2 id={titleId}>{name}</h2>
          </div>
          <button ref={close} type="button" className="help-close" onClick={onClose} aria-label="Close help">
            ×
          </button>
        </header>
        <nav className="help-topics" role="tablist" aria-label={`${name} topics`}>
          {TOPICS[surface].map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              data-help-topic={entry.id}
              aria-selected={topic === entry.id}
              aria-controls={panelId}
              tabIndex={topic === entry.id ? 0 : -1}
              onClick={() => setTopic(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="help-body" id={panelId} role="tabpanel">
          {surface === 'rack' ? <RackHelp topic={topic} /> : <GrooveboxHelp topic={topic} />}
        </div>
        <footer className="help-foot">
          <span>Press <kbd>Esc</kbd> to close</span>
          <span>Open this guide any time with <kbd>?</kbd></span>
        </footer>
      </article>
    </div>
  )
}
