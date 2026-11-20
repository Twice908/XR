import type { BiologyOption } from '@mmaxr/schema'
import type { Confidence, Group, JourneyExperiment, Stop } from '../state/biology'
import { wordCount } from '../state/biology'
import { h } from '../ui/dom'
import { badge, button, setDisabled } from '../ui/components'
import { VoiceCapture, voiceSupport, type VoiceResult } from './voice'
import { sound } from './sound'

export interface BiologyHudHandlers {
  onBack(): void
  onToggle(group: Group, id: string): void
  onConfidence(c: Confidence): void
  onLock(): void
  onCommit(text: string, inputMode: 'voice' | 'typed', speakMs: number, audio: Blob | null): void
  onRevise(text: string): void
  onContinue(): void
  onScenario(id: string, option: string): void
  onSubmitFinal(): void
  /** The student closed (true) or reopened (false) the question panel to look at the whole model. */
  onView(overview: boolean): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

const CONFIDENCE: { value: Confidence; label: string; hint: string }[] = [
  { value: 1, label: 'Just a guess', hint: 'I am not sure' },
  { value: 2, label: 'Fairly sure', hint: 'I have a reason' },
  { value: 3, label: 'Certain', hint: 'I know this one' },
]

const GROUPS: { key: Group; question: string }[] = [
  { key: 'glands', question: 'Which glands act here?' },
  { key: 'juices', question: 'Which digestive juices?' },
  { key: 'components', question: 'Which enzymes or chemicals are in them?' },
  { key: 'nutrients', question: 'Which nutrients are being worked on?' },
]

export class BiologyHud {
  readonly root: HTMLElement
  private card = h('section', { class: 'bio-card', 'aria-live': 'polite' })
  private stepper = h('ol', { class: 'steps bio-steps', 'aria-label': 'Journey progress' })
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private soundToggle: HTMLButtonElement
  private voice = new VoiceCapture()
  private micNote = h('span', { class: 't-support' })
  private micButton: HTMLButtonElement | null = null
  private textArea: HTMLTextAreaElement | null = null
  private wordLabel: HTMLElement | null = null
  private commitBtn: HTMLButtonElement | null = null
  private recorded: VoiceResult | null = null
  private micFailed = false
  private transcript = ''
  private reviseDraft: string | null = null
  private reviseResult: { keywords: { keyword: string; matched: boolean }[]; coverage: number; revisions: number } | null = null
  private traveling = false
  private busyLabel: string | null = null
  private lastKey = ''
  private watching = false
  private collapsed = false
  private reopen = button('Show question ↑', { variant: 'primary', size: 'sm', onClick: () => this.setCollapsed(false) })
  private timer = h('div', { class: 'bio-timer', role: 'timer', 'aria-live': 'off', hidden: '' })

