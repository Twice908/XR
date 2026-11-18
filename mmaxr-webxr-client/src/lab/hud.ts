import { COLOR_WORDS, PH_PAPER_SCALE, cssColor, sameColor } from '../services/colors'
import { PH_TOOL, truthOf, type ChemistryExperiment, type Confidence, type Conclusion, type Summary } from '../state/chemistry'
import { h } from '../ui/dom'
import { badge, button, dialog, setDisabled } from '../ui/components'

export interface HudHandlers {
  onBack(): void
  onToggleIndicator(id: string): void
  onStartTesting(): void
  onSelectTool(id: string): void
  onAddIndicator(): void
  onRecordColor(tube: number, tool: string, color: string): void
  onConclusion(tube: number, c: Conclusion | ''): void
  onRecordPh(tube: number, value: number | null): void
  onSubmit(): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

export interface PredictionRequest {
  tube: number
  toolName: string
  isPaper: boolean
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]

const STEPS = ['Choose tools', 'Test', 'pH paper', 'Reveal']

export class Hud {
  readonly root: HTMLElement
  private steps: HTMLElement[] = []
  private toolsBody = h('div', { class: 'stack' })
  private notebookBody = h('div', { class: 'stack' })
  private hintText = h('span', { class: 'hint-text' })
  private hintAction: HTMLButtonElement
  private toolsPanel: HTMLElement
  private notebookPanel: HTMLElement
  private cells = new Map<string, HTMLSelectElement | HTMLInputElement>()
  private notebookKey = ''
  private submitBtn: HTMLButtonElement | null = null
  private ready = false
  private hintRun: (() => void) | null = null
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private notebookToggle: HTMLButtonElement = button('Notebook', { size: 'sm', onClick: () => this.togglePanel(this.notebookPanel) })

