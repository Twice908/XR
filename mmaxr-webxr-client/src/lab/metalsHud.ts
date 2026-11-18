import type { MaterialKind, MetalsTool } from '@mmaxr/schema'
import type { MetalsExperiment, Summary, Confidence } from '../state/metals'
import { METALLIC } from '../state/metals'
import { h } from '../ui/dom'
import { badge, button, dialog, setDisabled } from '../ui/components'
import { sound } from './sound'

export interface MetalsHudHandlers {
  onBack(): void
  onSelectTool(id: string): void
  onSampleOpen(index: number): void
  onRecord(sample: number, tool: string, value: string): void
  onRecordLitmus(sample: number, value: string): void
  onConclusion(sample: number, kind: MaterialKind | ''): void
  onSubmit(): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]

const LITMUS_OPTIONS = [
  { value: 'blue_basic', label: 'Turns blue (basic)' },
  { value: 'red_acidic', label: 'Turns red (acidic)' },
  { value: 'no_change', label: 'No change' },
  { value: 'none', label: 'No oxide formed' },
]

const STEPS = ['First impressions', 'Investigate', 'Reveal']

const KIND_LABEL: Record<MaterialKind, string> = { metal: 'Metal', 'non-metal': 'Non-metal' }

export class MetalsHud {
  readonly root: HTMLElement
  private steps: HTMLElement[] = []
  private toolsBody = h('div', { class: 'stack' })
  private notebookBody = h('div', { class: 'stack' })
  private hintText = h('span', { class: 'hint-text' })
  private hintAction: HTMLButtonElement
  private toolsPanel: HTMLElement
  private notebookPanel: HTMLElement
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private notebookToggle: HTMLButtonElement
  private soundToggle: HTMLButtonElement
  private cells = new Map<string, HTMLSelectElement>()
  private submitBtn: HTMLButtonElement | null = null
  private built = false
  private hintRun: (() => void) | null = null
  private closeTimer: number | null = null

