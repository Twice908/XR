import type { MissionsRun } from '../state/missions'
import { h } from '../ui/dom'
import { badge, button } from '../ui/components'
import { sound } from './sound'

export interface MissionsHudHandlers {
  onBack(): void
  onStart(): void
  onHint(): void
  onCheck(): void
  onPick(optionId: string): void
  onAnswer(): void
  onNext(): void
  onSoundChange(muted: boolean): void
  onLayout(insets: { left: number; right: number; top: number; bottom: number }): void
}

/**
 * The XR-styled panel for a mission lab (MMAXR's flow): a step per mission along the top, the narration caption,
 * and one card at the bottom that is the welcome, the current mission with its bench controls, a checkpoint
 * question, or the summary. The lab supplies its own bench controls and readout.
 */
export class MissionsHud {
  readonly root: HTMLElement
  private card = h('section', { class: 'bio-card ml-card', 'aria-live': 'polite' })
  private stepper = h('ol', { class: 'steps', 'aria-label': 'Missions' })
  private soundToggle: HTMLButtonElement
  private toggles: HTMLElement
  private panelListeners = new Map<HTMLElement, (open: boolean) => void>()
  private busyLabel: string | null = null

  constructor(
    private readonly run: MissionsRun,
    private readonly handlers: MissionsHudHandlers,
    /** The lab's bench controls (buttons that change the build), shown on the mission card. */
    private readonly controls: HTMLElement,
    /** The lab's live readout of the build (element, charge, shells...). */
    private readonly readout: HTMLElement,
    /** Where the narration captions show. */
    private readonly caption: HTMLElement,
  ) {
    this.soundToggle = button(sound.muted ? 'Sound off' : 'Sound on', { size: 'sm', variant: 'ghost', onClick: () => this.toggleSound() })
    this.toggles = h('div', { class: 'row hud-toggles' }, this.soundToggle)
    run.lesson.missions.forEach((m, i) => this.stepper.append(h('li', { class: 'step' }, h('span', { class: 'step-n' }, String(i + 1)), h('span', { class: 'step-l' }, m.title))))
    this.stepper.append(h('li', { class: 'step' }, h('span', { class: 'step-n' }, '★'), h('span', { class: 'step-l' }, 'Done')))
    this.root = h(
      'div',
      { class: 'hud ml-hud' },
      h('header', { class: 'hud-top' }, h('div', { class: 'row' }, button('← Back', { variant: 'ghost', size: 'sm', onClick: () => handlers.onBack() }), h('h1', { class: 't-label hud-title' }, run.lesson.title)), this.stepper, this.toggles),
      this.readout,
      this.caption,
      this.card,
    )
    window.addEventListener('resize', this.layout)
    this.update()
  }

  /** A side panel (the coach): its toggle sits beside the sound switch. Same shape as the other labs' HUDs. */
  attachPanel(panel: HTMLElement, toggle: HTMLElement, onOpenChange: (open: boolean) => void, overlay?: HTMLElement) {
    this.panelListeners.set(panel, onOpenChange)
    this.toggles.insertBefore(toggle, this.soundToggle)
    this.root.appendChild(panel)
    if (overlay) this.root.appendChild(overlay)
  }

  setPanelOpen(panel: HTMLElement, open: boolean) {
    panel.classList.toggle('open', open)
    this.panelListeners.get(panel)?.(open)
  }

  private toggleSound() {
    sound.setMuted(!sound.muted)
    this.soundToggle.textContent = sound.muted ? 'Sound off' : 'Sound on'
    this.handlers.onSoundChange(sound.muted)
    if (!sound.muted) sound.click()
  }

  layout = () => {
    const narrow = window.innerWidth <= 1000
    const cardH = this.card.getBoundingClientRect().height
    this.root.style.setProperty('--ml-card-h', `${cardH}px`)
    // Wide screens keep the readout on the right; below 1340px it is a line under the top bar.
    const side = window.innerWidth > 1340 && !this.readout.hidden
    this.handlers.onLayout({ left: 0, right: side ? this.readout.getBoundingClientRect().width + 24 : 0, top: narrow ? 52 : side ? 56 : 104, bottom: cardH + 28 })
  }

  setBusy(label: string | null) {
    this.busyLabel = label
    this.update()
  }

  update() {
    const r = this.run
    const at = r.phase === 'done' ? r.lesson.missions.length + 1 : r.missionIndex
    ;[...this.stepper.children].forEach((li, i) => {
      li.classList.toggle('done', i < at || r.phase === 'done')
      li.classList.toggle('current', i === at && r.phase !== 'done')
    })
    this.readout.hidden = r.phase === 'intro' || r.phase === 'done'
    this.card.replaceChildren(...this.render())
    requestAnimationFrame(this.layout)
  }

