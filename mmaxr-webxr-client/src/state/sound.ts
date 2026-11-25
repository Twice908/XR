import { XapiVerb } from '@mmaxr/schema'
import type { SoundAct, SoundCalcResult, SoundExplainResult, SoundLessonContract, SoundReveal, SoundTask, SoundTool, SoundTrialResult, TelemetryEvent } from '@mmaxr/schema'

export type Confidence = 1 | 2 | 3
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object'], at?: number) => void

export class StateError extends Error {}

export interface Explained {
  text: string
  inputMode: 'voice' | 'typed'
  speakMs: number
  words: number
}

export interface ExplainMeta {
  inputMode: 'voice' | 'typed'
  speakMs: number
  pasted: number
  blurs: number
}

export interface Trial {
  id: string
  tab: SoundTool
  tabName: string
  /** 1-based position within its tab: with `tab` it is the pairing key the rubric engine uses. */
  sample: number
  task: SoundTask
  prediction: string | null
  confidence: Confidence | null
  decisionMs: number
  predictedAt: number
  result: (SoundTrialResult & { hasCalc: boolean }) | null
  resultAt: number
  calc: { attempts: number; ok: boolean; value: number | null }
  explained: Explained | null
  /** Shown only once the student has explained the run. */
  reveal: SoundExplainResult['reveal'] | null
  anomalyNoticed: boolean
}

