import { XapiVerb } from '@mmaxr/schema'
import type { MotionExplanationResult, MotionLessonContract, MotionObservation, MotionScenario, MotionTrial, TelemetryEvent } from '@mmaxr/schema'

export type Confidence = 1 | 2 | 3
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object'], at?: number) => void
/** open: choosing a prediction. locked: ready to run. running: the experiment is playing. observed: result known. done: finished. */
export type TrialStage = 'open' | 'locked' | 'running' | 'observed' | 'done'

export class StateError extends Error {}
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export interface TrialState {
  trial: MotionTrial
  scenario: string
  /** 1-based position over the whole lesson, used as the event "sample". */
  n: number
  stage: TrialStage
  numbers: Record<string, string>
  choice: string | null
  confidence: Confidence | null
  observation: MotionObservation | null
  explanation: string
  inputMode: 'voice' | 'typed'
  speakMs: number
  explained: MotionExplanationResult | null
  openedAt: number
  lockedAt: number
  thinkMs: number
}

/** The student's side of the sandbox. It holds no answers: each outcome arrives from the server once the result has been watched. */
export class MotionExperiment {
  readonly trials: TrialState[] = []
  scenarioId: string
  private reported = false
  /** A finished trial stays on screen, with its result, until the student moves on. */
  private lingering: TrialState | null = null

  constructor(
    readonly lesson: MotionLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    let n = 0
    for (const s of lesson.scenarios)
      for (const trial of s.trials) this.trials.push({ trial, scenario: s.id, n: ++n, stage: 'open', numbers: {}, choice: null, confidence: null, observation: null, explanation: '', inputMode: 'typed', speakMs: 0, explained: null, openedAt: 0, lockedAt: 0, thinkMs: 0 })
    this.scenarioId = lesson.scenarios[0].id
    this.open(this.current)
  }

  get scenarios(): MotionScenario[] {
    return this.lesson.scenarios
  }
  get scenario(): MotionScenario {
    return this.scenarios.find((s) => s.id === this.scenarioId)!
  }
  of(scenarioId: string): TrialState[] {
    return this.trials.filter((t) => t.scenario === scenarioId)
  }
  /** The trial the student is working on in this module: the first one not finished. Null when the module is complete. */
  get currentOrNull(): TrialState | null {
    return this.of(this.scenarioId).find((t) => t.stage !== 'done') ?? null
  }
  get current(): TrialState {
    if (this.lingering && this.lingering.scenario === this.scenarioId) return this.lingering
    const list = this.of(this.scenarioId)
    return this.currentOrNull ?? list[list.length - 1]
  }
  /** True while a finished trial is still showing and the next one has not been opened. */
  get canAdvance(): boolean {
    return this.current.stage === 'done' && this.currentOrNull !== null
  }
  moduleDone(id: string): boolean {
    return this.of(id).every((t) => t.stage === 'done')
  }
  get allDone(): boolean {
    return this.trials.every((t) => t.stage === 'done')
  }
  get doneCount(): number {
    return this.trials.filter((t) => t.stage === 'done').length
  }
  get minWords(): number {
    return this.lesson.config.minExplanationWords
  }

  private open(t: TrialState) {
    if (!t.openedAt) t.openedAt = this.now()
  }

  switchModule(id: string): void {
    if (id === this.scenarioId || !this.scenarios.some((s) => s.id === id)) return
    this.scenarioId = id
    this.lingering = null
    this.open(this.current)
    this.emit(XapiVerb.INVESTIGATED, { action: 'select_module', target: id, value: id })
  }

  // ---- predict ----
  private guardOpen(t: TrialState) {
    if (t.stage !== 'open') throw new StateError('Your prediction is already locked in.')
  }
  setNumber(fieldId: string, text: string): void {
    this.guardOpen(this.current)
    this.current.numbers[fieldId] = text
  }
  setChoice(id: string): void {
    this.guardOpen(this.current)
    this.current.choice = id
  }
  setConfidence(c: Confidence): void {
    this.guardOpen(this.current)
    this.current.confidence = c
  }
  /** What to send to the server, or null when the prediction is not complete yet. */
  predictionValue(t: TrialState = this.current): Record<string, number | string> | null {
    if (t.trial.input.type === 'choice') return t.choice ? { choice: t.choice } : null
    const out: Record<string, number> = {}
    for (const f of t.trial.input.fields) {
      const raw = (t.numbers[f.id] ?? '').trim().replace(',', '.')
      const v = raw === '' ? Number.NaN : Number(raw)
      if (!Number.isFinite(v)) return null
      out[f.id] = v
    }
    return out
  }
  get canLock(): boolean {
    const t = this.current
    return t.stage === 'open' && this.predictionValue(t) !== null && t.confidence !== null
  }
  lockPayload(): { trial: string; value: Record<string, number | string>; confidence: Confidence | null; thinkMs: number } {
    const t = this.current
    this.guardOpen(t)
    const value = this.predictionValue(t)
    if (!value) throw new StateError('Fill in your prediction first.')
    if (!t.confidence) throw new StateError('Say how sure you are.')
    return { trial: t.trial.id, value, confidence: t.confidence, thinkMs: this.now() - t.openedAt }
  }
  /** The server accepted the prediction. */
  recordLocked(thinkMs: number, clickedAt?: number): void {
    const t = this.current
    t.thinkMs = thinkMs
    t.stage = 'locked'
    // Stamp the moment the student clicked "Lock", not when the server's reply arrived, so network delay does not eat
    // into the time between predicting and acting.
    t.lockedAt = clickedAt ?? this.now()
    const isRun = t.trial.action !== null
    this.emit(XapiVerb.PREDICTED, {
      action: isRun ? 'predict_trial' : 'predict_transfer',
      target: `trial:${t.trial.id}`,
      value: this.describeValue(t),
      data: { sample: t.n, tool: isRun ? 'run' : 'answer', trial: t.trial.id, module: t.scenario, confidence: t.confidence, decisionMs: thinkMs, anomaly: t.trial.anomaly },
    }, t.lockedAt)
  }

