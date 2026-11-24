import type { OpticsImageField, OpticsReveal } from '@mmaxr/schema'
import { IMAGE_FIELDS, type Confidence, type ExplainMeta, type OpticsExperiment, type Phase, type Summary, type Trial } from '../state/optics'
import { h } from '../ui/dom'
import { badge, button, dialog, setDisabled } from '../ui/components'
import { sound } from './sound'
import { VoiceCapture, voiceSupport, type VoiceResult } from './voice'

export interface OpticsHudHandlers {
  onBack(): void
  onSelect(id: string): void
  onLock(id: string, prediction: Record<string, string>, confidence: Confidence, decisionMs: number): void
  onRun(): void
  onNext(): void
  onNoticeAnomaly(id: string): void
  onExplain(id: string, text: string, meta: ExplainMeta, audio: Blob | null): Promise<void> | void
  onCell(id: string, field: OpticsImageField, value: string): void
  onSubmit(): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]

const STEPS = ['Plane mirror', 'Laws', 'Ray rules', 'Concave', 'Convex', 'Lock in']
const FIELD_LABEL: Record<OpticsImageField, string> = { position: 'Position', size: 'Size', nature: 'Nature', orientation: 'Orientation' }
const STEP_OF: Record<Phase, number> = { plane: 0, laws: 1, rules: 2, concave: 3, convex: 4, table: 5, reveal: 6 }

const INTRO: Record<Phase, { title: string; text: string }> = {
  plane: { title: 'Phase 1 · Regular or irregular?', text: 'You have a parallel laser beam and two surfaces: a smooth plane mirror and a crumpled sheet of foil. For each one, predict what the beam will do, then fire.' },
  laws: { title: 'Phase 2 · The laws of reflection', text: 'A single laser beam now hits the plane mirror at a measured angle. Three predictions, one per law: where does the reflected ray go? Fire the laser to check, and the law is revealed once you have committed.' },
  rules: { title: 'Phase 3 · The four ray rules', text: 'On a spherical mirror, four special rays are easy to draw. Each one shows you where the laser starts. Predict where the reflected ray goes, then fire it.' },
  concave: { title: 'Phase 4 · Concave mirror', text: 'Slide the candle to each of the six positions. Predict the image (where, how big, real or virtual, which way up), then trace the rays to see it formed.' },
  convex: { title: 'Phase 5 · Convex mirror', text: 'The same stand now holds a convex mirror. Two positions this time: does what you learned carry over?' },
  table: { title: 'Phase 6 · Lock in your table', text: 'Review your image table. Change any cell you now think is wrong, then lock it in to see the textbook answers.' },
  reveal: { title: 'Done', text: 'Orbit the bench to review it, or head back to the experiments.' },
}

export class OpticsHud {
  readonly root: HTMLElement
  private steps: HTMLElement[] = []
  private listBody = h('div', { class: 'stack' })
  private cardBody = h('div', { class: 'stack' })
  private tableBody = h('div', { class: 'stack' })
  private hintText = h('span', { class: 'hint-text' })
  private hintAction: HTMLButtonElement
  private listPanel: HTMLElement
  private cardPanel: HTMLElement
  private tablePanel: HTMLElement
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private soundToggle: HTMLButtonElement
  private tableToggle: HTMLButtonElement
  private hintRun: (() => void) | null = null
  private selected: string | null = null
  private draft: Record<string, string> = {}
  private conf: Confidence | 0 = 0
  private draftFor: string | null = null
  private openedAt = 0
  private tableCells = new Map<string, HTMLSelectElement>()
  private submitBtn: HTMLButtonElement | null = null
  /* explain-back: drafts, recordings and how the text got there, kept per run */
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