export interface Summary {
  correct: number
  total: number
  calcAttempts: number
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export class SoundExperiment {
  readonly items: Trial[]
  tab: SoundTool
  pending: Trial | null = null
  reveal: SoundReveal | null = null
  private readonly maxWords: number
  readonly minWords: number

  constructor(
    readonly lesson: SoundLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.maxWords = lesson.config.maxExplanationWords ?? 80
    this.minWords = lesson.config.minExplanationWords ?? 8
    this.items = lesson.scenarios.flatMap((sc) =>
      sc.tasks.map((task, i): Trial => ({ id: task.id, tab: sc.tool, tabName: sc.tabName, sample: i + 1, task, prediction: null, confidence: null, decisionMs: 0, predictedAt: 0, result: null, resultAt: 0, calc: { attempts: 0, ok: false, value: null }, explained: null, reveal: null, anomalyNoticed: false })),
    )
    this.tab = lesson.scenarios[0].tool
  }

  trial(id: string): Trial {
    const t = this.items.find((x) => x.id === id)
    if (!t) throw new StateError(`Unknown task ${id}`)
    return t
  }
  of(tab: SoundTool): Trial[] {
    return this.items.filter((t) => t.tab === tab)
  }

  /** Run, calculated where asked, and explained. */
  isComplete(t: Trial): boolean {
    return !!t.result && (!t.result.hasCalc || t.calc.ok) && !!t.explained
  }
  /** The run that still owes something (a calculation or an explanation). */
  get owed(): Trial | null {
    return this.items.find((t) => !!t.result && !this.isComplete(t)) ?? null
  }
  get answered(): number {
    return this.items.filter((t) => this.isComplete(t)).length
  }
  get phase(): 'play' | 'finish' | 'reveal' {
    if (this.reveal) return 'reveal'
    return this.answered === this.items.length ? 'finish' : 'play'
  }

  canPredict(id: string): { ok: boolean; reason?: string } {
    const t = this.trial(id)
    if (this.reveal) return { ok: false, reason: 'The sandbox is finished.' }
    if (t.result) return { ok: false, reason: 'You already ran this one.' }
    if (this.owed) return { ok: false, reason: 'Finish your last run first: calculate and explain it.' }
    if (this.pending && this.pending.id !== id) return { ok: false, reason: 'Run the task you predicted first.' }
    return { ok: true }
  }

  predict(id: string, optionId: string, confidence: Confidence, decisionMs: number): Trial {
    const gate = this.canPredict(id)
    if (!gate.ok) throw new StateError(gate.reason ?? 'You cannot do that yet.')
    const t = this.trial(id)
    if (!t.task.predictionOptions.some((o) => o.id === optionId)) throw new StateError('Choose what you expect first.')
    t.prediction = optionId
    t.confidence = confidence
    t.decisionMs = Math.max(0, Math.round(decisionMs))
    t.predictedAt = this.now()
    this.pending = t
    this.emit(XapiVerb.PREDICTED, {
      action: 'predict_sound',
      target: `${t.tab}:${t.sample}`,
      value: t.task.predictionOptions.find((o) => o.id === optionId)?.label ?? optionId,
      data: { sample: t.sample, tool: t.tab, id, confidence, decisionMs: t.decisionMs },
    })
    return t
  }

  /** What the browser reports it did to the experiment. */
  actPayload(id: string, act: SoundAct) {
    const t = this.trial(id)
    if (!t.prediction || !t.confidence) throw new StateError('Make a prediction first.')
    return { id, prediction: t.prediction, confidence: t.confidence, thinkMs: t.decisionMs, act }
  }

  /** The lesson service accepted the run. */
  act(result: SoundTrialResult & { hasCalc: boolean }, clickedAt?: number): Trial {
    const t = this.pending
    if (!t || t.id !== result.id) throw new StateError('Make a prediction first.')
    t.result = result
    t.resultAt = this.now()
    this.pending = null
    const data = { sample: t.sample, tool: t.tab, id: t.id }
    this.emit(XapiVerb.ACTED, { action: 'run_task', target: `${t.tab}:${t.sample}`, data }, clickedAt)
    this.emit(XapiVerb.OBSERVED, { action: 'test_result', target: `${t.tab}:${t.sample}`, value: String(t.prediction), data: { ...data, match: result.match, anomaly: result.anomaly === true } })
    return t
  }

  noticeAnomaly(id: string) {
    const t = this.trial(id)
    if (!t.result?.anomaly) throw new StateError('There is nothing odd to flag here.')
    if (t.anomalyNoticed) return
    t.anomalyNoticed = true
    this.emit(XapiVerb.NOTICED_ANOMALY, { action: 'anomaly_frequency', target: `${t.tab}:${t.sample}`, data: { sample: t.sample, tool: t.tab, id } })
  }

  calcResult(id: string, r: SoundCalcResult, value: number) {
    const t = this.trial(id)
    t.calc = { attempts: r.attempts, ok: r.ok, value: r.ok ? (r.value ?? value) : t.calc.value }
    this.emit(XapiVerb.EXPLAINED, { action: 'calculate', target: `${t.tab}:${t.sample}`, value, data: { sample: t.sample, tool: t.tab, id, attempt: r.attempts, ok: r.ok } })
  }

  explainPayload(id: string, text: string, meta: ExplainMeta) {
    const t = this.trial(id)
    if (!t.result) throw new StateError('Run it first, then explain what you saw.')
    if (t.result.hasCalc && !t.calc.ok) throw new StateError('Finish the calculation first.')
    const clean = text.trim().split(/\s+/).slice(0, this.maxWords).join(' ')
    if (wordCount(clean) < this.minWords) throw new StateError(`Explain it in at least ${this.minWords} words.`)
    return { id, text: clean, inputMode: meta.inputMode, speakMs: meta.speakMs, thinkMs: t.decisionMs, pasted: meta.pasted, blurs: meta.blurs }
  }

  explained(id: string, text: string, meta: ExplainMeta, r: SoundExplainResult) {
    const t = this.trial(id)
    const clean = text.trim().split(/\s+/).slice(0, this.maxWords).join(' ')
    t.explained = { text: clean, inputMode: meta.inputMode, speakMs: meta.speakMs, words: wordCount(clean) }
    t.reveal = r.reveal
    this.emit(XapiVerb.EXPLAINED, {
      action: 'explain',
      target: `${t.tab}:${t.sample}`,
      data: { sample: t.sample, tool: t.tab, id, words: t.explained.words, inputMode: meta.inputMode, speakMs: meta.speakMs, pasted: meta.pasted, blurs: meta.blurs, msAfterResult: this.now() - t.resultAt },
    })
  }

  get canSubmit(): boolean {
    return !this.reveal && !this.pending && this.answered === this.items.length
  }
  get submitBlocker(): string | null {
    if (this.reveal) return 'Already finished.'
    if (this.owed) return 'Finish your last run first.'
    if (this.answered < this.items.length) return `Finish all ${this.items.length} tasks first (${this.answered} done).`
    return null
  }

  finish(reveal: SoundReveal): Summary {
    this.reveal = reveal
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { correct: reveal.correct, total: reveal.total, calcAttempts: reveal.calcAttempts } })
    return { correct: reveal.correct, total: reveal.total, calcAttempts: reveal.calcAttempts }
  }
}