  private describeValue(t: TrialState): string {
    const v = this.predictionValue(t)
    if (!v) return ''
    return t.trial.input.type === 'choice' ? String(v.choice) : Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' ')
  }

  // ---- run + observe ----
  startRun(): TrialState {
    const t = this.current
    if (t.stage !== 'locked') throw new StateError('Lock in a prediction first.')
    t.stage = 'running'
    this.emit(XapiVerb.ACTED, {
      action: t.trial.action ? 'run_trial' : 'answer_transfer',
      target: `trial:${t.trial.id}`,
      value: t.trial.action ?? 'answer',
      data: { sample: t.n, tool: t.trial.action ? 'run' : 'answer', trial: t.trial.id, msSincePrediction: this.now() - t.lockedAt },
    })
    return t
  }
  recordObservation(o: MotionObservation): void {
    const t = this.current
    t.observation = o
    t.stage = t.trial.needsExplanation && !o.explanation ? 'observed' : 'done'
    if (t.stage === 'done') this.lingering = t
    this.emit(XapiVerb.OBSERVED, {
      action: t.trial.action ? 'observe_result' : 'transfer_result',
      target: `trial:${t.trial.id}`,
      value: o.match ? 'match' : 'miss',
      data: { sample: t.n, tool: t.trial.action ? 'run' : 'answer', trial: t.trial.id, match: o.match, fieldMatch: o.fieldMatch },
    })
    this.maybeFinish()
  }

  // ---- explain ----
  setExplanation(text: string, inputMode: 'voice' | 'typed' = 'typed', speakMs = 0): void {
    const t = this.current
    t.explanation = text
    t.inputMode = inputMode
    t.speakMs = speakMs
  }
  get canExplain(): boolean {
    const t = this.current
    return t.stage === 'observed' && wordCount(t.explanation) >= this.minWords
  }
  explainPayload(): { trial: string; explanation: string; inputMode: 'voice' | 'typed'; speakMs: number } {
    const t = this.current
    if (t.stage !== 'observed') throw new StateError('Watch the result first.')
    if (wordCount(t.explanation) < this.minWords) throw new StateError(`Write at least ${this.minWords} words.`)
    return { trial: t.trial.id, explanation: t.explanation.trim(), inputMode: t.inputMode, speakMs: t.speakMs }
  }
  recordExplained(r: MotionExplanationResult): void {
    const t = this.current
    t.explained = r
    t.stage = 'done'
    this.lingering = t
    if (t.observation) t.observation = { ...t.observation, explanation: r.explanation }
    this.emit(XapiVerb.EXPLAINED, { action: 'explain_result', target: `trial:${t.trial.id}`, data: { sample: t.n, trial: t.trial.id, words: wordCount(t.explanation), coverage: r.coverage, inputMode: t.inputMode, speakMs: t.speakMs } })
    this.maybeFinish()
  }

  /** Moving on after a finished trial: the next one in the module opens its clock. */
  advance(): void {
    this.lingering = null
    const next = this.currentOrNull
    if (next) this.open(next)
  }

  private maybeFinish() {
    if (this.reported || !this.allDone) return
    this.reported = true
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { trials: this.trials.length, matched: this.trials.filter((t) => t.observation?.match).length } })
  }

  summary() {
    const preds = this.trials.filter((t) => t.trial.kind === 'prediction')
    const surprises = preds.filter((t) => t.trial.anomaly)
    const ex = this.trials.filter((t) => t.explained)
    const transfer = this.trials.filter((t) => t.trial.kind === 'transfer')
    return {
      predictionsRight: preds.filter((t) => t.observation?.match).length,
      predictions: preds.length,
      surprisesRight: surprises.filter((t) => t.observation?.match).length,
      surprises: surprises.length,
      avgCoverage: ex.length ? ex.reduce((a, t) => a + (t.explained?.coverage ?? 0), 0) / ex.length : 0,
      transferRight: transfer.filter((t) => t.observation?.match).length,
      transfer: transfer.length,
    }
  }
}