  constructor(
    private readonly exp: JourneyExperiment,
    private readonly handlers: BiologyHudHandlers,
    title: string,
  ) {
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })
    this.toggles.append(this.soundToggle)
    exp.lesson.checkpoints.forEach((cp, i) => this.stepper.append(h('li', { class: 'step' }, h('span', { class: 'step-n' }, String(i + 1)), h('span', { class: 'step-l' }, cp.organName.split(' (')[0].replace(' & Anus', '').replace(' & Oesophagus', '').replace(' & Gallbladder', '')))))
    this.stepper.append(h('li', { class: 'step' }, h('span', { class: 'step-n' }, '★'), h('span', { class: 'step-l' }, 'What if?')))
    this.root = h(
      'div',
      { class: 'hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, title)), this.stepper, this.toggles),
      this.card,
      h('div', { class: 'bio-reopen', hidden: '' }, this.reopen),
      this.timer,
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
      for (const p of this.extraPanels) if (p !== panel && p.classList.contains('open')) {
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
    const cardH = this.watching || this.collapsed ? 0 : this.card.getBoundingClientRect().height
    const bottom = narrow && open ? open.getBoundingClientRect().height + 8 : cardH + 28
    this.handlers.onLayout({ left: 0, right: 0, top: narrow ? 52 : 56, bottom })
  }

  /* ---------------- state shown on the card ---------------- */
  setTraveling(on: boolean) {
    this.traveling = on
    this.update()
  }
  private setCollapsed(on: boolean) {
    if (this.collapsed === on) return
    this.collapsed = on
    this.handlers.onView(on)
    this.update()
  }

  /** While the enzyme animation plays the lower panel is removed completely. */
  setWatching(on: boolean) {
    this.watching = on
    if (!on) this.setTimer(null)
    this.update()
  }
  /** Mini countdown shown over the animation. */
  setTimer(msLeft: number | null, label = 'Watch the enzymes at work') {
    if (msLeft === null) {
      this.timer.hidden = true
      return
    }
    this.timer.hidden = false
    const s = Math.max(0, Math.ceil(msLeft / 1000))
    this.timer.replaceChildren(h('span', { class: 'bio-timer-n' }, `${s}s`), h('span', { class: 't-label' }, msLeft <= 0 ? 'Finishing…' : label))
  }
  setBusy(label: string | null) {
    this.busyLabel = label
    this.update()
  }
  setReviseResult(r: { keywords: { keyword: string; matched: boolean }[]; coverage: number; revisions: number }) {
    this.reviseResult = r
    this.reviseDraft = null
    this.update()
  }

  update() {
    const e = this.exp
    const stepIndex = e.stage === 'final' || e.stage === 'done' ? e.stops.length : e.index
    ;[...this.stepper.children].forEach((li, i) => {
      li.classList.toggle('done', i < stepIndex || e.stage === 'done')
      li.classList.toggle('current', i === stepIndex && e.stage !== 'done')
    })
    // A new stop or stage starts with a clean slate for the voice and text boxes.
    const key = `${e.index}:${e.stage}:${this.traveling}:${this.busyLabel}:${this.watching}`
    if (key !== this.lastKey) {
      this.lastKey = key
      // Moving on to another stop or stage brings the panel back; the scene flies to the new view itself.
      this.collapsed = false
      if (e.stage === 'predict') {
        this.recorded = null
        this.micFailed = false
        this.transcript = ''
        this.reviseDraft = null
        this.reviseResult = null
      }
      if (e.stage === 'revealed') this.reviseDraft = null
    }
    this.card.replaceChildren(...this.render())
    this.card.hidden = this.watching || this.collapsed
    ;(this.reopen.parentElement as HTMLElement).hidden = !(this.collapsed && !this.watching)
    requestAnimationFrame(this.layout)
  }

  private render(): Node[] {
    const e = this.exp
    if (this.watching || this.collapsed) return []
    if (this.traveling) return [h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'spinner' }), h('span', { class: 't-label' }, 'Following the food to the next stop…'))]
    if (this.busyLabel) return [h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'spinner' }), h('span', { class: 't-label' }, this.busyLabel))]
    switch (e.stage) {
      case 'predict': return this.renderPredict()
      case 'explain': return this.renderExplain()
      case 'revealed': return this.renderRevealed()
      case 'final': return this.renderFinal()
      case 'done': return this.renderDone()
    }
  }

  private head(stop: Stop, sub: string): Node {
    return h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, stop.cp.organName), h('div', { class: 'row', style: 'gap:8px' }, badge(`Stop ${this.exp.n} of ${this.exp.stops.length}`, 'info'), h('button', { class: 'bio-close', type: 'button', 'aria-label': 'Close this panel to see the whole model', title: 'Close and view the whole model', onclick: () => this.setCollapsed(true) }, '✕'))), h('p', { class: 't-support' }, sub))
  }

  /* ---- predict ---- */
  private renderPredict(): Node[] {
    const e = this.exp
    const s = e.stop
    const chips = (group: Group, pool: BiologyOption[]) =>
      h('div', { class: 'chips', role: 'group', 'aria-label': group }, ...pool.map((o) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(s.selection[group].includes(o.id)), onclick: () => this.handlers.onToggle(group, o.id) }, o.label)))
    const conf = h('div', { class: 'conf-row', role: 'radiogroup', 'aria-label': 'How sure are you?' }, ...CONFIDENCE.map((c) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(s.confidence === c.value), onclick: () => this.handlers.onConfidence(c.value) }, h('span', { class: 't-label' }, c.label), h('span', { class: 't-support' }, c.hint))))
    const lock = button('Lock in my prediction', { variant: 'primary', disabled: !e.canLock, onClick: () => this.handlers.onLock() })
    return [
      this.head(s, 'Look at the highlighted organ, then commit to a prediction before you explain.'),
      h('p', { class: 'bio-prompt' }, s.cp.prompt),
      ...GROUPS.map((g) => h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, g.question), chips(g.key, e.optionsFor(g.key)))),
      h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, 'How sure are you?'), conf),
      h('div', { class: 'dialog-actions' }, lock),
    ]
  }

  /* ---- explain ---- */
  private renderExplain(): Node[] {
    const e = this.exp
    const s = e.stop
    const sel = (g: Group) => s.selection[g].map((id) => e.lesson.choices[g].find((o) => o.id === id)?.label ?? id)
    const support = voiceSupport()
    const needsAudio = e.lesson.config.requireAudioExplanation && support.recorder && !this.micFailed
    this.textArea = h('textarea', { class: 'input bio-text', rows: '4', placeholder: support.recognition ? 'Press record and explain aloud. Your words appear here, and you can fix them.' : 'Explain in your own words…', 'aria-label': 'Your explanation', oninput: () => this.onType() }) as HTMLTextAreaElement
    this.textArea.value = this.transcript
    this.wordLabel = h('span', { class: 't-support t-mono' })
    this.micButton = button(this.voice.recording ? '■ Stop' : this.recorded ? '● Record again' : '● Record my explanation', { variant: this.recorded ? 'secondary' : 'primary', onClick: () => void this.toggleMic() })
    this.commitBtn = button('Commit & reveal', { variant: 'primary', onClick: () => this.commit() })
    this.paintCommit(needsAudio)
    this.micNote.textContent = !support.recorder ? 'This browser cannot record. Type your explanation instead.' : this.micFailed ? 'The microphone is not available. Type your explanation instead.' : this.recorded ? `Recorded ${(this.recorded.durationMs / 1000).toFixed(0)}s. You can record again or edit the text.` : needsAudio ? 'Explaining aloud is part of this lab.' : ''
    return [
      this.head(s, 'Your prediction is locked. Now explain why, in your own words.'),
      h('div', { class: 'chips' }, ...[...sel('glands'), ...sel('juices'), ...sel('components'), ...sel('nutrients')].map((l) => h('span', { class: 'chip chip-static' }, l))),
      h('p', { class: 'bio-prompt' }, s.cp.prompt),
      h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' }, this.micButton, this.micNote),
      this.textArea,
      h('div', { class: 'row row-between' }, this.wordLabel, this.commitBtn),
    ]
  }

  private needsAudio() {
    const sup = voiceSupport()
    return this.exp.lesson.config.requireAudioExplanation && sup.recorder && !this.micFailed
  }

  private onType() {
    this.transcript = this.textArea?.value ?? ''
    this.paintCommit(this.needsAudio())
  }

  private paintCommit(needsAudio: boolean) {
    const words = wordCount(this.transcript)
    const min = this.exp.minWords
    if (this.wordLabel) this.wordLabel.textContent = `${words} / ${min} words`
    if (this.commitBtn) {
      const blocked = words < min || (needsAudio && !this.recorded)
      setDisabled(this.commitBtn, blocked)
      this.commitBtn.title = words < min ? `Write at least ${min} words` : needsAudio && !this.recorded ? 'Record your explanation first' : ''
    }
  }

  private async toggleMic() {
    if (this.voice.recording) {
      const r = await this.voice.stop()
      this.recorded = r
      if (r.transcript && wordCount(r.transcript) >= wordCount(this.transcript)) this.transcript = r.transcript
      this.update()
      return
    }
    this.micNote.textContent = 'Listening… speak now.'
    const ok = await this.voice.start(
      (text) => {
        this.transcript = text
        if (this.textArea) this.textArea.value = text
        this.paintCommit(this.needsAudio())
      },
      (msg) => {
        this.micNote.textContent = msg
      },
    )
    if (!ok) {
      this.micFailed = true
      this.update()
      return
    }
    if (this.micButton) this.micButton.textContent = '■ Stop'
  }

  private commit() {
    if (this.commitBtn?.getAttribute('aria-disabled') === 'true') return
    const speakMs = this.recorded?.durationMs ?? 0
    this.handlers.onCommit(this.transcript, this.recorded ? 'voice' : 'typed', speakMs, this.recorded?.blob ?? null)
  }

  /* ---- revealed ---- */
  private renderRevealed(): Node[] {
    const e = this.exp
    const s = e.stop
    const r = s.reveal!
    const row = (g: Group, title: string, answer: BiologyOption[]) => {
      const chosen = new Set(s.selection[g])
      const truth = new Set(answer.map((a) => a.id))
      const items = [
        ...answer.map((a) => h('span', { class: `chip chip-static ${chosen.has(a.id) ? 'ok' : 'miss'}` }, `${chosen.has(a.id) ? '✓' : '+'} ${a.label}`)),
        ...[...chosen].filter((id) => !truth.has(id)).map((id) => h('span', { class: 'chip chip-static wrong' }, `✗ ${e.lesson.choices[g].find((o) => o.id === id)?.label ?? id}`)),
      ]
      return h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 't-label' }, title), h('div', { class: 'chips' }, ...items))
    }
    const kws = this.reviseResult?.keywords ?? r.keywords
    const coverage = this.reviseResult ? Math.max(this.reviseResult.coverage, r.coverage) : r.coverage
    const matched = kws.filter((k) => k.matched).length
    const pct = Math.round(coverage * 100)
    const left = e.maxRevisions - s.revisions
    const reviseBox =
      this.reviseDraft !== null
        ? [
            h('textarea', { class: 'input bio-text', rows: '3', 'aria-label': 'Improve your explanation', oninput: (ev: Event) => (this.reviseDraft = (ev.target as HTMLTextAreaElement).value) }, this.reviseDraft),
            h('div', { class: 'dialog-actions' }, button('Cancel', { variant: 'ghost', onClick: () => { this.reviseDraft = null; this.update() } }), button('Check again', { variant: 'primary', onClick: () => this.handlers.onRevise(this.reviseDraft ?? '') })),
          ]
        : []
    return [
      this.head(s, 'Here is what really happens at this stop.'),
      h('p', { class: 'bio-reveal' }, r.explanation),
      row('glands', 'Glands', r.answer.glands),
      row('juices', 'Juices', r.answer.juices),
      row('components', 'Enzymes & chemicals', r.answer.components),
      row('nutrients', 'Nutrients', r.answer.nutrients),
      h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'row row-between' }, h('span', { class: 't-label' }, 'Key ideas in your explanation'), h('span', { class: 't-label t-mono' }, `${matched} of ${kws.length} · ${pct}%`)), h('div', { class: 'chips' }, ...kws.map((k) => h('span', { class: `chip chip-static ${k.matched ? 'ok' : 'miss'}` }, `${k.matched ? '✓' : '○'} ${k.keyword}`)))),
      ...reviseBox,
      h(
        'div',
        { class: 'dialog-actions' },
        e.canRevise && this.reviseDraft === null ? button(`Improve my explanation (${left} left)`, { variant: 'secondary', onClick: () => { this.reviseDraft = s.explanation; this.update() } }) : null,
        button(e.isLastStop ? 'Finish: the “what if?” challenge →' : 'Next stop →', { variant: 'primary', onClick: () => this.handlers.onContinue() }),
      ),
    ]
  }

  /* ---- final ---- */
  private renderFinal(): Node[] {
    const e = this.exp
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, 'What if…?'), badge('Final challenge', 'info')), h('p', { class: 't-support' }, 'Use what you learned on the journey to work out what would happen.')),
      ...e.lesson.transfer.scenarios.map((sc) =>
        h(
          'div',
          { class: 'stack', style: 'gap:6px' },
          h('p', { class: 'bio-prompt' }, sc.question),
          h('div', { class: 'opt-list', role: 'radiogroup', 'aria-label': sc.question }, ...e.scenarioOptions(sc.id).map((o) => h('button', { class: 'conf-btn', type: 'button', role: 'radio', 'aria-checked': String(e.scenarioAnswers[sc.id] === o.id), onclick: () => this.handlers.onScenario(sc.id, o.id) }, h('span', { class: 't-label' }, o.label)))),
        ),
      ),
      h('div', { class: 'dialog-actions' }, button('Submit my answers', { variant: 'primary', disabled: !e.canSubmitFinal, onClick: () => this.handlers.onSubmitFinal() })),
    ]
  }

  /* ---- done ---- */
  private renderDone(): Node[] {
    const e = this.exp
    const sum = e.summary()
    const fin = e.finalResult!
    const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, n), h('div', { class: 't-support' }, l))
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('h2', { class: 't-title' }, 'Journey complete'), h('p', { class: 't-support' }, 'You followed a meal from mouth to exit. Here is how your thinking went.')),
      h('div', { class: 'stats' }, stat(`${sum.selectionsRight}/${sum.stops}`, 'stops predicted fully right'), stat(`${Math.round(sum.avgCoverage * 100)}%`, 'key ideas in your first explanations'), stat(String(sum.revisions), 'times you improved an explanation'), stat(`${fin.correct}/${fin.total}`, '“what if?” answers right')),
      ...fin.results.map((r, i) => {
        const sc = e.lesson.transfer.scenarios[i]
        return h('div', { class: 'stack', style: 'gap:2px' }, h('div', { class: 'row', style: 'gap:8px' }, badge(r.correct ? 'Right' : 'Not quite', r.correct ? 'success' : 'warning'), h('span', { class: 't-label' }, sc.question)), h('span', { class: 't-support' }, r.explanation))
      }),
      h('div', { class: 'dialog-actions' }, button('Back to experiments', { variant: 'primary', onClick: () => this.handlers.onBack() })),
    ]
  }

  destroy() {
    this.voice.cancel()
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
