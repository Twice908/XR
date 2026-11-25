import type { JourneyExperiment, Stop } from '../state/biology'
import { wordCount } from '../state/biology'
import { h } from '../ui/dom'
import { badge, button, setDisabled } from '../ui/components'
import { VoiceCapture, voiceSupport, type VoiceResult } from './voice'
import { sound } from './sound'

export interface BiologyHudHandlers {
  onBack(): void
  /** Play this stop's animation. */
  onWatch(): void
  onContinue(): void
  onPick(optionId: string): void
  onCheck(): void
  onNextQuestion(): void
  onSubmitFinal(audio: Blob | null): void
  /** The student closed (true) or reopened (false) the panel to look at the whole model. */
  onView(overview: boolean): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

export class BiologyHud {
  readonly root: HTMLElement
  private card = h('section', { class: 'bio-card', 'aria-live': 'polite' })
  private stepper = h('ol', { class: 'steps bio-steps', 'aria-label': 'Journey progress' })
  private toggles = h('div', { class: 'row hud-toggles' })
  private extraPanels: HTMLElement[] = []
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private soundToggle: HTMLButtonElement
  private voice = new VoiceCapture()
  private micFailed = false
  private traveling = false
  private busyLabel: string | null = null
  private lastKey = ''
  private watching = false
  private finalRecorded: VoiceResult | null = null
  private finalMicNote = h('span', { class: 't-support' })
  private finalMicBtn: HTMLButtonElement | null = null
  private finalSubmit: HTMLButtonElement | null = null
  private finalWords: HTMLElement | null = null
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
    this.stepper.append(h('li', { class: 'step' }, h('span', { class: 'step-n' }, '?'), h('span', { class: 'step-l' }, 'Quiz')), h('li', { class: 'step' }, h('span', { class: 'step-n' }, '★'), h('span', { class: 'step-l' }, 'Explain')))
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
  update() {
    const e = this.exp
    const stepIndex = e.stage === 'done' ? e.stops.length + 2 : e.stage === 'final' ? e.stops.length + 1 : e.stage === 'quiz' ? e.stops.length : e.index
    ;[...this.stepper.children].forEach((li, i) => {
      li.classList.toggle('done', i < stepIndex || e.stage === 'done')
      li.classList.toggle('current', i === stepIndex && e.stage !== 'done')
    })
    // A new stop or stage starts with a clean slate for the voice and text boxes.
    const key = `${e.index}:${e.stage}:${e.quizIndex}:${this.traveling}:${this.busyLabel}:${this.watching}`
    if (key !== this.lastKey) {
      this.lastKey = key
      // Moving on to another stop or question brings the panel back; the scene flies to the new view itself.
      this.collapsed = false
      if (e.stage === 'tour') this.finalRecorded = null
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
      case 'tour': return this.renderTour()
      case 'quiz': return this.renderQuiz()
      case 'final': return this.renderFinal()
      case 'done': return this.renderDone()
    }
  }

