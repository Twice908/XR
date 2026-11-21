import type { SoundAct, SoundReveal, SoundTool } from '@mmaxr/schema'
import type { Confidence, ExplainMeta, SoundExperiment, Summary, Trial } from '../state/sound'
import { h } from '../ui/dom'
import { badge, button, dialog, setDisabled } from '../ui/components'
import { sound } from './sound'
import { VoiceCapture, voiceSupport, type VoiceResult } from './voice'

export type Place = 'field' | 'room'
export type SonarMode = 'ship' | 'scanner'

export interface SoundHudHandlers {
  onBack(): void
  onTab(tab: SoundTool): void
  onSelect(id: string): void
  onLock(id: string, option: string, confidence: Confidence, decisionMs: number): void
  onRun(): void
  onCalc(id: string, value: number): Promise<void> | void
  onNoticeAnomaly(id: string): void
  onExplain(id: string, text: string, meta: ExplainMeta, audio: Blob | null): Promise<void> | void
  onNext(): void
  onSubmit(): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
  /* instruments */
  onFreq(v: number): void
  onAmp(v: number): void
  onToggleRun(running: boolean): void
  onPlace(place: Place): void
  onClap(): void
  onShout(): void
  onStopwatchStop(seconds: number): void
  onPulse(): void
  onSonarMode(mode: SonarMode): void
  onScan(kind: 'audible' | 'ultra'): void
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]
const TAB_ICON: Record<SoundTool, string> = { wave: '〰', echo: '🗣', sonar: '📡' }

export class SoundHud {
  readonly root: HTMLElement
  private tabButtons = new Map<SoundTool, HTMLButtonElement>()
  private listBody = h('div', { class: 'stack' })
  private controlsBody = h('div', { class: 'stack' })
  private cardBody = h('div', { class: 'stack' })
  private hintText = h('span', { class: 'hint-text' })
  private hintAction: HTMLButtonElement
  private listPanel: HTMLElement
  private cardPanel: HTMLElement
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private soundToggle: HTMLButtonElement
  private hintRun: (() => void) | null = null
  private selected: string | null = null
  private pickedOption: string | null = null
  private conf: Confidence | 0 = 0
  private draftFor: string | null = null
  private openedAt = 0

  /* instrument state */
  private act: SoundAct = { freq: 3, amp: 3 }
  private place: Place = 'field'
  private sonarMode: SonarMode = 'ship'
  private stopwatchMs = 0
  private stopwatchRunning = false
  private stopwatchStart = 0
  private stopwatchTimer: number | null = null
  private timerReading: number | null = null
  private scanLabel = ''
  private freqSlider!: HTMLInputElement
  private ampSlider!: HTMLInputElement
  private runBtn!: HTMLButtonElement
  private swLabel!: HTMLElement
  private freqRead!: HTMLElement
  private ampRead!: HTMLElement
  readonly scanCanvas = h('canvas', { class: 'scan-canvas', width: 300, height: 300, 'aria-label': 'Ultrasound scan' }) as HTMLCanvasElement
  private scanNote = h('p', { class: 't-support' })

  /* explain-back */
  private voice = new VoiceCapture()
  private drafts = new Map<string, string>()
  private recorded = new Map<string, VoiceResult>()
  private pasted = new Map<string, number>()
  private blurs = new Map<string, number>()
  private micFailed = false
  private micNote: HTMLElement | null = null
  private micButton: HTMLButtonElement | null = null
  private textArea: HTMLTextAreaElement | null = null
  private wordLabel: HTMLElement | null = null
  private sendBtn: HTMLButtonElement | null = null
  private sending = false
  private calcInput: HTMLInputElement | null = null
  private calcNote = new Map<string, string>()