  private render(): Node[] {
    if (this.busyLabel) return [h('div', { class: 'row', style: 'gap:12px' }, h('span', { class: 'spinner' }), h('span', { class: 't-label' }, this.busyLabel))]
    switch (this.run.phase) {
      case 'intro': return this.renderIntro()
      case 'build': return this.renderBuild()
      case 'questions': return this.renderQuestion()
      case 'done': return this.renderDone()
    }
  }

  private head(eyebrow: string, title: string, tag?: string): Node {
    return h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 't-label ml-eyebrow' }, eyebrow), h('div', { class: 'row row-between' }, h('h2', { class: 't-title' }, title), tag ? badge(tag, 'info') : null))
  }

  private renderIntro(): Node[] {
    const r = this.run
    return [
      this.head(r.lesson.subject?.toUpperCase() ?? 'LAB', r.lesson.title, `${r.lesson.missions.length} missions`),
      h('p', { class: 'bio-reveal' }, r.lesson.intro?.text ?? r.lesson.summary ?? ''),
      h('div', { class: 'dialog-actions' }, button('Start the first mission →', { variant: 'primary', onClick: () => this.handlers.onStart() })),
    ]
  }

  private renderBuild(): Node[] {
    const r = this.run
    const m = r.mission!
    return [
      this.head(`MISSION ${r.missionIndex + 1} OF ${r.lesson.missions.length}`, m.title),
      h('p', { class: 'bio-prompt' }, m.goalText),
      this.controls,
      ...(r.feedback ? [h('p', { class: 'ml-feedback', role: 'status' }, r.feedback)] : []),
      ...(r.hints.length ? [h('ol', { class: 'ml-hints' }, ...r.hints.map((t, i) => h('li', null, h('span', { class: 't-label' }, ['Nudge', 'Clue', 'Explanation'][i] ?? 'Hint'), ` ${t}`)))] : []),
      h(
        'div',
        { class: 'dialog-actions' },
        button(r.hintsLeft > 0 ? `Hint (${r.hintsLeft} left)` : 'No hints left', { variant: 'ghost', disabled: r.hintsLeft <= 0, onClick: () => this.handlers.onHint() }),
        button('Check', { variant: 'primary', onClick: () => this.handlers.onCheck() }),
      ),
    ]
  }

  private renderQuestion(): Node[] {
    const r = this.run
    const q = r.question!
    const f = r.answers[q.id]
    const options = h(
      'div',
      { class: 'opt-list', role: 'radiogroup', 'aria-label': q.prompt },
      ...q.options.map((o, i) => {
        const state = f ? (o.id === f.answer ? ' ok' : o.id === f.yourAnswer ? ' wrong' : '') : ''
        const mark = f && o.id === f.answer ? '✓ ' : f && o.id === f.yourAnswer ? '✗ ' : ''
        return h('button', { class: `conf-btn${state}`, type: 'button', role: 'radio', disabled: !!f, 'aria-checked': String(f ? o.id === f.yourAnswer : r.picked === o.id), onclick: () => this.handlers.onPick(o.id) }, h('span', { class: 't-label' }, `${mark}${String.fromCharCode(65 + i)}. ${o.label}`))
      }),
    )
    const nextLabel = !r.isLastQuestion ? 'Next question →' : r.progress.current === null ? 'See how you did →' : 'Next mission →'
    return [
      this.head(r.mission ? `MISSION ${r.missionIndex + 1} · CHECKPOINT` : 'CHECKPOINT', 'Check your thinking', `Question ${r.qIndex + 1} of ${r.questions.length}`),
      h('p', { class: 'bio-prompt' }, q.prompt),
      options,
      ...(f ? [h('p', { class: 'bio-reveal' }, `${f.correct ? 'Correct. ' : `Not quite. The correct answer is ${q.options.find((o) => o.id === f.answer)?.label ?? 'shown above'}. `}${f.explanation}`)] : []),
      h('div', { class: 'dialog-actions' }, f ? button(nextLabel, { variant: 'primary', onClick: () => this.handlers.onNext() }) : button('Check my answer', { variant: 'primary', disabled: !r.canCheckAnswer, onClick: () => this.handlers.onAnswer() })),
    ]
  }

  private renderDone(): Node[] {
    const s = this.run.summary
    const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 't-title' }, n), h('div', { class: 't-support' }, l))
    return [
      this.head('LESSON COMPLETE', 'Well done'),
      ...(s ? [h('div', { class: 'stats' }, stat(`${s.missions}`, 'missions done'), stat(`${s.correct}/${s.total}`, 'questions right'), stat(`${s.hintsUsed}`, 'hints used'))] : []),
      h('div', { class: 'dialog-actions' }, button('Back to experiments', { variant: 'primary', onClick: () => this.handlers.onBack() })),
    ]
  }

  destroy() {
    window.removeEventListener('resize', this.layout)
    this.root.remove()
  }
}