  constructor(
    private readonly exp: MetalsExperiment,
    private readonly handlers: MetalsHudHandlers,
    title: string,
  ) {
    this.hintAction = button('Run', { variant: 'primary', onClick: () => this.hintRun?.() })
    this.hintAction.hidden = true
    this.notebookToggle = button('Notebook', { size: 'sm', onClick: () => this.setPanel(this.notebookPanel, !this.notebookPanel.classList.contains('open')) })
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })

    this.toolsPanel = h(
      'aside',
      { class: 'panel panel-left', 'aria-label': 'Tests' },
      h('div', { class: 'panel-head' }, h('h2', { class: 't-heading' }, 'Your tests'), h('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close tests', onclick: () => this.setPanel(this.toolsPanel, false) }, '×')),
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
    this.toggles.append(h('span', { class: 'only-mobile' }, button('Tests', { size: 'sm', onClick: () => this.setPanel(this.toolsPanel, !this.toolsPanel.classList.contains('open')) })), this.soundToggle, this.notebookToggle)

    this.root = h(
      'div',
      { class: 'hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)), stepper, this.toggles),
      this.toolsPanel,
      this.notebookPanel,
      h('div', { class: 'hint-bar', role: 'status', 'aria-live': 'polite' }, this.hintText, this.hintAction),
    )
    window.addEventListener('resize', this.layout)
    this.update()
  }

  private toggleSound() {
    sound.setMuted(!sound.muted)
    this.soundToggle.textContent = sound.muted ? 'Sound off' : 'Sound on'
    if (!sound.muted) sound.click()
  }

  /* ---------------- panels (same behaviour as the indicators lab) ---------------- */
  private isNarrow = () => window.innerWidth <= 1000

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
    if (this.isNarrow() && open) {
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
  private cancelClose() {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer)
    this.closeTimer = null
  }
  closeNotebookSoon(ms = 650) {
    this.cancelClose()
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null
      this.setPanel(this.notebookPanel, false)
    }, ms)
  }

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

  hint(text: string, action?: { label: string; run: () => void } | null) {
    this.hintText.textContent = text
    this.hintAction.hidden = !action
    this.hintRun = action?.run ?? null
    if (action) this.hintAction.textContent = action.label
    requestAnimationFrame(this.layout)
  }

  /* ---------------- refresh ---------------- */
  update() {
    const e = this.exp
    const step = e.phase === 'hypothesis' ? 0 : e.phase === 'testing' ? 1 : 2
    this.steps.forEach((s, i) => {
      s.classList.toggle('done', i < step)
      s.classList.toggle('current', i === step)
    })
    this.renderTools()
    this.renderNotebook()
    requestAnimationFrame(this.layout)
  }

  private renderTools() {
    const e = this.exp
    const body = this.toolsBody
    body.replaceChildren()

    if (e.phase === 'hypothesis') {
      const done = e.samples.filter((s) => s.hypothesis).length
      body.append(
        h('p', { class: 't-support' }, 'Look closely at each sample on the bench, then click it and give your first impression: metal or non-metal? You will test it properly afterwards.'),
        h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Samples'), badge(`${done} / ${e.samples.length}`, done === e.samples.length ? 'success' : 'neutral')),
      )
      const list = h('div', { class: 'tool-list' })
      for (const s of e.samples) {
        list.append(
          h(
            'button',
            { class: `tool${s.hypothesis ? ' selected' : ''}`, type: 'button', onclick: () => this.handlers.onSampleOpen(s.index) },
            h('span', { class: 'tool-check' }, s.hypothesis ? '✓' : String(s.index + 1)),
            h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, `Sample ${s.index + 1}`), h('span', { class: 't-support' }, s.hypothesis ? `${KIND_LABEL[s.hypothesis]} · ${confWord(s.hypothesisConfidence)}` : `${s.look.color}, ${s.look.lustre}, ${s.look.state}`)),
          ),
        )
      }
      body.append(list)
      return
    }

    const pct = Math.min(100, (e.used / e.budget) * 100)
    body.append(
      h(
        'div',
        { class: 'budget' },
        h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Test budget'), h('span', { class: 't-label t-mono' }, `${e.remaining} left`)),
        h('div', { class: 'budget-bar', role: 'progressbar', 'aria-valuenow': String(e.used), 'aria-valuemax': String(e.budget), 'aria-label': 'Tests used' }, h('div', { class: `budget-fill${e.remaining <= 3 ? ' low' : ''}`, style: `width:${pct}%` })),
        h('span', { class: 't-support' }, `Each test costs one run. Back every conclusion with at least ${e.minTests} tests.`),
      ),
    )
    const groups: ('Physical' | 'Chemical')[] = ['Physical', 'Chemical']
    for (const g of groups) {
      body.append(h('span', { class: 't-label', style: 'opacity:.7;margin-top:4px' }, `${g} properties`))
      const list = h('div', { class: 'tool-list' })
      for (const t of e.lesson.tools.filter((x) => x.group === g)) list.append(this.toolRow(t))
      body.append(list)
    }
  }

  private toolRow(t: MetalsTool) {
    const e = this.exp
    const active = e.activeTool === t.id && e.phase === 'testing'
    const done = e.samples.filter((s) => s.results[t.id]).length
    const locked = e.phase !== 'testing' || !!e.pending
    return h(
      'button',
      { class: `tool${active ? ' selected' : ''}`, type: 'button', 'aria-pressed': String(active), 'aria-disabled': locked ? 'true' : null, onclick: () => !locked && this.handlers.onSelectTool(t.id) },
      h('span', { class: 'tool-check' }, active ? '●' : ''),
      h('span', { class: 'tool-text' }, h('span', { class: 't-label' }, t.name), h('span', { class: 't-support' }, `${t.property} · ${done}/${e.samples.length} samples`)),
    )
  }

  /* ---------------- notebook ---------------- */
  private renderNotebook() {
    const e = this.exp
    if (!this.built) {
      this.build()
      this.built = true
    }
    const locked = e.phase === 'reveal'
    for (const s of e.samples) {
      for (const t of e.lesson.tools) {
        const sel = this.cells.get(`r:${s.index}:${t.id}`)!
        const r = s.results[t.id]
        sel.disabled = !r || locked
        sel.title = r ? '' : 'Run this test first'
        sel.value = r?.recorded ?? ''
      }
      const lit = this.cells.get(`l:${s.index}`)!
      const ox = s.results.oxygen
      lit.disabled = !ox || locked
      lit.title = ox ? '' : 'Burn it in air first'
      lit.value = ox?.recordedLitmus ?? ''
      const k = this.cells.get(`k:${s.index}`)!
      k.disabled = e.phase !== 'testing'
      k.title = e.phase === 'hypothesis' ? 'Give every sample a first impression first' : ''
      k.value = s.conclusion ?? ''
    }
    if (this.submitBtn) {
      setDisabled(this.submitBtn, !e.canSubmit)
      this.submitBtn.hidden = locked
      this.submitBtn.title = e.submitBlocker ?? ''
    }
  }

  private build() {
    const e = this.exp
    const head = h('tr', null, h('th', null, '#'), h('th', null, 'Looks'), ...e.lesson.tools.map((t) => h('th', { title: t.name }, t.property)), h('th', null, 'Oxide + litmus'), h('th', null, 'Metal or non-metal?'))
    const rows = e.samples.map((s) => {
      const tr = h('tr', null, h('td', { class: 't-label' }, `#${s.index + 1}`), h('td', { class: 't-support', style: 'white-space:nowrap' }, `${s.look.color}, ${s.look.lustre}`))
      for (const t of e.lesson.tools) {
        const sel = this.select(`Sample ${s.index + 1}, ${t.property}`, t.outcomes.map((o) => ({ value: o.id, label: o.label })), (v) => this.handlers.onRecord(s.index, t.id, v))
        this.cells.set(`r:${s.index}:${t.id}`, sel)
        tr.append(h('td', null, sel))
      }
      const lit = this.select(`Sample ${s.index + 1}, oxide and litmus`, LITMUS_OPTIONS, (v) => this.handlers.onRecordLitmus(s.index, v))
      this.cells.set(`l:${s.index}`, lit)
      const k = this.select(`Sample ${s.index + 1} conclusion`, [{ value: 'metal', label: 'Metal' }, { value: 'non-metal', label: 'Non-metal' }], (v) => this.handlers.onConclusion(s.index, v as MaterialKind | ''))
      this.cells.set(`k:${s.index}`, k)
      tr.append(h('td', null, lit), h('td', null, k))
      return tr
    })
    this.submitBtn = button('Submit & reveal', { variant: 'primary', block: true, onClick: () => this.handlers.onSubmit() })
    this.notebookBody.replaceChildren(
      h('p', { class: 't-support' }, 'Write down what you see for each test, then decide what each sample is. You can change your mind: that is what scientists do.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table metals-table' }, h('thead', null, head), h('tbody', null, rows))),
      this.submitBtn,
    )
  }

  private select(label: string, options: { value: string; label: string }[], onChange: (v: string) => void): HTMLSelectElement {
    return h('select', { class: 'select select-sm', 'aria-label': label, onchange: (ev: Event) => onChange((ev.target as HTMLSelectElement).value) }, h('option', { value: '' }, '—'), ...options.map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement
  }

  /* ---------------- dialogs ---------------- */
  private confidenceRow(get: () => Confidence | 0, set: (c: Confidence) => void, refresh: () => void) {
    const row = h('div', { class: 'conf-row', role: 'radiogroup', 'aria-label': 'How sure are you?' })
    const paint = () =>
      row.replaceChildren(...CONFIDENCE.map((c) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(get() === c.value), onclick: () => { set(c.value); paint(); refresh() } }, h('span', { class: 't-label' }, c.label), h('span', { class: 't-support' }, c.hint))))
    paint()
    return row
  }

  promptHypothesis(i: number): Promise<{ kind: MaterialKind; confidence: Confidence } | null> {
    const s = this.exp.samples[i]
    return new Promise((resolve) => {
      let kind: MaterialKind | '' = s.hypothesis ?? ''
      let conf: Confidence | 0 = s.hypothesisConfidence ?? 0
      let settled = false
      const finish = (v: { kind: MaterialKind; confidence: Confidence } | null) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      const d = dialog({ title: `Sample ${i + 1}: first impression`, description: `It is ${s.look.color}, ${s.look.lustre}, ${s.look.state}. From how it looks, what do you think it is?`, onClose: () => finish(null) })
      const lock = button('Save impression', { variant: 'primary', disabled: !kind || !conf })
      const refresh = () => setDisabled(lock, !kind || !conf)
      const opts = h('div', { class: 'opt-list', role: 'radiogroup', 'aria-label': 'Metal or non-metal' })
      const paint = () =>
        opts.replaceChildren(...(['metal', 'non-metal'] as MaterialKind[]).map((k) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(kind === k), onclick: () => { kind = k; paint(); refresh() } }, h('span', { class: 't-label' }, KIND_LABEL[k]))))
      paint()
      lock.addEventListener('click', () => {
        if (!kind || !conf) return
        finish({ kind, confidence: conf })
        d.close()
      })
      d.body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'Your call'), opts), h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'How sure are you?'), this.confidenceRow(() => conf, (c) => (conf = c), refresh)), h('div', { class: 'dialog-actions' }, button('Not yet', { variant: 'ghost', onClick: d.close }), lock))
    })
  }

  promptPrediction(req: { sample: number; tool: MetalsTool }): Promise<{ outcome: string; confidence: Confidence; decisionMs: number } | null> {
    return new Promise((resolve) => {
      const opened = performance.now()
      let outcome = ''
      let conf: Confidence | 0 = 0
      let settled = false
      const finish = (v: { outcome: string; confidence: Confidence; decisionMs: number } | null) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      const d = dialog({ title: `Sample ${req.sample + 1} · ${req.tool.name}`, description: `${req.tool.question} Predict before the test runs: you must commit first.`, onClose: () => finish(null) })
      const lock = button('Lock in prediction', { variant: 'primary', disabled: true })
      const refresh = () => setDisabled(lock, !outcome || !conf)
      const opts = h('div', { class: 'opt-list', role: 'radiogroup', 'aria-label': 'Predicted outcome' })
      const paint = () =>
        opts.replaceChildren(...req.tool.outcomes.map((o) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(outcome === o.id), onclick: () => { outcome = o.id; paint(); refresh() } }, h('span', { class: 't-label' }, o.label))))
      paint()
      lock.addEventListener('click', () => {
        if (!outcome || !conf) return
        finish({ outcome, confidence: conf, decisionMs: Math.round(performance.now() - opened) })
        d.close()
      })
      d.body.append(h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'What will happen?'), opts), h('div', { class: 'stack', style: 'gap:8px' }, h('span', { class: 't-label' }, 'How sure are you?'), this.confidenceRow(() => conf, (c) => (conf = c), refresh)), h('div', { class: 'dialog-actions' }, button('Not yet', { variant: 'ghost', onClick: d.close }), lock))
    })
  }

  showReveal(summary: Summary, onExit: () => void, onReview: () => void) {
    const e = this.exp
    const d = dialog({ title: 'The reveal', description: 'Here is what each sample really was, and why it behaved the way it did.', wide: true, dismissable: false })
    const evidence = (i: number) => {
      const s = e.samples[i]
      const votes = e.lesson.tools.filter((t) => s.results[t.id] && METALLIC[t.id]).map((t) => (METALLIC[t.id].includes(s.results[t.id].actual) ? 1 : 0))
      return votes.length ? `${votes.reduce((a: number, b: number) => a + b, 0)} of ${votes.length} tests looked metallic` : 'no tests'
    }
    const rows = e.samples.map((s) => {
      const t = s.truth!
      const ok = s.conclusion === t.type
      return h(
        'tr',
        null,
        h('td', { class: 't-label' }, `#${s.index + 1}`),
        h('td', null, h('div', { class: 't-label' }, t.name), h('div', { class: 't-support t-mono' }, t.formula), t.anomaly ? badge('Exception', 'warning') : null),
        h('td', null, badge(KIND_LABEL[t.type].toUpperCase(), 'info')),
        h('td', null, badge(s.conclusion ? KIND_LABEL[s.conclusion].toUpperCase() : '—', ok ? 'success' : 'error'), s.conclusionHistory.length > 1 ? h('div', { class: 't-support' }, `changed ${s.conclusionHistory.length - 1}×`) : null, h('div', { class: 't-support' }, evidence(s.index))),
        h('td', { class: 't-support', style: 'max-width:320px' }, t.why),
      )
    })
    const stat = (n: string | number, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, String(n)), h('div', { class: 't-support' }, l))
    d.body.append(
      h('div', { class: 'stats' }, stat(`${summary.correct}/${summary.samples}`, 'samples identified'), stat(`${summary.exceptionsCaught}/${summary.exceptions}`, 'exceptions caught'), stat(`${summary.predictionsCorrect}/${summary.predictions}`, 'predictions right'), stat(`${summary.testsUsed}/${summary.budget}`, 'tests used')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'What it was'), h('th', null, 'Truth'), h('th', null, 'You said'), h('th', null, 'Why'))), h('tbody', null, rows))),
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

function confWord(c: Confidence | null): string {
  return c === 3 ? 'certain' : c === 2 ? 'fairly sure' : 'a guess'
}
