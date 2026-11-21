import '../styles/motion.css'
import type { Confidence, MotionExperiment, TrialState } from '../state/motion'
import { VoiceBox } from './voiceBox'
import { h } from '../ui/dom'
import { badge, button, setDisabled } from '../ui/components'
import { sound } from './sound'
import type { Gauge } from './motionScene'

export interface MotionHudHandlers {
  onBack(): void
  onModule(id: string): void
  onNumber(field: string, text: string): void
  onChoice(id: string): void
  onConfidence(c: Confidence): void
  onLock(): void
  onRun(): void
  onExplain(text: string, inputMode: 'voice' | 'typed', speakMs: number, audio: Blob | null): void
  onNext(): void
  onReplay(): void
  onFreeDrive(on: boolean): void
  onDrive(throttle: number, steer: number): void
  onPush(force: number): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]

const ICON: Record<string, string> = { kinematics_track: '🏎️', dynamics_bay: '📦', gravitation_drop: '🪶', magnets_fields: '🧲', electromagnetism: '⚡', force_induction: '🌀', states_changes: '🧊', properties_changes: '🔥', density_measurement: '⚖️' }

export class MotionHud {
  readonly root: HTMLElement
  private card = h('section', { class: 'bio-card', 'aria-live': 'polite' })
  private tabs = h('div', { class: 'mo-tabs', role: 'tablist', 'aria-label': 'Modules' })
  private toggles = h('div', { class: 'row hud-toggles' })
  private gaugesEl = h('div', { class: 'mo-gauges', hidden: '', 'aria-live': 'off' })
  private noteEl = h('div', { class: 'mo-note', hidden: '' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private soundToggle: HTMLButtonElement
  private busyLabel: string | null = null
  private freeDriving = false
  private force = 200
  private lastKey = ''
  private box: VoiceBox | null = null
  private explainBtn: HTMLButtonElement | null = null
  private lockBtn: HTMLButtonElement | null = null
  private summary = false

  constructor(
    private readonly exp: MotionExperiment,
    private readonly handlers: MotionHudHandlers,
    title: string,
  ) {
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })
    this.toggles.append(this.soundToggle)
    this.root = h(
      'div',
      { class: 'hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)), this.tabs, this.toggles),
      this.gaugesEl,
      this.noteEl,
      this.card,
    )
    window.addEventListener('resize', this.layout)
    this.update()
  }

  private toggleSound() {
    sound.setMuted(!sound.muted)
    this.soundToggle.textContent = sound.muted ? 'Sound off' : 'Sound on'
    if (!sound.muted) sound.click()
  }

  /* ---------------- panels (the coach) ---------------- */
  private isNarrow = () => window.innerWidth <= 1000

  attachPanel(panel: HTMLElement, toggle: HTMLElement, onOpenChange: (open: boolean) => void, overlay?: HTMLElement) {
    this.extraPanels.push(panel)
    this.panelListeners.set(panel, onOpenChange)
    this.toggles.insertBefore(toggle, this.soundToggle)
    this.root.insertBefore(panel, this.card)
    if (overlay) this.root.appendChild(overlay)
  }

  setPanelOpen(panel: HTMLElement, open: boolean) {
    if (this.isNarrow() && open) {
      for (const p of this.extraPanels)
        if (p !== panel && p.classList.contains('open')) {
          p.classList.remove('open')
          this.panelListeners.get(p)?.(false)
        }
    }
    panel.classList.toggle('open', open)
    this.panelListeners.get(panel)?.(open)
    this.layout()
  }

  layout = () => {
    const narrow = this.isNarrow()
    const open = this.extraPanels.find((p) => p.classList.contains('open'))
    const cardH = this.card.getBoundingClientRect().height
    const bottom = narrow && open ? open.getBoundingClientRect().height + 8 : cardH + 28
    this.handlers.onLayout({ left: 0, right: narrow ? 0 : 260, top: narrow ? 100 : 108, bottom })
  }

  /* ---------------- live bits ---------------- */
  setGauges(g: Gauge[] | null) {
    if (!g || !g.length) {
      this.gaugesEl.hidden = true
      return
    }
    this.gaugesEl.hidden = false
    this.gaugesEl.replaceChildren(...g.map((x) => h('div', { class: `mo-gauge ${x.tone ?? ''}` }, h('span', {}, x.label), h('strong', {}, x.value))))
  }
  setNote(text: string | null) {
    this.noteEl.hidden = !text
    this.noteEl.textContent = text ?? ''
  }
  setBusy(label: string | null) {
    this.busyLabel = label
    this.update()
  }
  /** Enable or disable the lock button without redrawing the card, so typing keeps its focus. */
  refreshLock() {
    if (this.lockBtn) setDisabled(this.lockBtn, !this.exp.canLock)
  }
  setSummary(on: boolean) {
    this.summary = on
    this.update()
  }
  setFreeDriving(on: boolean) {
    this.freeDriving = on
    this.update()
  }

  /* ---------------- render ---------------- */
  update() {
    const e = this.exp
    this.tabs.replaceChildren(
      ...e.scenarios.map((s) =>
        h(
          'button',
          { class: 'mo-tab', type: 'button', role: 'tab', 'aria-selected': String(s.id === e.scenarioId), onclick: () => this.handlers.onModule(s.id) },
          h('span', { 'aria-hidden': 'true' }, ICON[s.id] ?? '⚛️'),
          s.tabName,
          h('span', { class: 'mo-dots' }, ...e.of(s.id).map((t) => h('span', { class: `mo-dot ${t.stage === 'done' ? 'done' : t === e.current && s.id === e.scenarioId ? 'now' : ''}` }))),
        ),
      ),
    )
    const t = e.current
    const key = `${e.scenarioId}:${t.trial.id}:${t.stage}:${this.busyLabel}:${this.freeDriving}`
    if (key !== this.lastKey) this.lastKey = key
    this.card.replaceChildren(...this.render().filter((n): n is Node => n !== null))
    requestAnimationFrame(this.layout)
  }

  private render(): (Node | null)[] {
    if (this.busyLabel) return [h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'spinner' }), h('span', { class: 't-label' }, this.busyLabel))]
    const e = this.exp
    if (this.summary && e.allDone) return this.renderModuleEnd()
    const t = e.current
    switch (t.stage) {
      case 'open': return this.renderOpen(t)
      case 'locked': return this.renderLocked(t)
      case 'running': return [this.head(t), h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'spinner' }), h('span', { class: 't-label' }, 'Watch what happens…'))]
      case 'observed': return this.renderObserved(t)
      default: return this.renderDone(t)
    }
  }

  private head(t: TrialState): Node {
    const list = this.exp.of(t.scenario)
    const pos = list.indexOf(t) + 1
    const s = this.exp.scenario
    return h(
      'div',
      { class: 'stack', style: 'gap:4px' },
      h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, s.title), h('div', { class: 'row', style: 'gap:6px' }, t.trial.kind === 'transfer' ? badge('What if?', 'warning') : null, badge(`Question ${pos} of ${list.length}`, 'info'))),
      pos === 1 && t.stage === 'open' ? h('p', { class: 't-support' }, s.setup) : null,
    )
  }

  /* ---- predict ---- */
  private renderOpen(t: TrialState): (Node | null)[] {
    const e = this.exp
    const input = t.trial.input
    const body =
      input.type === 'choice'
        ? h('div', { class: 'opt-list', role: 'radiogroup', 'aria-label': 'Your prediction' }, ...input.options.map((o) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(t.choice === o.id), onclick: () => this.handlers.onChoice(o.id) }, h('span', { class: 't-label' }, o.label))))
        : h(
            'div',
            { class: 'mo-fields' },
            ...input.fields.map((f) =>
              h(
                'label',
                { class: 'mo-field' },
                h('span', { class: 't-label' }, f.label),
                h('span', { class: 'row' }, h('input', { class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${f.label} in ${f.unit}`, value: t.numbers[f.id] ?? '', oninput: (ev: Event) => this.handlers.onNumber(f.id, (ev.target as HTMLInputElement).value) }), h('span', { class: 'mo-unit' }, f.unit)),
              ),
            ),
          )
    const conf = h('div', { class: 'conf-row', role: 'radiogroup', 'aria-label': 'How sure are you?' }, ...CONFIDENCE.map((c) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(t.confidence === c.value), onclick: () => this.handlers.onConfidence(c.value) }, h('span', { class: 't-label' }, c.label), h('span', { class: 't-support' }, c.hint))))
    const lock = button(t.trial.action ? 'Lock in my prediction' : 'Lock in my answer', { variant: 'primary', disabled: !e.canLock, onClick: () => this.handlers.onLock() })
    this.lockBtn = lock
    return [
      this.head(t),
      h('p', { class: 'bio-prompt' }, t.trial.prompt),
      body,
      h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, 'How sure are you?'), conf),
      h('div', { class: 'dialog-actions' }, lock),
    ]
  }

  private summaryOf(t: TrialState): string {
    const v = this.exp.predictionValue(t)
    if (!v) return ''
    const input = t.trial.input
    if (input.type === 'choice') return input.options.find((o) => o.id === v.choice)?.label ?? ''
    return input.fields.map((f) => `${f.label}: ${v[f.id]} ${f.unit}`).join('   ·   ')
  }

  private renderLocked(t: TrialState): Node[] {
    return [
      this.head(t),
      h('p', { class: 'bio-prompt' }, t.trial.prompt),
      h('div', { class: 'chips' }, h('span', { class: 'chip chip-static' }, `🔒 ${this.summaryOf(t)}`), h('span', { class: 'chip chip-static' }, ['', 'Just a guess', 'Fairly sure', 'Certain'][t.confidence ?? 0])),
      h('div', { class: 'dialog-actions' }, button('▶ Run the experiment', { variant: 'primary', onClick: () => this.handlers.onRun() })),
    ]
  }

  /* ---- result ---- */
  private compare(t: TrialState): Node | null {
    const o = t.observation
    const input = t.trial.input
    if (!o) return null
    const mine = this.exp.predictionValue(t) ?? {}
    const rows: Node[] = [h('span', { class: 'h' }, ''), h('span', { class: 'h' }, 'You predicted'), h('span', { class: 'h' }, 'It was'), h('span', { class: 'h' }, '')]
    if (input.type === 'choice') {
      const label = (id: unknown) => input.options.find((x) => x.id === id)?.label ?? String(id)
      rows.push(h('span', { class: 't-label' }, 'Answer'), h('span', {}, label(mine.choice)), h('span', {}, label(o.answer.choice)), h('span', {}, o.fieldMatch.choice ? '✓' : '✗'))
    } else {
      for (const f of input.fields) rows.push(h('span', { class: 't-label' }, f.label), h('span', {}, `${mine[f.id]} ${f.unit}`), h('span', {}, `${o.answer[f.id]} ${f.unit}`), h('span', {}, o.fieldMatch[f.id] ? '✓' : '✗'))
    }
    return h('div', { class: 'mo-compare' }, ...rows)
  }

  private result(t: TrialState): Node {
    const o = t.observation!
    return h(
      'div',
      { class: `mo-result ${o.match ? 'match' : 'miss'}` },
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, badge(o.match ? 'Your prediction matched' : 'Not what you predicted', o.match ? 'success' : 'warning'), t.trial.anomaly && !o.match ? badge('A surprising one', 'info') : null, o.law ? badge(o.law.name, 'neutral') : null, o.law?.formula ? h('span', { class: 'chip chip-static t-mono' }, o.law.formula) : null),
      h('p', { class: 'bio-prompt' }, o.outcome),
      this.compare(t),
    )
  }

  private renderObserved(t: TrialState): (Node | null)[] {
    this.box?.destroy()
    const box = new VoiceBox({ minWords: this.exp.minWords, initial: t.explanation, placeholder: 'Why did it happen? Speak it or type it…', onChange: () => this.paintExplain() })
    this.box = box
    this.explainBtn = button('Check my explanation', { variant: 'primary', onClick: () => box.ready && this.handlers.onExplain(box.text, box.mode, box.speakMs, box.audio) })
    this.paintExplain()
    return [
      this.head(t),
      this.result(t),
      h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, t.trial.anomaly ? 'That may have surprised you. Why does it happen?' : 'Why does it happen?'), box.el),
      h('div', { class: 'dialog-actions' }, this.explainBtn),
    ]
  }

  private paintExplain() {
    if (this.explainBtn && this.box) setDisabled(this.explainBtn, !this.box.ready)
  }

  private renderDone(t: TrialState): (Node | null)[] {
    const e = this.exp
    const o = t.observation!
    const kws = t.explained?.keywords ?? []
    const list = e.of(t.scenario)
    const lastInModule = list[list.length - 1] === t
    return [
      this.head(t),
      this.result(t),
      o.explanation ? h('p', { class: 'bio-reveal' }, o.explanation) : null,
      kws.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Key ideas in your explanation'), h('span', { class: 't-label t-mono' }, `${kws.filter((k) => k.matched).length} of ${kws.length}`)), h('div', { class: 'chips' }, ...kws.map((k) => h('span', { class: `chip chip-static ${k.matched ? 'ok' : 'miss'}` }, `${k.matched ? '✓' : '○'} ${k.keyword}`)))) : null,
      this.freePlay(t),
      h(
        'div',
        { class: 'dialog-actions' },
        t.trial.action ? button('↻ Watch again', { variant: 'ghost', onClick: () => this.handlers.onReplay() }) : null,
        lastInModule ? this.nextModuleButton() : button('Next question →', { variant: 'primary', onClick: () => this.handlers.onNext() }),
      ),
    ]
  }

  private nextModuleButton(): Node {
    const e = this.exp
    if (e.allDone) return button('See my summary →', { variant: 'primary', onClick: () => this.handlers.onNext() })
    const next = e.scenarios.find((s) => !e.moduleDone(s.id))
    return button(next ? `Next module: ${next.tabName} →` : 'Finish', { variant: 'primary', onClick: () => (next ? this.handlers.onModule(next.id) : this.handlers.onNext()) })
  }

  /** Play-around controls for the module, offered once a question has been answered. */
  private freePlay(t: TrialState): Node | null {
    if (t.scenario === 'kinematics_track') {
      if (this.freeDriving)
        return h(
          'div',
          { class: 'mo-free' },
          button('■ Stop free drive', { variant: 'secondary', size: 'sm', onClick: () => this.handlers.onFreeDrive(false) }),
          h('span', { class: 't-support' }, 'Arrow keys or W A S D · R resets. Watch distance, displacement and acceleration.'),
          this.pad(),
        )
      return h('div', { class: 'mo-free' }, button('🏎️ Free drive', { variant: 'secondary', size: 'sm', onClick: () => this.handlers.onFreeDrive(true) }), h('span', { class: 't-support' }, 'Drive the car yourself and watch the gauges.'))
    }
    if (t.scenario === 'dynamics_bay') {
      const out = h('span', { class: 't-label t-mono' }, `${this.force} N`)
      const slider = h('input', {
        type: 'range',
        min: '0',
        max: '600',
        step: '10',
        value: String(this.force),
        'aria-label': 'Push force in newtons',
        oninput: (ev: Event) => {
          this.force = Number((ev.target as HTMLInputElement).value)
          out.textContent = `${this.force} N`
        },
      })
      return h('div', { class: 'mo-free' }, h('span', { class: 't-label' }, 'Push the heavy crate'), slider, out, button('Push', { variant: 'secondary', size: 'sm', onClick: () => this.handlers.onPush(this.force) }))
    }
    return null
  }

  private pad(): Node {
    const b = (label: string, throttle: number, steer: number, col: string, row: string) => {
      const el = button(label, { variant: 'secondary', size: 'sm' })
      el.style.gridColumn = col
      el.style.gridRow = row
      const on = () => this.handlers.onDrive(throttle, steer)
      const off = () => this.handlers.onDrive(0, 0)
      el.addEventListener('pointerdown', on)
      el.addEventListener('pointerup', off)
      el.addEventListener('pointerleave', off)
      return el
    }
    return h('div', { class: 'mo-pad' }, b('↑', 1, 0, '2', '1'), b('←', 0, 1, '1', '2'), b('↓', -1, 0, '2', '2'), b('→', 0, -1, '3', '2'))
  }

  private renderModuleEnd(): (Node | null)[] {
    const e = this.exp
    const s = e.summary()
    const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, n), h('div', { class: 't-support' }, l))
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('h2', { class: 't-title' }, 'Sandbox complete'), h('p', { class: 't-support' }, 'You predicted, watched and explained every experiment. Here is how your thinking went.')),
      h('div', { class: 'stats' }, stat(`${s.predictionsRight}/${s.predictions}`, 'predictions that matched'), stat(`${s.surprisesRight}/${s.surprises}`, 'surprises you saw coming'), stat(`${Math.round(s.avgCoverage * 100)}%`, 'key ideas in your explanations'), stat(`${s.transferRight}/${s.transfer}`, '“what if?” answers right')),
      this.freePlay(e.current),
      h('div', { class: 'dialog-actions' }, button('Back to experiments', { variant: 'primary', onClick: () => this.handlers.onBack() })),
    ]
  }

  destroy() {
    this.box?.destroy()
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