  constructor(
    private readonly exp: SoundExperiment,
    private readonly handlers: SoundHudHandlers,
    title: string,
  ) {
    this.hintAction = button('Go', { variant: 'primary', onClick: () => this.hintRun?.() })
    this.hintAction.hidden = true
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })

    this.listPanel = h(
      'aside',
      { class: 'panel panel-left', 'aria-label': 'Tasks and instruments' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Bench'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close', onclick: () => this.setPanel(this.listPanel, false) }, '×')),
      this.listBody,
      this.controlsBody,
    )
    this.cardPanel = h(
      'aside',
      { class: 'panel panel-tray optics-card', 'aria-label': 'Prediction and result' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Predict, run, explain'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close', onclick: () => this.setPanel(this.cardPanel, false) }, '×')),
      this.cardBody,
    )
    const tabs = h('div', { class: 'sound-tabs', role: 'tablist', 'aria-label': 'Benches' })
    for (const sc of exp.lesson.scenarios) {
      const b = button(`${TAB_ICON[sc.tool]} ${sc.tabName}`, { size: 'sm', variant: 'ghost', onClick: () => handlers.onTab(sc.tool) })
      b.setAttribute('role', 'tab')
      this.tabButtons.set(sc.tool, b)
      tabs.append(b)
    }
    this.toggles.append(h('span', { class: 'only-mobile' }, button('Bench', { size: 'sm', onClick: () => this.setPanel(this.listPanel, !this.listPanel.classList.contains('open')) })), this.soundToggle)

    this.root = h(
      'div',
      { class: 'hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)), tabs, this.toggles),
      this.listPanel,
      this.cardPanel,
      h('div', { class: 'hint-bar', role: 'status', 'aria-live': 'polite' }, this.hintText, this.hintAction),
    )
    window.addEventListener('resize', this.layout)
    window.addEventListener('blur', this.onBlur)
    this.buildControls()
    this.update()
  }

  /* ---------------- panels ---------------- */
  private isNarrow = () => window.innerWidth <= 1000
  private toggleSound() {
    sound.setMuted(!sound.muted)
    this.soundToggle.textContent = sound.muted ? 'Sound off' : 'Sound on'
    if (!sound.muted) sound.click()
  }
  private onBlur = () => {
    const id = this.selected
    if (!id) return
    if (this.exp.trial(id).explained || this.exp.phase === 'reveal') return
    this.blurs.set(id, (this.blurs.get(id) ?? 0) + 1)
  }

  attachPanel(panel: HTMLElement, toggle: HTMLElement, onOpenChange: (open: boolean) => void, overlay?: HTMLElement) {
    this.extraPanels.push(panel)
    this.panelListeners.set(panel, onOpenChange)
    this.toggles.insertBefore(toggle, this.soundToggle)
    this.root.insertBefore(panel, this.root.querySelector('.hint-bar'))
    if (overlay) this.root.appendChild(overlay)
  }
  setPanelOpen(panel: HTMLElement, open: boolean) {
    this.setPanel(panel, open)
  }
  private setPanel(panel: HTMLElement, open: boolean) {
    if (open && this.isNarrow()) {
      for (const p of [this.listPanel, this.cardPanel, ...this.extraPanels]) {
        if (p !== panel && p.classList.contains('open')) {
          p.classList.remove('open')
          this.panelListeners.get(p)?.(false)
        }
      }
    }
    panel.classList.toggle('open', open)
    this.panelListeners.get(panel)?.(open)
    this.root.classList.toggle('tray-open', this.cardPanel.classList.contains('open'))
    this.layout()
  }
  layout = () => {
    const narrow = this.isNarrow()
    const hint = this.hintText.parentElement!.getBoundingClientRect()
    let left = 0
    let bottom = 0
    if (narrow) {
      const open = [this.listPanel, this.cardPanel, ...this.extraPanels].find((p) => p.classList.contains('open'))
      bottom = open ? open.getBoundingClientRect().height + 8 : hint.height + 24
    } else {
      left = this.listPanel.getBoundingClientRect().right + 8
      bottom = this.cardPanel.classList.contains('open') ? this.cardPanel.getBoundingClientRect().height + 24 : hint.height + 28
    }
    this.handlers.onLayout({ left, right: 0, top: narrow ? 52 : 56, bottom })
  }
  hint(text: string, action?: { label: string; run: () => void } | null) {
    this.hintText.textContent = text
    this.hintAction.hidden = !action
    this.hintRun = action?.run ?? null
    if (action) this.hintAction.textContent = action.label
    requestAnimationFrame(this.layout)
  }

  /* ---------------- selection ---------------- */
  show(id: string | null) {
    this.selected = id
    if (id !== this.draftFor) {
      this.pickedOption = null
      this.conf = 0
      this.draftFor = id
      this.openedAt = performance.now()
      const t = id ? this.exp.trial(id) : null
      if (t?.prediction) this.pickedOption = t.prediction
      if (t?.confidence) this.conf = t.confidence
    }
    this.update()
    if (id) this.setPanel(this.cardPanel, true)
  }
  closeCard() {
    this.setPanel(this.cardPanel, false)
  }

  /** What the student has done to the instruments so far, for the checklist. */
  setAct(act: SoundAct) {
    this.act = act
    this.renderCard()
  }
  setStopwatchResult(seconds: number) {
    this.stopwatchMs = seconds * 1000
    this.paintStopwatch()
  }
  startStopwatch() {
    this.stopwatchMs = 0
    this.stopwatchRunning = true
    this.stopwatchStart = performance.now()
    if (this.stopwatchTimer !== null) window.clearInterval(this.stopwatchTimer)
    this.stopwatchTimer = window.setInterval(() => {
      this.stopwatchMs = performance.now() - this.stopwatchStart
      this.paintStopwatch()
    }, 40)
    this.paintStopwatch()
  }
  stopStopwatch(): number {
    if (!this.stopwatchRunning) return this.stopwatchMs / 1000
    this.stopwatchRunning = false
    if (this.stopwatchTimer !== null) window.clearInterval(this.stopwatchTimer)
    this.stopwatchTimer = null
    this.stopwatchMs = performance.now() - this.stopwatchStart
    this.paintStopwatch()
    return this.stopwatchMs / 1000
  }
  get stopwatchIsRunning() {
    return this.stopwatchRunning
  }
  setTimerReading(seconds: number | null) {
    this.timerReading = seconds
    this.buildControls()
  }
  setScanNote(text: string) {
    this.scanLabel = text
    this.scanNote.textContent = text
  }
  setPlaceState(place: Place) {
    this.place = place
    this.buildControls()
  }

  /* ---------------- refresh ---------------- */
  update() {
    for (const [tab, b] of this.tabButtons) {
      b.classList.toggle('tab-on', this.exp.tab === tab)
      b.setAttribute('aria-selected', String(this.exp.tab === tab))
      const n = this.exp.of(tab)
      b.title = `${n.filter((t) => this.exp.isComplete(t)).length} of ${n.length} tasks finished`
    }
    this.renderList()
    this.renderCard()
    this.buildControls()
    requestAnimationFrame(this.layout)
  }

  private renderList() {
    const e = this.exp
    const sc = e.lesson.scenarios.find((s) => s.tool === e.tab)!
    const items = e.of(e.tab)
    const done = items.filter((t) => e.isComplete(t)).length
    this.listBody.replaceChildren(h('h3', { class: 't-label' }, sc.tabName), h('p', { class: 't-support' }, sc.setup))
    this.listBody.append(h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Tasks'), badge(`${done} / ${items.length}`, done === items.length ? 'success' : 'neutral')))
    const list = h('div', { class: 'tool-list' })
    for (const t of items) {
      const sel = this.selected === t.id
      const owed = !!t.result && !e.isComplete(t)
      const mark = e.isComplete(t) ? (t.result!.match ? '✓' : '✗') : t.prediction ? '●' : String(t.sample)
      const sub = owed ? (t.result!.hasCalc && !t.calc.ok ? 'Calculate, then explain' : 'Explain what you saw') : e.isComplete(t) ? (t.result!.match ? 'Matched your prediction' : 'Not what you predicted') : t.prediction ? 'Prediction locked' : 'Not tried yet'
      const gate = e.canPredict(t.id)
      list.append(
        h(
          'button',
          { class: `tool${sel ? ' selected' : ''}${t.result && !t.result.match ? ' tool-miss' : ''}`, type: 'button', 'aria-pressed': String(sel), 'aria-disabled': !gate.ok && !t.result ? 'true' : null, onclick: () => this.handlers.onSelect(t.id) },
          h('span', { class: 'tool-check' }, mark),
          h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, this.shortName(t)), h('span', { class: 't-support' }, sub)),
        ),
      )
    }
    this.listBody.append(list)
    if (e.canSubmit) this.listBody.append(button('Finish & see the summary', { variant: 'primary', block: true, onClick: () => this.handlers.onSubmit() }))
    else this.listBody.append(h('p', { class: 't-support' }, 'This is a sandbox: play with the instruments any time. Every task needs a prediction first, then a run, then your own explanation.'))
  }

  private shortName(t: Trial): string {
    return { wave_1: 'Frequency and wavelength', wave_2: 'Amplitude and loudness', echo_1: 'Field and room', echo_2: 'Echo from a cliff', sonar_1: 'Sonar depth', ultrasound_1: 'Ultrasound imaging' }[t.id] ?? t.id
  }

  /* ---------------- instruments (built once per change, so sliders keep their place) ---------------- */
  private buildControls() {
    const tab = this.exp.tab
    const body: Node[] = [h('h3', { class: 't-label', style: 'margin-top:4px' }, 'Instruments')]
    if (tab === 'wave') {
      this.freqRead = h('span', { class: 't-label t-mono' })
      this.ampRead = h('span', { class: 't-label t-mono' })
      this.freqSlider = h('input', { type: 'range', min: '1', max: '15', step: '0.5', value: String(this.act.freq ?? 3), 'aria-label': 'Frequency in hertz', oninput: () => this.onFreqInput() }) as HTMLInputElement
      this.ampSlider = h('input', { type: 'range', min: '1', max: '10', step: '0.5', value: String(this.act.amp ?? 3), 'aria-label': 'Amplitude in millimetres', oninput: () => this.onAmpInput() }) as HTMLInputElement
      this.runBtn = button('Pause generator', { size: 'sm', variant: 'secondary', onClick: () => this.toggleRun() })
      body.push(
        h('label', { class: 'ctl' }, h('span', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Frequency'), this.freqRead), this.freqSlider),
        h('label', { class: 'ctl' }, h('span', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Amplitude'), this.ampRead), this.ampSlider),
        this.runBtn,
        h('p', { class: 't-support' }, 'The amber trace is the generator, the blue one is a probe in the water. Look at the tank, and at its ruler.'),
      )
      this.paintWave()
    } else if (tab === 'echo') {
      this.swLabel = h('span', { class: 'sw-read t-mono' })
      body.push(
        h('div', { class: 'row', style: 'gap:6px' }, ...(['field', 'room'] as Place[]).map((p) => button(p === 'field' ? 'Open field' : 'Small room', { size: 'sm', variant: this.place === p ? 'primary' : 'ghost', onClick: () => this.handlers.onPlace(p) }))),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, button('👏 Clap', { size: 'sm', onClick: () => this.handlers.onClap() }), this.place === 'field' ? button('📣 Shout at the cliff', { size: 'sm', onClick: () => this.handlers.onShout() }) : null),
        h('div', { class: 'stopwatch' }, h('span', { class: 't-label' }, 'Stopwatch'), this.swLabel, button('■ Stop', { size: 'sm', variant: 'secondary', onClick: () => this.handlers.onStopwatchStop(this.stopStopwatch()) })),
        h('p', { class: 't-support' }, 'Shouting starts the stopwatch. Stop it the moment you hear the echo.'),
      )
      this.paintStopwatch()
    } else {
      body.push(
        h('div', { class: 'row', style: 'gap:6px' }, ...(['ship', 'scanner'] as SonarMode[]).map((m) => button(m === 'ship' ? 'Ship sonar' : 'Ultrasound scanner', { size: 'sm', variant: this.sonarMode === m ? 'primary' : 'ghost', onClick: () => this.setSonarMode(m) }))),
      )
      if (this.sonarMode === 'ship') {
        body.push(
          button('📡 Send sonar pulse', { size: 'sm', onClick: () => this.handlers.onPulse() }),
          h('div', { class: 'stopwatch' }, h('span', { class: 't-label' }, 'Echo timer'), h('span', { class: 'sw-read t-mono' }, this.timerReading === null ? '–.–– s' : `${this.timerReading.toFixed(2)} s`)),
        )
      } else {
        body.push(
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, button('Scan: audible sound', { size: 'sm', onClick: () => this.handlers.onScan('audible') }), button('Scan: ultrasound', { size: 'sm', onClick: () => this.handlers.onScan('ultra') })),
          this.scanCanvas,
          this.scanNote,
        )
      }
    }
    this.controlsBody.replaceChildren(...body)
    this.scanNote.textContent = this.scanLabel
  }

  /** Switch the sonar tab between the ship and the scanner without telling the page. */
  showSonarMode(m: SonarMode) {
    this.sonarMode = m
    this.buildControls()
  }

  private setSonarMode(m: SonarMode) {
    this.sonarMode = m
    this.handlers.onSonarMode(m)
    this.buildControls()
  }
  private onFreqInput() {
    const v = Number(this.freqSlider.value)
    this.act = { ...this.act, freq: v }
    this.paintWave()
    this.handlers.onFreq(v)
    this.renderCard()
  }
  private onAmpInput() {
    const v = Number(this.ampSlider.value)
    this.act = { ...this.act, amp: v }
    this.paintWave()
    this.handlers.onAmp(v)
    this.renderCard()
  }
  private paintWave() {
    if (this.freqRead) this.freqRead.textContent = `${this.act.freq} Hz · T = ${Math.round(1000 / (this.act.freq || 1))} ms`
    if (this.ampRead) this.ampRead.textContent = `${this.act.amp} mm`
  }
  private runningNow = true
  private toggleRun() {
    this.runningNow = !this.runningNow
    this.runBtn.textContent = this.runningNow ? 'Pause generator' : 'Run generator'
    this.handlers.onToggleRun(this.runningNow)
  }
  private paintStopwatch() {
    if (this.swLabel) this.swLabel.textContent = `${(this.stopwatchMs / 1000).toFixed(2)} s`
  }

  /* ---------------- the card ---------------- */
  private confidenceRow(refresh: () => void, locked: boolean) {
    const row = h('div', { class: 'conf-row', role: 'radiogroup', 'aria-label': 'How sure are you?' })
    const paint = () =>
      row.replaceChildren(
        ...CONFIDENCE.map((c) =>
          h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(this.conf === c.value), 'aria-disabled': locked ? 'true' : null, onclick: () => { if (locked) return; this.conf = c.value; paint(); refresh() } }, h('span', { class: 't-label' }, c.label), h('span', { class: 't-support' }, c.hint)),
        ),
      )
    paint()
    return row
  }

  private checklist(t: Trial): { label: string; ok: boolean }[] {
    const a = this.act
    const p = t.task.params
    switch (t.id) {
      case 'wave_1':
        return [{ label: `Set the frequency to ${p.f2} Hz`, ok: Math.abs((a.freq ?? 0) - Number(p.f2)) <= 0.6 }]
      case 'wave_2':
        return [{ label: `Set the amplitude to ${p.a2} mm`, ok: Math.abs((a.amp ?? 0) - Number(p.a2)) <= 0.35 }]
      case 'echo_1':
        return [{ label: 'Clap in the open field', ok: !!a.clappedField }, { label: 'Clap in the small room', ok: !!a.clappedRoom }]
      case 'echo_2':
        return [{ label: 'Shout at the cliff and stop the stopwatch at the echo', ok: typeof a.measuredT === 'number' }]
      case 'sonar_1':
        return [{ label: 'Send a sonar pulse and read the timer', ok: !!a.pulse }]
      default:
        return [{ label: 'Scan with audible sound', ok: !!a.scannedAudible }, { label: 'Scan with ultrasound', ok: !!a.scannedUltra }]
    }
  }

  private renderCard() {
    const id = this.selected
    if (!id) {
      this.cardBody.replaceChildren(h('p', { class: 't-support' }, 'Pick a task on the left to begin.'))
      return
    }
    const t = this.exp.trial(id)
    if (t.result) return this.renderResult(t)
    const locked = this.exp.pending?.id === id
    const head = h('div', { class: 'stack', style: 'gap:4px' }, h('h3', { class: 't-heading' }, this.shortName(t)), h('p', { class: 't-support' }, `${t.task.prompt} Predict before you run it: you must commit first.`))
    let lock!: HTMLButtonElement
    const complete = () => !!this.pickedOption && !!this.conf
    const refresh = () => lock && setDisabled(lock, !complete())
    const opts = h('div', { class: 'opt-list', role: 'radiogroup' })
    const paint = () =>
      opts.replaceChildren(
        ...t.task.predictionOptions.map((o, i) => h('button', { class: 'conf-btn opt-row', type: 'button', role: 'radio', 'aria-checked': String(this.pickedOption === o.id), 'aria-disabled': locked ? 'true' : null, onclick: () => { if (locked) return; this.pickedOption = o.id; paint(); refresh() } }, h('span', { class: 'opt-letter' }, 'ABCDEF'[i]), h('span', { class: 't-label' }, o.label))),
      )
    paint()
    lock = button(locked ? 'Prediction locked' : 'Lock in prediction', { variant: locked ? 'ghost' : 'primary', disabled: locked || !complete() })
    lock.addEventListener('click', () => {
      if (!complete() || locked) return
      this.handlers.onLock(id, this.pickedOption as string, this.conf as Confidence, Math.round(performance.now() - this.openedAt))
    })
    const list = this.checklist(t)
    const ready = list.every((c) => c.ok)
    const run = button('Run it & record', { variant: 'primary', disabled: !locked || !ready })
    run.addEventListener('click', () => this.handlers.onRun())
    const check = h('ul', { class: 'checklist' }, ...list.map((c) => h('li', { class: c.ok ? 'ok' : '' }, `${c.ok ? '✓' : '○'} ${c.label}`)))
    this.cardBody.replaceChildren(
      head,
      h('div', { class: 'optics-predict' }, h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'What do you expect?'), opts), h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'How sure are you?'), this.confidenceRow(refresh, locked))),
      h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, 'Then, on the bench'), check),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, lock, run),
    )
  }

  private readings(t: Trial): string {
    const d = t.result!.data
    const n = (k: string) => String(d[k])
    switch (t.id) {
      case 'wave_1':
        return `At ${n('f1')} Hz the wavelength in the tank was ${n('lambda1Cm')} cm. At ${n('f2')} Hz it is ${n('lambda2Cm')} cm. Each wave takes ${n('period2Ms')} ms.`
      case 'wave_2':
        return `Amplitude went from ${n('a1')} mm to ${n('a2')} mm: the level changed by ${Number(d.gainDb) >= 0 ? '+' : ''}${n('gainDb')} dB.`
      case 'echo_1':
        return `In the small room the clap lingered for about ${n('rt')} s. In the open field it was over at once.`
      case 'echo_2':
        return `The echo returned after ${n('t')} s. Your stopwatch read ${n('measuredT')} s.`
      case 'sonar_1':
        return `The timer read ${n('t')} s between the pulse and its echo.`
      default:
        return `The cyst is ${n('s')} mm across. Audible sound has a wavelength of about ${n('lambdaAudibleCm')} cm; the ultrasound used here, about ${n('lambdaUltraMm')} mm.`
    }
  }

  private renderResult(t: Trial) {
    const r = t.result!
    const owedCalc = r.hasCalc && !t.calc.ok
    const owedExplain = !t.explained
    const parts: (Node | null)[] = [h('div', { class: 'row row-between' }, h('h3', { class: 't-heading' }, this.shortName(t)), badge(r.match ? 'Matched' : 'Not quite', r.match ? 'success' : 'warning'))]
    parts.push(h('p', null, h('span', { class: 't-label' }, 'You predicted: '), t.task.predictionOptions.find((o) => o.id === t.prediction)?.label ?? ''))
    parts.push(h('p', { class: 'readings' }, h('span', { class: 't-label' }, 'The instruments show: '), this.readings(t)))
    if (owedCalc) parts.push(this.calcBox(t))
    else if (r.hasCalc) parts.push(h('p', { class: 't-support' }, `✓ Your calculation: ${t.calc.value} m (${t.calc.attempts} ${t.calc.attempts === 1 ? 'try' : 'tries'}).`))
    if (!owedCalc) parts.push(this.explainBox(t, owedExplain))
    else parts.push(h('p', { class: 't-support' }, 'Calculate first, then explain.'))
    if (t.reveal) {
      parts.push(h('p', { class: r.anomaly ? 'optics-anomaly' : 't-support' }, t.reveal.explanation))
      if (t.reveal.anomalyExplanation) parts.push(h('p', { class: 'optics-anomaly' }, t.reveal.anomalyExplanation))
      if (r.anomaly)
        parts.push(t.anomalyNoticed ? h('p', { class: 't-support' }, '✓ You flagged this one.') : button('I see it: higher frequency did not make the wave faster', { variant: 'primary', onClick: () => this.handlers.onNoticeAnomaly(t.id) }))
    }
    const last = this.exp.answered === this.exp.items.length
    const next = button(last ? 'Finish & see the summary' : 'Next task', { variant: 'primary', disabled: owedCalc || owedExplain, onClick: () => (last ? this.handlers.onSubmit() : this.handlers.onNext()) })
    if (owedCalc || owedExplain) next.title = 'Calculate and explain this run first'
    parts.push(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, next))
    this.cardBody.replaceChildren(...parts.filter((x): x is Node => !!x))
  }

  private calcBox(t: Trial): HTMLElement {
    this.calcInput = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'Depth in metres', 'aria-label': 'Your calculated depth in metres' }) as HTMLInputElement
    const go = button('Check', { size: 'sm', variant: 'primary', onClick: () => void send() })
    const send = async () => {
      const v = Number(this.calcInput?.value)
      if (!Number.isFinite(v) || v <= 0) return
      setDisabled(go, true)
      try {
        await this.handlers.onCalc(t.id, v)
      } finally {
        setDisabled(go, false)
      }
    }
    this.calcInput.addEventListener('keydown', (e) => e.key === 'Enter' && void send())
    return h(
      'div',
      { class: 'stack', style: 'gap:6px' },
      h('span', { class: 't-label' }, 'Now calculate it from your own reading'),
      h('p', { class: 't-support' }, `Use the timer reading and the speed of sound given in the task. Tries so far: ${t.calc.attempts}.`),
      h('div', { class: 'row', style: 'gap:8px' }, this.calcInput, go),
      this.calcNote.get(t.id) ? h('p', { class: 'optics-anomaly' }, this.calcNote.get(t.id)) : null,
    )
  }
  setCalcNote(id: string, text: string) {
    this.calcNote.set(id, text)
  }

  /* ---------------- explain-back (spoken where the browser can record) ---------------- */
  private explainPrompt(t: Trial): string {
    return `Describe what you set or measured (include a number from the task or from an instrument), what you saw, and how it compared with your prediction. (${t.tabName})`
  }
  private needsAudio(): boolean {
    return this.exp.lesson.config.requireAudioExplanation && voiceSupport().recorder && !this.micFailed
  }

  private explainBox(t: Trial, owed: boolean): HTMLElement {
    if (t.explained) {
      return h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 't-label' }, `✓ Your explanation (${t.explained.inputMode === 'voice' ? 'spoken' : 'typed'})`), h('p', { class: 't-support' }, t.explained.text))
    }
    const support = voiceSupport()
    const needsAudio = owed && this.needsAudio()
    const id = t.id
    this.textArea = h('textarea', { class: 'input optics-note', rows: 3, placeholder: support.recognition ? 'Press record and explain aloud. Your words appear here, and you can fix them.' : 'In your own words…', 'aria-label': 'Your explanation' }) as HTMLTextAreaElement
    this.textArea.value = this.drafts.get(id) ?? ''
    this.textArea.addEventListener('input', () => {
      this.drafts.set(id, this.textArea!.value)
      this.paintSend(t, needsAudio)
    })
    this.textArea.addEventListener('paste', (e) => this.pasted.set(id, (this.pasted.get(id) ?? 0) + ((e as ClipboardEvent).clipboardData?.getData('text').length ?? 0)))
    this.textArea.addEventListener('drop', (e) => this.pasted.set(id, (this.pasted.get(id) ?? 0) + ((e as DragEvent).dataTransfer?.getData('text').length ?? 0)))
    this.wordLabel = h('span', { class: 't-support t-mono' })
    this.sendBtn = button('Submit explanation', { variant: 'primary', onClick: () => void this.send(t, needsAudio) })
    this.micNote = h('span', { class: 't-support' }, !support.recorder ? 'This browser cannot record. Type your explanation instead.' : this.micFailed ? 'The microphone is not available. Type your explanation instead.' : this.recorded.has(id) ? `Recorded ${(this.recorded.get(id)!.durationMs / 1000).toFixed(0)}s. You can record again or edit the text.` : needsAudio ? 'Explaining aloud is part of this lab.' : '')
    const rec = this.recorded.has(id)
    this.micButton = button(this.voice.recording ? '■ Stop' : rec ? '● Record again' : '● Record my explanation', { variant: rec ? 'secondary' : 'primary', onClick: () => void this.toggleMic(t, needsAudio) })
    this.paintSend(t, needsAudio)
    return h(
      'div',
      { class: 'stack', style: 'gap:8px' },
      h('span', { class: 't-label' }, 'Explain this run to continue'),
      h('p', { class: 't-support' }, this.explainPrompt(t)),
      support.recorder ? h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' }, this.micButton, this.micNote) : this.micNote,
      this.textArea,
      h('div', { class: 'row row-between' }, this.wordLabel, this.sendBtn),
    )
  }

  private paintSend(t: Trial, needsAudio: boolean) {
    const words = (this.drafts.get(t.id) ?? '').trim().split(/\s+/).filter(Boolean).length
    const min = this.exp.minWords
    if (this.wordLabel) this.wordLabel.textContent = `${words} / ${min} words`
    if (!this.sendBtn) return
    const blocked = this.sending || words < min || (needsAudio && !this.recorded.has(t.id))
    setDisabled(this.sendBtn, blocked)
    this.sendBtn.title = words < min ? `Write at least ${min} words` : needsAudio && !this.recorded.has(t.id) ? 'Record your explanation first' : ''
  }

  private async toggleMic(t: Trial, needsAudio: boolean) {
    const id = t.id
    if (this.voice.recording) {
      const r = await this.voice.stop()
      this.recorded.set(id, r)
      const cur = this.drafts.get(id) ?? ''
      if (r.transcript && r.transcript.split(/\s+/).length >= cur.split(/\s+/).filter(Boolean).length) this.drafts.set(id, r.transcript)
      this.renderCard()
      return
    }
    if (this.micNote) this.micNote.textContent = 'Listening… speak now.'
    const ok = await this.voice.start(
      (text) => {
        this.drafts.set(id, text)
        if (this.textArea) this.textArea.value = text
        this.paintSend(t, needsAudio)
      },
      (msg) => {
        if (this.micNote) this.micNote.textContent = msg
      },
    )
    if (!ok) {
      this.micFailed = true
      this.renderCard()
      return
    }
    if (this.micButton) this.micButton.textContent = '■ Stop'
  }

  private async send(t: Trial, needsAudio: boolean) {
    if (this.sendBtn?.getAttribute('aria-disabled') === 'true' || this.sending) return
    this.sending = true
    this.paintSend(t, needsAudio)
    const rec = this.recorded.get(t.id)
    const meta: ExplainMeta = { inputMode: rec ? 'voice' : 'typed', speakMs: rec?.durationMs ?? 0, pasted: this.pasted.get(t.id) ?? 0, blurs: this.blurs.get(t.id) ?? 0 }
    try {
      await this.handlers.onExplain(t.id, this.drafts.get(t.id) ?? '', meta, rec?.blob ?? null)
    } finally {
      this.sending = false
      this.renderCard()
    }
  }

  /* ---------------- the summary ---------------- */
  showReveal(summary: Summary, reveal: SoundReveal, onExit: () => void, onReview: () => void) {
    const d = dialog({ title: 'Your summary', description: 'What each task showed, the numbers behind it, and where you meet this in real life.', wide: true, dismissable: false })
    const stat = (n: string | number, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, String(n)), h('div', { class: 't-support' }, l))
    const factText = (f: Record<string, number | string>) => Object.entries(f).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`).join(' · ')
    const rows = reveal.tasks.map((t) => h('tr', null, h('td', { class: 't-label' }, t.id.replace('_', ' ')), h('td', null, badge(t.right ? 'Right' : 'Not quite', t.right ? 'success' : 'warning'), h('div', { class: 't-support' }, `You said: ${t.yourPrediction}`), t.right ? null : h('div', { class: 't-support' }, `Answer: ${t.answerLabel}`)), h('td', { class: 't-support' }, t.explanation, h('div', { class: 't-mono' }, factText(t.facts)))))
    const uses = reveal.uses.map((u) => h('div', { class: 'optics-use' }, h('h4', { class: 't-label' }, u.topic), h('ul', null, ...u.examples.map((x) => h('li', null, x))), h('p', { class: 't-support' }, u.why)))
    d.body.append(
      h('div', { class: 'stats' }, stat(`${summary.correct}/${summary.total}`, 'predictions right'), stat(summary.calcAttempts, 'calculation tries')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Task'), h('th', null, 'Your prediction'), h('th', null, 'What it showed'))), h('tbody', null, rows))),
      h('div', { class: 'optics-uses' }, ...uses),
      h('p', { class: 't-support' }, 'Your result is only part of the story: how you predicted, measured, calculated and explained is what your instructor sees.'),
      h('div', { class: 'dialog-actions' }, button('Look at the bench', { variant: 'ghost', onClick: () => { d.close(); onReview() } }), button('Back to experiments', { variant: 'primary', onClick: () => { d.close(); onExit() } })),
    )
  }

  destroy() {
    this.voice.cancel()
    if (this.stopwatchTimer !== null) window.clearInterval(this.stopwatchTimer)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