  constructor(
    private readonly exp: ChemistryExperiment,
    private readonly handlers: HudHandlers,
    title: string,
  ) {
    this.hintAction = button('Add indicator', { variant: 'primary', onClick: () => this.hintRun?.() })
    this.hintAction.hidden = true

    this.toolsPanel = h(
      'aside',
      { class: 'panel panel-left', 'aria-label': 'Tools' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Your tools'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close tools', onclick: () => this.setPanel(this.toolsPanel, false) }, '×')),
      this.toolsBody,
    )
    this.notebookPanel = h(
      'aside',
      { class: 'panel panel-tray', 'aria-label': 'Lab notebook' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Lab notebook'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close notebook', onclick: () => this.setPanel(this.notebookPanel, false) }, '×')),
      this.notebookBody,
    )

    const stepper = h('ol', { class: 'steps', 'aria-label': 'Progress' })
    STEPS.forEach((s, i) => {
      const li = h('li', { class: 'step' }, h('span', { class: 'step-n' }, String(i + 1)), h('span', { class: 'step-l' }, s))
      this.steps.push(li)
      stepper.appendChild(li)
    })

    this.toggles.append(h('span', { class: 'only-mobile' }, button('Tools', { size: 'sm', onClick: () => this.togglePanel(this.toolsPanel) })), this.notebookToggle)
    this.root = h(
      'div',
      { class: 'hud' },
      h(
        'header',
        { class: 'hud-top' },
        h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)),
        stepper,
        this.toggles,
      ),
      this.toolsPanel,
      this.notebookPanel,
      h('div', { class: 'hint-bar', role: 'status', 'aria-live': 'polite' }, this.hintText, this.hintAction),
    )
    this.ready = true
    window.addEventListener('resize', this.layout)
    // Touching the notebook again before it hides keeps it open.
    this.notebookPanel.addEventListener('focusin', () => this.cancelClose())
    this.update()
  }

  private isNarrow = () => window.innerWidth <= 1000

  /** Add another slide-in panel (e.g. the coach) with its own toggle button and optional overlay. */
  attachPanel(panel: HTMLElement, toggle: HTMLElement, onOpenChange: (open: boolean) => void, overlay?: HTMLElement) {
    this.extraPanels.push(panel)
    this.panelListeners.set(panel, onOpenChange)
    this.toggles.insertBefore(toggle, this.notebookToggle)
    this.root.insertBefore(panel, this.root.querySelector('.hint-bar'))
    if (overlay) this.root.appendChild(overlay)
  }

  setPanelOpen(panel: HTMLElement, open: boolean) {
    this.setPanel(panel, open)
  }

  private togglePanel(panel: HTMLElement) {
    this.setPanel(panel, !panel.classList.contains('open'))
  }

  private setPanel(panel: HTMLElement, open: boolean) {
    if (this.isNarrow() && open) {
      // One bottom sheet at a time on small screens.
      for (const p of [this.toolsPanel, this.notebookPanel, ...this.extraPanels]) {
        if (p !== panel && p.classList.contains('open')) {
          p.classList.remove('open')
          this.panelListeners.get(p)?.(false)
        }
      }
    }
    panel.classList.toggle('open', open)
    this.panelListeners.get(panel)?.(open)
    this.root.classList.toggle('tray-open', this.notebookPanel.classList.contains('open'))
    this.layout()
  }

  openNotebook() {
    this.cancelClose()
    this.setPanel(this.notebookPanel, true)
  }

  private closeTimer: number | null = null

  private cancelClose() {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer)
    this.closeTimer = null
  }

  /** Tuck the notebook away once a reading is saved so the bench is visible again. */
  closeNotebookSoon(ms = 650) {
    this.cancelClose()
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null
      this.setPanel(this.notebookPanel, false)
    }, ms)
  }

  /** Report how much of the canvas the HUD covers so the 3D scene can frame itself in the rest. */
  layout = () => {
    const narrow = this.isNarrow()
    const top = narrow ? 52 : 56
    let left = 0
    let bottom = 0
    const hint = this.hintText.parentElement!.getBoundingClientRect()
    const trayOpen = this.notebookPanel.classList.contains('open')
    if (narrow) {
      const open = [this.toolsPanel, this.notebookPanel, ...this.extraPanels].find((p) => p.classList.contains('open'))
      bottom = open ? open.getBoundingClientRect().height + 8 : hint.height + 24
    } else {
      left = this.toolsPanel.getBoundingClientRect().right + 8
      bottom = trayOpen ? this.notebookPanel.getBoundingClientRect().height + 24 : hint.height + 28
    }
    this.handlers.onLayout({ left, right: 0, top, bottom })
  }

  /* ---------------- hint bar ---------------- */
  hint(text: string, action?: { label: string; run: () => void } | null) {
    this.hintText.textContent = text
    this.hintAction.hidden = !action
    this.hintRun = action?.run ?? null
    if (action) this.hintAction.textContent = action.label
    requestAnimationFrame(this.layout)
  }

  /* ---------------- full refresh from state ---------------- */
  update() {
    if (!this.ready) return
    const e = this.exp
    const stepIndex = e.phase === 'select_tools' ? 0 : e.phase === 'testing' ? 1 : e.phase === 'ph' ? 2 : 3
    this.steps.forEach((s, i) => {
      s.classList.toggle('done', i < stepIndex)
      s.classList.toggle('current', i === stepIndex)
    })
    this.renderTools()
    this.renderNotebook()
    requestAnimationFrame(this.layout)
  }

  private renderTools() {
    const e = this.exp
    const body = this.toolsBody
    body.replaceChildren()

    if (e.phase === 'select_tools') {
      body.append(
        h('p', { class: 't-support' }, `Choose ${e.required} indicators to test your unknown solutions. Click a bottle on the bench or pick below.`),
        h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Indicators'), badge(`${e.chosen.length} / ${e.required}`, e.chosen.length === e.required ? 'success' : 'neutral')),
      )
      const list = h('div', { class: 'tool-list' })
      for (const ind of e.colorIndicators) {
        const on = e.chosen.includes(ind.id)
        const locked = !on && e.chosen.length >= e.required
        list.append(
          h(
            'button',
            { class: `tool${on ? ' selected' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-disabled': locked ? 'true' : null, onclick: () => !locked && this.handlers.onToggleIndicator(ind.id) },
            h('span', { class: 'tool-check' }, on ? '✓' : ''),
            h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, ind.name), h('span', { class: 't-support' }, ind.source)),
          ),
        )
      }
      const start = button('Start testing', { variant: 'primary', block: true, disabled: !e.canStartTesting, onClick: () => this.handlers.onStartTesting() })
      body.append(list, start)
      return
    }

    body.append(h('p', { class: 't-support' }, e.phase === 'ph' ? 'All tubes concluded. Now find each exact pH.' : 'Pick the tool you want to use, then click a test tube.'))
    const list = h('div', { class: 'tool-list' })
    for (const id of e.chosen) {
      const ind = e.indicator(id)!
      const active = e.activeTool === id && e.phase !== 'reveal'
      const done = e.tubes.filter((t) => t.results[id]).length
      list.append(
        h(
          'button',
          { class: `tool${active ? ' selected' : ''}`, type: 'button', 'aria-pressed': String(active), 'aria-disabled': e.phase !== 'testing' || e.pending ? 'true' : null, onclick: () => this.handlers.onSelectTool(id) },
          h('span', { class: 'tool-check' }, active ? '●' : ''),
          h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, ind.name), h('span', { class: 't-support' }, `${done} / ${e.tubes.length} tubes tested`)),
        ),
      )
    }
    const phActive = e.activeTool === PH_TOOL && e.phase === 'ph'
    const phDone = e.tubes.filter((t) => t.results[PH_TOOL]).length
    list.append(
      h(
        'button',
        { class: `tool${phActive ? ' selected' : ''}`, type: 'button', 'aria-pressed': String(phActive), 'aria-disabled': e.phase === 'ph' ? null : 'true', onclick: () => this.handlers.onSelectTool(PH_TOOL) },
        h('span', { class: 'tool-check' }, e.phase === 'ph' || e.phase === 'reveal' ? (phActive ? '●' : '') : '🔒'),
        h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, 'Universal pH paper'), h('span', { class: 't-support' }, e.phase === 'testing' ? 'Unlocks when every tube has a conclusion' : `${phDone} / ${e.tubes.length} tubes tested`)),
      ),
    )
    body.append(list)

    if (e.phase === 'ph' || e.phase === 'reveal') {
      body.append(
        h('div', { class: 'ph-key' }, h('span', { class: 't-label' }, 'pH paper colour key'), ...PH_PAPER_SCALE.map((s) => h('div', { class: 'ph-key-row' }, h('span', { class: 'swatch', style: `background:${cssColor(s.color)}` }), h('span', null, s.color), h('span', { class: 't-support' }, `pH ${s.range}`)))),
      )
    }
  }

  /* ---------------- notebook ---------------- */
  private renderNotebook() {
    const e = this.exp
    if (e.phase === 'select_tools') {
      this.notebookKey = ''
      this.cells.clear()
      this.notebookBody.replaceChildren(h('p', { class: 't-support' }, 'Your notebook opens when you start testing. You will write down what you see, what you think each liquid is, and its pH.'))
      return
    }
    const key = e.chosen.join('|')
    if (key !== this.notebookKey) this.buildNotebook(key)
    this.syncNotebook()
  }

  private buildNotebook(key: string) {
    const e = this.exp
    this.notebookKey = key
    this.cells.clear()
    const head = h('tr', null, h('th', null, 'Tube'), ...e.chosen.map((id) => h('th', null, e.indicator(id)!.name)), h('th', null, 'Is it…'), h('th', null, 'pH'))
    const rows = e.tubes.map((t) => {
      const tr = h('tr', null, h('td', { class: 't-label' }, `#${t.index + 1}`))
      for (const id of e.chosen) {
        const sel = this.colorSelect(`Tube ${t.index + 1}, ${e.indicator(id)!.name} colour`, (v) => this.handlers.onRecordColor(t.index, id, v))
        this.cells.set(`c:${t.index}:${id}`, sel)
        tr.append(h('td', null, sel))
      }
      const concl = h(
        'select',
        { class: 'select select-sm', 'aria-label': `Tube ${t.index + 1} conclusion`, onchange: (ev: Event) => this.handlers.onConclusion(t.index, (ev.target as HTMLSelectElement).value as Conclusion | '') },
        h('option', { value: '' }, '—'),
        h('option', { value: 'acid' }, 'Acid'),
        h('option', { value: 'base' }, 'Base'),
        h('option', { value: 'neutral' }, 'Neutral'),
      )
      this.cells.set(`k:${t.index}`, concl)
      const ph = h('input', {
        class: 'input select-sm ph-input',
        type: 'number',
        min: '0',
        max: '14',
        step: '1',
        inputmode: 'numeric',
        placeholder: '0–14',
        'aria-label': `Tube ${t.index + 1} pH`,
        onchange: (ev: Event) => {
          const v = (ev.target as HTMLInputElement).value
          this.handlers.onRecordPh(t.index, v === '' ? null : Number(v))
        },
      })
      this.cells.set(`p:${t.index}`, ph)
      tr.append(h('td', null, concl), h('td', null, ph))
      return tr
    })
    this.submitBtn = button('Submit & reveal', { variant: 'primary', block: true, onClick: () => this.handlers.onSubmit() })
    this.notebookBody.replaceChildren(
      h('p', { class: 't-support' }, 'Write down the colour you see for each test, decide what each liquid is, then add its pH. You can change your mind: that is what scientists do.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, head), h('tbody', null, rows))),
      this.submitBtn,
    )
  }

  private colorSelect(label: string, onChange: (v: string) => void): HTMLSelectElement {
    return h(
      'select',
      { class: 'select select-sm', 'aria-label': label, onchange: (ev: Event) => onChange((ev.target as HTMLSelectElement).value) },
      h('option', { value: '' }, '—'),
      ...Object.values(COLOR_WORDS).map((c) => h('option', { value: c.name }, c.name)),
    ) as HTMLSelectElement
  }

  /** Reflect state into the existing controls without rebuilding them (keeps focus while typing). */
  private syncNotebook() {
    const e = this.exp
    const locked = e.phase === 'reveal'
    for (const t of e.tubes) {
      for (const id of e.chosen) {
        const sel = this.cells.get(`c:${t.index}:${id}`) as HTMLSelectElement
        const r = t.results[id]
        sel.disabled = !r || locked
        sel.title = r ? '' : 'Run this test first'
        sel.value = r?.recorded ?? ''
      }
      const concl = this.cells.get(`k:${t.index}`) as HTMLSelectElement
      concl.disabled = Object.keys(t.results).length === 0 || locked
      concl.title = concl.disabled && !locked ? 'Test this tube first' : ''
      concl.value = t.conclusion ?? ''
      const ph = this.cells.get(`p:${t.index}`) as HTMLInputElement
      ph.disabled = !t.results[PH_TOOL] || locked
      ph.title = ph.disabled && !locked ? 'Dip pH paper in this tube first' : ''
      if (document.activeElement !== ph) ph.value = t.recordedPh === null ? '' : String(t.recordedPh)
    }
    if (this.submitBtn) {
      setDisabled(this.submitBtn, !e.canSubmit)
      this.submitBtn.hidden = locked
    }
  }

  /* ---------------- prediction gate ---------------- */
  promptPrediction(req: PredictionRequest): Promise<{ color: string; confidence: Confidence; decisionMs: number } | null> {
    return new Promise((resolve) => {
      const opened = performance.now()
      let color = ''
      let confidence: Confidence | 0 = 0
      let settled = false
      const finish = (v: { color: string; confidence: Confidence; decisionMs: number } | null) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      const d = dialog({
        title: `Tube ${req.tube + 1}: what will you see?`,
        description: req.isPaper
          ? 'Before dipping the pH paper, predict the colour the paper will turn.'
          : `Before adding ${req.toolName}, predict the colour the liquid will turn. You must commit before the test runs.`,
        onClose: () => finish(null),
      })
      const colors = req.isPaper ? PH_PAPER_SCALE.map((s) => s.color) : Object.values(COLOR_WORDS).map((c) => c.name)
      const lock = button('Lock in prediction', { variant: 'primary', disabled: true })
      const refresh = () => setDisabled(lock, !color || !confidence)

      const grid = h('div', { class: 'swatch-grid', role: 'radiogroup', 'aria-label': 'Predicted colour' })
      const paint = () => {
        grid.replaceChildren(
          ...colors.map((name) =>
            h(
              'button',
              { class: 'swatch-btn', type: 'button', role: 'radio', 'aria-checked': String(color === name), onclick: () => { color = name; paint(); refresh() } },
              h('span', { class: `swatch big${name === 'Colorless' ? ' clear' : ''}`, style: name === 'Colorless' ? '' : `background:${cssColor(name)}` }),
              name,
            ),
          ),
        )
      }
      paint()

      const conf = h('div', { class: 'conf-row', role: 'radiogroup', 'aria-label': 'How sure are you?' })
      const paintConf = () => {
        conf.replaceChildren(
          ...CONFIDENCE.map((c) =>
            h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(confidence === c.value), onclick: () => { confidence = c.value; paintConf(); refresh() } }, h('span', { class: 't-label' }, c.label), h('span', { class: 't-support' }, c.hint)),
          ),
        )
      }
      paintConf()

      lock.addEventListener('click', () => {
        if (!color || !confidence) return
        finish({ color, confidence, decisionMs: Math.round(performance.now() - opened) })
        d.close()
      })
      d.body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'Predicted colour'), grid), h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'How sure are you?'), conf), h('div', { class: 'dialog-actions' }, button('Not yet', { variant: 'ghost', onClick: d.close }), lock))
    })
  }

  /* ---------------- reveal ---------------- */
  showReveal(summary: Summary, onExit: () => void, onReview: () => void) {
    const e = this.exp
    const d = dialog({ title: 'The reveal', description: 'Here is what was really in each tube, next to what you concluded.', wide: true, dismissable: false })
    const rows = e.tubes.map((t) => {
      const truth = truthOf(t.solution)
      const ok = t.conclusion === truth
      const phDiff = t.recordedPh === null ? null : Math.abs(t.recordedPh - t.solution.ph)
      const tools = Object.values(t.results)
        .filter((r) => r.tool !== PH_TOOL)
        .map((r) => `${e.indicator(r.tool)!.name}: ${r.actual}${sameColor(r.predicted, r.actual) ? ' ✓' : ''}`)
        .join(' · ')
      return h(
        'tr',
        null,
        h('td', { class: 't-label' }, `#${t.index + 1}`),
        h('td', null, h('div', { class: 't-label' }, t.solution.name), h('div', { class: 't-support t-mono' }, t.solution.formula), h('div', { class: 't-support' }, tools)),
        h('td', null, badge(truth.toUpperCase(), 'info'), ' ', h('span', { class: 't-support' }, `pH ${t.solution.ph}`)),
        h('td', null, badge(t.conclusion ? t.conclusion.toUpperCase() : '—', ok ? 'success' : 'error'), t.conclusionHistory.length > 1 ? h('div', { class: 't-support' }, `changed ${t.conclusionHistory.length - 1}×`) : null),
        h('td', null, t.recordedPh === null ? '—' : badge(`pH ${t.recordedPh}`, phDiff === 0 ? 'success' : phDiff! <= 1 ? 'warning' : 'error')),
      )
    })
    const stat = (n: string | number, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, String(n)), h('div', { class: 't-support' }, l))
    d.body.append(
      h('div', { class: 'stats' }, stat(`${summary.conclusionsCorrect}/${summary.tubes}`, 'tubes identified'), stat(`${summary.phExact}/${summary.tubes}`, 'exact pH'), stat(`${summary.predictionsCorrect}/${summary.predictions}`, 'predictions right'), stat(summary.revisions, 'times you changed your mind')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Tube'), h('th', null, 'What it was'), h('th', null, 'Truth'), h('th', null, 'You said'), h('th', null, 'Your pH'))), h('tbody', null, rows))),
      h('p', { class: 't-support' }, 'Your result is only part of the story: how you predicted, tested and revised your thinking is what your instructor sees.'),
      h('div', { class: 'dialog-actions' }, button('Look at the bench', { variant: 'ghost', onClick: () => { d.close(); onReview() } }), button('Back to experiments', { variant: 'primary', onClick: () => { d.close(); onExit() } })),
    )
  }

  destroy() {
    this.cancelClose()
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