  constructor(
    private readonly exp: OpticsExperiment,
    private readonly handlers: OpticsHudHandlers,
    title: string,
  ) {
    this.hintAction = button('Go', { variant: 'primary', onClick: () => this.hintRun?.() })
    this.hintAction.hidden = true
    this.tableToggle = button('My table', { size: 'sm', onClick: () => this.setPanel(this.tablePanel, !this.tablePanel.classList.contains('open')) })
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })

    this.listPanel = h(
      'aside',
      { class: 'panel panel-left', 'aria-label': 'Experiments' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Experiments'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close experiments', onclick: () => this.setPanel(this.listPanel, false) }, '×')),
      this.listBody,
    )
    this.cardPanel = h(
      'aside',
      { class: 'panel panel-tray optics-card', 'aria-label': 'Prediction and result' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Predict, then test'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close', onclick: () => this.setPanel(this.cardPanel, false) }, '×')),
      this.cardBody,
    )
    this.tablePanel = h(
      'aside',
      { class: 'panel panel-tray optics-table-panel', 'aria-label': 'Image table' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'My image table'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close table', onclick: () => this.setPanel(this.tablePanel, false) }, '×')),
      this.tableBody,
    )
    const stepper = h('ol', { class: 'steps', 'aria-label': 'Progress' })
    STEPS.forEach((s, i) => {
      const li = h('li', { class: 'step' }, h('span', { class: 'step-n' }, String(i + 1)), h('span', { class: 'step-l' }, s))
      this.steps.push(li)
      stepper.appendChild(li)
    })
    this.toggles.append(h('span', { class: 'only-mobile' }, button('Experiments', { size: 'sm', onClick: () => this.setPanel(this.listPanel, !this.listPanel.classList.contains('open')) })), this.soundToggle, this.tableToggle)

    this.root = h(
      'div',
      { class: 'hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)), stepper, this.toggles),
      this.listPanel,
      this.cardPanel,
      this.tablePanel,
      h('div', { class: 'hint-bar', role: 'status', 'aria-live': 'polite' }, this.hintText, this.hintAction),
    )
    window.addEventListener('resize', this.layout)
    window.addEventListener('blur', this.onBlur)
    this.buildTable()
    this.update()
  }

  /** Leaving the tab while a run is open is recorded for the instructor, not punished. */
  private onBlur = () => {
    const id = this.selected
    if (!id) return
    const t = this.exp.trial(id)
    if (t.explained || this.exp.phase === 'reveal') return
    this.blurs.set(id, (this.blurs.get(id) ?? 0) + 1)
  }

  private toggleSound() {
    sound.setMuted(!sound.muted)
    this.soundToggle.textContent = sound.muted ? 'Sound off' : 'Sound on'
    if (!sound.muted) sound.click()
  }

  /* ---------------- panels ---------------- */
  private isNarrow = () => window.innerWidth <= 1000
  private trays = () => [this.cardPanel, this.tablePanel]

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
    const others = [this.listPanel, ...this.trays(), ...this.extraPanels].filter((p) => p !== panel)
    // The two bottom trays share one spot; on a phone every panel does.
    for (const p of others) {
      const share = this.isNarrow() || (this.trays().includes(panel) && this.trays().includes(p))
      if (open && share && p.classList.contains('open')) {
        p.classList.remove('open')
        this.panelListeners.get(p)?.(false)
      }
    }
    panel.classList.toggle('open', open)
    this.panelListeners.get(panel)?.(open)
    this.root.classList.toggle('tray-open', this.trays().some((p) => p.classList.contains('open')))
    this.layout()
  }

  layout = () => {
    const narrow = this.isNarrow()
    const top = narrow ? 52 : 56
    let left = 0
    let bottom = 0
    const hint = this.hintText.parentElement!.getBoundingClientRect()
    const openTray = this.trays().find((p) => p.classList.contains('open'))
    if (narrow) {
      const open = [this.listPanel, ...this.trays(), ...this.extraPanels].find((p) => p.classList.contains('open'))
      bottom = open ? open.getBoundingClientRect().height + 8 : hint.height + 24
    } else {
      left = this.listPanel.getBoundingClientRect().right + 8
      bottom = openTray ? openTray.getBoundingClientRect().height + 24 : hint.height + 28
    }
    this.handlers.onLayout({ left, right: 0, top, bottom })
  }

  hint(text: string, action?: { label: string; run: () => void } | null) {
    this.hintText.textContent = text
    this.hintAction.hidden = !action
    this.hintRun = action?.run ?? null
    if (action) this.hintAction.textContent = action.label
    requestAnimationFrame(this.layout)
  }

  /* ---------------- selection ---------------- */
  /** Which experiment the card is about. Opens the card. */
  show(id: string | null) {
    this.selected = id
    if (id !== this.draftFor) {
      this.draft = {}
      this.conf = 0
      this.draftFor = id
      this.openedAt = performance.now()
      const t = id ? this.exp.trial(id) : null
      if (t?.prediction) this.draft = { ...t.prediction }
      if (t?.confidence) this.conf = t.confidence
    }
    this.update()
    if (id) this.setPanel(this.cardPanel, true)
  }
  get current(): string | null {
    return this.selected
  }
  openTable() {
    this.setPanel(this.tablePanel, true)
  }
  closeCard() {
    this.setPanel(this.cardPanel, false)
  }

  /* ---------------- refresh ---------------- */
  update() {
    const e = this.exp
    const step = STEP_OF[e.phase]
    this.steps.forEach((s, i) => {
      s.classList.toggle('done', i < step)
      s.classList.toggle('current', i === step)
    })
    this.renderList()
    this.renderCard()
    this.refreshTable()
    requestAnimationFrame(this.layout)
  }

  private phaseItems(): Trial[] {
    const e = this.exp
    switch (e.phase) {
      case 'plane':
        return e.of('plane')
      case 'laws':
        return e.of('law')
      case 'rules':
        return e.of('rule')
      case 'concave':
        return e.of('concave')
      case 'convex':
        return e.of('convex')
      default:
        return []
    }
  }

  private renderList() {
    const e = this.exp
    const intro = INTRO[e.phase]
    const items = this.phaseItems()
    const done = items.filter((t) => t.result).length
    this.listBody.replaceChildren(h('h3', { class: 't-label' }, intro.title), h('p', { class: 't-support' }, intro.text))
    if (!items.length) return
    this.listBody.append(h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, e.phase === 'concave' || e.phase === 'convex' ? 'Candle positions' : e.phase === 'rules' ? 'Rays' : e.phase === 'laws' ? 'Laws' : 'Surfaces'), badge(`${done} / ${items.length}`, done === items.length ? 'success' : 'neutral')))
    const list = h('div', { class: 'tool-list' })
    for (const t of items) {
      const sel = this.selected === t.id
      const mark = t.result ? (t.result.match ? '✓' : '✗') : t.prediction ? '●' : String(t.sample)
      const sub = t.result && e.needsExplanation(t) && !t.explained ? 'Explain what you saw' : t.result ? (t.result.match ? 'Matched your prediction' : 'Not what you predicted') : t.prediction ? 'Prediction locked' : 'Not tested yet'
      const gate = e.canPredict(t.id)
      list.append(
        h(
          'button',
          { class: `tool${sel ? ' selected' : ''}${t.result && !t.result.match ? ' tool-miss' : ''}`, type: 'button', 'aria-pressed': String(sel), 'aria-disabled': !gate.ok && !t.result ? 'true' : null, onclick: () => this.handlers.onSelect(t.id) },
          h('span', { class: 'tool-check' }, mark),
          h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, this.itemName(t)), h('span', { class: 't-support' }, sub)),
        ),
      )
    }
    this.listBody.append(list)
    if (e.phase === 'concave' || e.phase === 'convex') this.listBody.append(h('p', { class: 't-support' }, 'You can also drag the candle along the rail: it snaps to the nearest position.'))
  }

  private itemName(t: Trial): string {
    if (t.kind === 'case') return this.exp.caseDef(t.id).objectPosition
    if (t.kind === 'rule') return `Ray ${t.sample}`
    if (t.kind === 'law') return t.title
    return t.title
  }

  /* ---------------- the prediction / result card ---------------- */
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

  private optionList(options: { id: string; label: string }[], field: string, locked: boolean, refresh: () => void) {
    const wrap = h('div', { class: 'opt-list', role: 'radiogroup' })
    const paint = () =>
      wrap.replaceChildren(
        ...options.map((o, i) => h('button', { class: 'conf-btn opt-row', type: 'button', role: 'radio', 'aria-checked': String(this.draft[field] === o.id), 'aria-disabled': locked ? 'true' : null, onclick: () => { if (locked) return; this.draft[field] = o.id; paint(); refresh() } }, h('span', { class: 'opt-letter' }, 'ABCDEF'[i]), h('span', { class: 't-label' }, o.label))),
      )
    paint()
    return wrap
  }

  private select(options: { id: string; label: string }[], field: OpticsImageField, locked: boolean, refresh: () => void) {
    const sel = h('select', { class: 'select', 'aria-label': FIELD_LABEL[field], disabled: locked, onchange: (ev: Event) => { this.draft[field] = (ev.target as HTMLSelectElement).value; refresh() } }, h('option', { value: '' }, 'Choose…'), ...options.map((o) => h('option', { value: o.id }, o.label))) as HTMLSelectElement
    sel.value = this.draft[field] ?? ''
    return sel
  }

  private renderCard() {
    const e = this.exp
    const id = this.selected
    if (!id) {
      this.cardBody.replaceChildren(h('p', { class: 't-support' }, 'Pick an experiment on the left to begin.'))
      return
    }
    const t = e.trial(id)
    if (t.result) return this.renderResult(t)
    const locked = e.pending?.id === id
    const lesson = e.lesson
    const head = h('div', { class: 'stack', style: 'gap:4px' }, h('h3', { class: 't-heading' }, this.heading(t)), h('p', { class: 't-support' }, this.prompt(t)))

    const body = h('div', { class: 'optics-predict' })
    let lock: HTMLButtonElement
    const complete = () => (t.kind === 'case' ? IMAGE_FIELDS.every((f) => this.draft[f]) : !!this.draft.outcome) && !!this.conf
    const refresh = () => lock && setDisabled(lock, !complete())

    if (t.kind === 'plane') body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'What will the reflected rays do?'), this.optionList(lesson.planeMirror.predictionOptions, 'outcome', locked, refresh)))
    else if (t.kind === 'law') body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, this.law(t.id).predictionPrompt), this.optionList(this.law(t.id).options, 'outcome', locked, refresh)))
    else if (t.kind === 'rule') body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'Where does the reflected ray go?'), this.optionList(lesson.rayRules.rules.find((r) => r.id === t.id)?.options ?? lesson.rayRules.outcomes, 'outcome', locked, refresh)))
    else {
      const grid = h('div', { class: 'optics-fields' })
      for (const f of IMAGE_FIELDS) grid.append(h('label', { class: 'optics-field' }, h('span', { class: 't-label' }, FIELD_LABEL[f]), this.select(lesson.imageFields[f], f, locked, refresh)))
      body.append(grid)
    }
    body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'How sure are you?'), this.confidenceRow(refresh, locked)))

    lock = button(locked ? 'Prediction locked' : 'Lock in prediction', { variant: locked ? 'ghost' : 'primary', disabled: locked || !complete() })
    lock.addEventListener('click', () => {
      if (!complete() || locked) return
      this.handlers.onLock(id, { ...this.draft }, this.conf as Confidence, Math.round(performance.now() - this.openedAt))
    })
    const run = button(t.kind === 'plane' || t.kind === 'law' ? 'Fire the laser' : t.kind === 'rule' ? 'Fire the ray' : 'Trace the rays', { variant: 'primary', disabled: !locked })
    run.addEventListener('click', () => this.handlers.onRun())
    this.cardBody.replaceChildren(head, body, h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, lock, run))
  }

  private heading(t: Trial): string {
    if (t.kind === 'case') return `${t.tool === 'concave' ? 'Concave' : 'Convex'} mirror · candle at ${this.exp.caseDef(t.id).objectPosition}`
    if (t.kind === 'rule') return `Ray ${t.sample}`
    if (t.kind === 'law') return t.title
    return t.title
  }
  private law(id: string) {
    return this.exp.lesson.lawsOfReflection.laws.find((x) => x.id === id)!
  }
  private prompt(t: Trial): string {
    const l = this.exp.lesson
    if (t.kind === 'plane') return l.planeMirror.scenarios.find((s) => s.id === t.id)!.predictionPrompt
    if (t.kind === 'law') return `${this.law(t.id).incident} Predict before you fire: you must commit first.`
    if (t.kind === 'rule') return `${t.title}. Predict before you fire: you must commit first.`
    return `${this.exp.caseDef(t.id).predictionPrompt} Commit first, then trace the rays.`
  }

  private optionLabel(field: string, id: string | undefined): string {
    if (!id) return '–'
    const l = this.exp.lesson
    const pool = field === 'outcome' ? [...l.planeMirror.predictionOptions, ...l.lawsOfReflection.laws.flatMap((x) => x.options), ...l.rayRules.outcomes] : l.imageFields[field as OpticsImageField]
    return pool.find((o) => o.id === id)?.label ?? id
  }

  private renderResult(t: Trial) {
    const r = t.result!
    const parts: (Node | null)[] = [h('div', { class: 'row row-between' }, h('h3', { class: 't-heading' }, this.heading(t)), badge(r.match ? 'Matched' : 'Not quite', r.match ? 'success' : 'warning'))]
    if (t.kind === 'case' && r.image && r.fields) {
      const rows = IMAGE_FIELDS.map((f) =>
        h('tr', null, h('td', { class: 't-label' }, FIELD_LABEL[f]), h('td', null, this.optionLabel(f, t.prediction?.[f])), h('td', null, this.optionLabel(f, r.image![f])), h('td', null, badge(r.fields![f] ? '✓' : '✗', r.fields![f] ? 'success' : 'error'))),
      )
      parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table optics-compare' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'You predicted'), h('th', null, 'The trace shows'), h('th', null, ''))), h('tbody', null, rows))))
    } else {
      parts.push(h('p', null, h('span', { class: 't-label' }, 'You predicted: '), this.optionLabel('outcome', t.prediction?.outcome), h('br'), h('span', { class: 't-label' }, 'What happened: '), this.optionLabel('outcome', r.outcome)))
    }
    const owed = this.exp.needsExplanation(t) && !t.explained
    // The setup (with this session's numbers) stays in view, because the explanation has to refer to it.
    const setup = t.kind === 'law' ? this.law(t.id).incident : t.kind === 'rule' ? t.title : ''
    if (setup) parts.push(h('p', { class: 't-support' }, h('span', { class: 't-label' }, 'Your setup: '), setup))
    // The explanation of what happened is held back until the student has put it in their own words.
    if (owed) parts.push(h('p', { class: 't-support' }, 'Look at the bench. What happened here is explained once you have explained it yourself.'))
    if (!owed && r.explanation) parts.push(h('p', { class: r.anomaly ? 'optics-anomaly' : 't-support' }, r.explanation))
    if (r.anomaly && !owed) {
      parts.push(
        t.anomalyNoticed
          ? h('p', { class: 't-support' }, '✓ You flagged this one. Check your table: the position cell may need changing.')
          : button('I see it: the rays never meet', { variant: 'primary', onClick: () => this.handlers.onNoticeAnomaly(t.id) }),
      )
    }
    parts.push(this.explainBox(t, owed))
    const last = this.exp.answered === this.exp.items.length
    const nextBtn = button(last ? 'Go to my table' : 'Next experiment', { variant: 'primary', disabled: owed, onClick: () => this.handlers.onNext() })
    if (owed) nextBtn.title = 'Explain this run first'
    parts.push(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, nextBtn, t.kind === 'case' ? button('Open my table', { variant: 'ghost', onClick: () => this.openTable() }) : null))
    this.cardBody.replaceChildren(...parts.filter((x): x is Node => !!x))
  }

  /** What to ask for, about the run itself and the student's own numbers, never about the theory. */
  private explainPrompt(t: Trial): string {
    if (t.kind === 'case') return 'Your prediction differed from the trace. Say what you pictured, what the trace showed, and what changed your mind.'
    if (t.kind === 'plane') return 'Describe what the beams did on this surface in your own run, and how that compared with what you predicted.'
    return 'Describe your setup (include the number or side given in "Your setup" above), what you saw the beam do, and how that compared with your prediction.'
  }

  private needsAudio(): boolean {
    return this.exp.lesson.config.requireAudioExplanation && voiceSupport().recorder && !this.micFailed
  }

  private explainBox(t: Trial, owed: boolean): HTMLElement {
    if (t.explained) {
      return h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 't-label' }, `✓ Your explanation (${t.explained.inputMode === 'voice' ? 'spoken' : 'typed'})`), h('p', { class: 't-support' }, t.explained.text))
    }
    const required = owed
    const support = voiceSupport()
    const needsAudio = required && this.needsAudio()
    const id = t.id
    this.textArea = h('textarea', { class: 'input optics-note', rows: 3, placeholder: required && support.recognition ? 'Press record and explain aloud. Your words appear here, and you can fix them.' : 'In your own words…', 'aria-label': 'Your explanation' }) as HTMLTextAreaElement
    this.textArea.value = this.drafts.get(id) ?? ''
    this.textArea.addEventListener('input', () => {
      this.drafts.set(id, this.textArea!.value)
      this.paintSend(t, needsAudio)
    })
    this.textArea.addEventListener('paste', (e) => this.pasted.set(id, (this.pasted.get(id) ?? 0) + ((e as ClipboardEvent).clipboardData?.getData('text').length ?? 0)))
    this.textArea.addEventListener('drop', (e) => this.pasted.set(id, (this.pasted.get(id) ?? 0) + ((e as DragEvent).dataTransfer?.getData('text').length ?? 0)))
    this.wordLabel = h('span', { class: 't-support t-mono' })
    this.sendBtn = button(required ? 'Submit explanation' : 'Save explanation', { variant: 'primary', onClick: () => void this.send(t, needsAudio) })
    this.micNote = h('span', { class: 't-support' }, !support.recorder ? 'This browser cannot record. Type your explanation instead.' : this.micFailed ? 'The microphone is not available. Type your explanation instead.' : this.recorded.has(id) ? `Recorded ${((this.recorded.get(id)!.durationMs) / 1000).toFixed(0)}s. You can record again or edit the text.` : needsAudio ? 'Explaining aloud is part of this lab.' : '')
    const rec = this.recorded.has(id)
    this.micButton = button(this.voice.recording ? '■ Stop' : rec ? '● Record again' : '● Record my explanation', { variant: rec ? 'secondary' : 'primary', onClick: () => void this.toggleMic(t, needsAudio) })
    this.paintSend(t, needsAudio)
    return h(
      'div',
      { class: 'stack', style: 'gap:8px' },
      h('span', { class: 't-label' }, required ? 'Explain this run to continue' : 'Explain it (optional)'),
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
      this.update()
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
      this.update()
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
      this.update()
    }
  }

  /* ---------------- the table ---------------- */
  private buildTable() {
    const e = this.exp
    const head = h('tr', null, h('th', null, 'Candle at'), ...IMAGE_FIELDS.map((f) => h('th', null, FIELD_LABEL[f])))
    const rows: HTMLElement[] = []
    for (const m of e.lesson.sphericalMirrors) {
      rows.push(h('tr', { class: 'optics-group' }, h('td', { colspan: 5 }, m.mirrorType === 'concave' ? 'Concave mirror' : 'Convex mirror')))
      for (const c of m.cases) {
        const tr = h('tr', null, h('td', { class: 't-label' }, c.objectPosition))
        for (const f of IMAGE_FIELDS) {
          const sel = h(
            'select',
            { class: 'select select-sm', 'aria-label': `${c.objectPosition} ${FIELD_LABEL[f]}`, onchange: (ev: Event) => this.handlers.onCell(c.id, f, (ev.target as HTMLSelectElement).value) },
            h('option', { value: '' }, '—'),
            ...e.lesson.imageFields[f].map((o) => h('option', { value: o.id }, o.label)),
          ) as HTMLSelectElement
          this.tableCells.set(`${c.id}:${f}`, sel)
          tr.append(h('td', null, sel))
        }
        rows.push(tr)
      }
    }
    this.submitBtn = button('Lock in & reveal', { variant: 'primary', block: true, onClick: () => this.handlers.onSubmit() })
    this.tableBody.replaceChildren(
      h('p', { class: 't-support' }, 'Each row fills in with your prediction once you have run it. After the reveal, change any cell you now think is wrong: revising your table is part of the science.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table metals-table optics-table' }, h('thead', null, head), h('tbody', null, rows))),
      this.submitBtn,
    )
  }

  private refreshTable() {
    const e = this.exp
    const locked = e.phase === 'reveal'
    for (const t of e.cases) {
      for (const f of IMAGE_FIELDS) {
        const sel = this.tableCells.get(`${t.id}:${f}`)!
        const ran = !!t.result
        sel.disabled = !ran || locked
        sel.title = ran ? '' : 'Run this experiment first'
        sel.value = e.table[t.id]?.[f] ?? ''
        // After the reveal, mark the cells the trace contradicts, until the student changes them.
        const wrongFirst = ran && t.result!.fields && !t.result!.fields[f]
        const stillWrong = wrongFirst && sel.value === t.prediction?.[f]
        sel.classList.toggle('cell-bad', !!stillWrong)
        sel.classList.toggle('cell-fixed', !!wrongFirst && !stillWrong)
      }
    }
    if (this.submitBtn) {
      setDisabled(this.submitBtn, !e.canSubmit)
      this.submitBtn.title = e.submitBlocker ?? ''
    }
  }

  /* ---------------- the reveal ---------------- */
  showReveal(summary: Summary, reveal: OpticsReveal, onExit: () => void, onReview: () => void) {
    const d = dialog({ title: 'The reveal', description: 'Here is the textbook table next to yours, and where you meet these mirrors every day.', wide: true, dismissable: false })
    const stat = (n: string | number, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, String(n)), h('div', { class: 't-support' }, l))
    const rows = reveal.cases.map((c) => {
      const exp = IMAGE_FIELDS.map((f) => this.optionLabel(f, c.expected[f])).join(' · ')
      const mine = IMAGE_FIELDS.map((f) =>
        c.yours ? h('span', { class: `optics-chip ${c.fields[f] ? 'ok' : 'bad'}` }, this.optionLabel(f, c.yours[f] as string)) : '–',
      )
      return h(
        'tr',
        null,
        h('td', null, h('div', { class: 't-label' }, c.objectPosition), h('div', { class: 't-support' }, c.mirror === 'concave' ? 'Concave' : 'Convex'), c.anomaly ? badge('The anomaly', 'warning') : null),
        h('td', { class: 't-support' }, exp, c.anomaly ? h('div', null, c.explanation) : null),
        h('td', null, h('div', { class: 'optics-chips' }, mine)),
      )
    })
    const uses = reveal.uses.map((u) => h('div', { class: 'optics-use' }, h('h4', { class: 't-label' }, u.mirror === 'concave' ? 'Concave mirrors' : 'Convex mirrors'), h('ul', null, ...u.examples.map((x) => h('li', null, x))), h('p', { class: 't-support' }, u.why)))
    const laws = h('div', { class: 'optics-use' }, h('h4', { class: 't-label' }, 'The three laws of reflection'), h('ol', null, ...reveal.laws.map((l) => h('li', null, l.statement))))
    d.body.append(
      h('div', { class: 'stats' }, stat(`${summary.planeCorrect}/${summary.planeTotal}`, 'surfaces predicted'), stat(`${summary.lawsCorrect}/${summary.lawsTotal}`, 'laws predicted'), stat(`${summary.rulesCorrect}/${summary.rulesTotal}`, 'ray rules predicted'), stat(`${summary.firstTryCorrect}/${summary.cases}`, 'images right first try'), stat(`${reveal.tableCorrect}/${reveal.tableTotal}`, 'rows right in your table'), stat(summary.revisions, 'cells revised')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Candle at'), h('th', null, 'Textbook image'), h('th', null, 'Your table'))), h('tbody', null, rows))),
      laws,
      h('div', { class: 'optics-uses' }, ...uses),
      h('p', { class: 't-support' }, 'Your result is only part of the story: how you predicted, traced and revised your thinking is what your instructor sees.'),
      h('div', { class: 'dialog-actions' }, button('Look at the bench', { variant: 'ghost', onClick: () => { d.close(); onReview() } }), button('Back to experiments', { variant: 'primary', onClick: () => { d.close(); onExit() } })),
    )
  }

  destroy() {
    this.voice.cancel()
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