  private head(title: string, sub: string, tag: string): Node {
    return h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, title), h('div', { class: 'row', style: 'gap:8px' }, badge(tag, 'info'), h('button', { class: 'bio-close', type: 'button', 'aria-label': 'Close this panel to see the whole model', title: 'Close and view the whole model', onclick: () => this.setCollapsed(true) }, '✕'))), h('p', { class: 't-support' }, sub))
  }

  /* ---- tour: read, watch, move on ---- */
  private renderTour(): Node[] {
    const e = this.exp
    const s: Stop = e.stop
    return [
      this.head(s.cp.organName, 'Look at the highlighted organ, read what happens here, then watch it in action.', `Stop ${e.n} of ${e.stops.length}`),
      h('p', { class: 'bio-reveal' }, s.cp.explanation),
      ...(s.cp.animLabels.length ? [h('div', { class: 'chips' }, ...s.cp.animLabels.map((l) => h('span', { class: 'chip chip-static' }, l)))] : []),
      h(
        'div',
        { class: 'dialog-actions' },
        button(s.watched ? '▶ Watch it again' : '▶ Watch it in action', { variant: s.watched ? 'secondary' : 'primary', onClick: () => this.handlers.onWatch() }),
        button(e.isLastStop ? 'Finish the tour: quick quiz →' : 'Next stop →', { variant: s.watched ? 'primary' : 'secondary', onClick: () => this.handlers.onContinue() }),
      ),
    ]
  }

  /* ---- quiz: one question at a time, at most four options ---- */
  private renderQuiz(): Node[] {
    const e = this.exp
    const q = e.question
    if (!q) return [h('p', { class: 't-support' }, 'No questions to show.')]
    const f = e.feedback[q.id]
    const options = h(
      'div',
      { class: 'opt-list', role: 'radiogroup', 'aria-label': q.prompt },
      ...q.options.map((o) => {
        const state = f ? (o.id === f.answer ? ' ok' : o.id === f.yourAnswer ? ' wrong' : '') : ''
        return h('button', { class: `conf-btn${state}`, type: 'button', role: 'radio', disabled: !!f, 'aria-checked': String(f ? o.id === f.yourAnswer : e.picked === o.id), onclick: () => this.handlers.onPick(o.id) }, h('span', { class: 't-label' }, `${f && o.id === f.answer ? '✓ ' : f && o.id === f.yourAnswer ? '✗ ' : ''}${o.label}`))
      }),
    )
    return [
      this.head('Quick quiz', `About the ${q.organ.split(' (')[0]}.`, `Question ${e.quizIndex + 1} of ${e.questions.length}`),
      h('p', { class: 'bio-prompt' }, q.prompt),
      options,
      ...(f ? [h('p', { class: 'bio-reveal' }, `${f.correct ? 'Right. ' : 'Not quite. '}${f.explanation}`)] : []),
      h('div', { class: 'dialog-actions' }, f ? button(e.isLastQuestion ? 'Explain the whole journey →' : 'Next question →', { variant: 'primary', onClick: () => this.handlers.onNextQuestion() }) : button('Check my answer', { variant: 'primary', disabled: !e.canCheck, onClick: () => this.handlers.onCheck() })),
    ]
  }

  /* ---- final ---- */
  private renderFinal(): Node[] {
    const e = this.exp
    const fe = e.lesson.finalExplain
    const support = voiceSupport()
    const paintSubmit = () => {
      const words = wordCount(e.finalText)
      if (this.finalWords && fe) this.finalWords.textContent = `${words} / ${fe.minWords} words`
      if (this.finalSubmit) {
        const needAudio = !!fe && e.lesson.config.requireAudioExplanation && support.recorder && !this.finalRecorded && !this.micFailed
        setDisabled(this.finalSubmit, !e.canSubmitFinal || needAudio)
        this.finalSubmit.title = needAudio ? 'Record your explanation first' : ''
      }
    }
    this.finalSubmit = button('Submit my explanation', { variant: 'primary', onClick: () => { if (this.finalSubmit?.getAttribute('aria-disabled') !== 'true') this.handlers.onSubmitFinal(this.finalRecorded?.blob ?? null) } })
    const explain: Node[] = []
    if (fe) {
      const area = h('textarea', { class: 'input bio-text', rows: '5', placeholder: support.recognition ? 'Press record and explain aloud. Your words appear here, and you can fix them.' : 'Explain in your own words…', 'aria-label': 'Your explanation of the whole pathway', oninput: (ev: Event) => { e.finalText = (ev.target as HTMLTextAreaElement).value; paintSubmit() } }) as HTMLTextAreaElement
      area.value = e.finalText
      this.finalWords = h('span', { class: 't-support t-mono' })
      this.finalMicBtn = button(this.voice.recording ? '■ Stop' : this.finalRecorded ? '● Record again' : '● Record my explanation', { variant: this.finalRecorded ? 'secondary' : 'primary', onClick: () => void this.toggleFinalMic(area, paintSubmit) })
      this.finalMicNote.textContent = !support.recorder ? 'This browser cannot record. Type your explanation instead.' : this.micFailed ? 'The microphone is not available. Type your explanation instead.' : this.finalRecorded ? `Recorded ${(this.finalRecorded.durationMs / 1000).toFixed(0)}s. You can record again or edit the text.` : 'Explaining aloud is part of this lab.'
      explain.push(h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, 'Explain the whole pathway'), h('p', { class: 'bio-prompt' }, fe.prompt), h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' }, this.finalMicBtn, this.finalMicNote), area, this.finalWords))
    }
    queueMicrotask(paintSubmit)
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, 'Explain the journey'), badge('Last step', 'info')), h('p', { class: 't-support' }, 'Put the whole journey into your own words. Speaking it aloud is the best way to find what you still need to learn.')),
      ...explain,
      h('div', { class: 'dialog-actions' }, this.finalSubmit),
    ]
  }

  private async toggleFinalMic(area: HTMLTextAreaElement, paint: () => void) {
    const e = this.exp
    if (this.voice.recording) {
      const r = await this.voice.stop()
      this.finalRecorded = r
      e.finalSpeakMs = r.durationMs
      e.finalMode = 'voice'
      if (r.transcript && wordCount(r.transcript) >= wordCount(e.finalText)) e.finalText = r.transcript
      this.update()
      return
    }
    this.finalMicNote.textContent = 'Listening… speak now.'
    const ok = await this.voice.start(
      (text) => {
        e.finalText = text
        area.value = text
        paint()
      },
      (msg) => {
        this.finalMicNote.textContent = msg
      },
    )
    if (!ok) {
      this.micFailed = true
      this.update()
      return
    }
    if (this.finalMicBtn) this.finalMicBtn.textContent = '■ Stop'
  }

  /* ---- done ---- */
  private renderDone(): Node[] {
    const e = this.exp
    const sum = e.summary()
    const fin = e.finalResult!
    const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, n), h('div', { class: 't-support' }, l))
    return [
      h('div', { class: 'stack', style: 'gap:4px' }, h('h2', { class: 't-title' }, 'Journey complete'), h('p', { class: 't-support' }, e.lesson.type === 'biology_respiratory_system' ? 'You followed one breath from the nose into your cells.' : 'You followed a meal from mouth to exit.')),
      h('div', { class: 'stats' }, stat(`${sum.watched}/${sum.stops}`, 'stops watched'), stat(`${sum.quizCorrect}/${sum.quizTotal}`, 'quiz questions right'), ...(fin.explain ? [stat(`${Math.round(fin.explain.coverage * 100)}%`, 'key ideas in your explanation')] : [])),
      ...(fin.explain ? [h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 't-label' }, 'Key ideas in your explanation'), h('div', { class: 'chips' }, ...fin.explain.keywords.map((k) => h('span', { class: `chip chip-static ${k.matched ? 'ok' : 'miss'}` }, `${k.matched ? '✓' : '○'} ${k.keyword}`))), h('p', { class: 'bio-reveal' }, fin.explain.modelAnswer))] : []),
      h('div', { class: 'dialog-actions' }, button('Back to experiments', { variant: 'primary', onClick: () => this.handlers.onBack() })),
    ]
  }

  destroy() {
    this.voice.cancel()
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
