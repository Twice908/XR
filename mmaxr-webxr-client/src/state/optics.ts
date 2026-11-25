import { XapiVerb } from '@mmaxr/schema'
import type { OpticsImage, OpticsImageField, OpticsLessonContract, OpticsMirror, OpticsReveal, OpticsTrialKind, OpticsTrialResult, TelemetryEvent } from '@mmaxr/schema'

export type Phase = 'plane' | 'laws' | 'rules' | 'concave' | 'convex' | 'table' | 'reveal'
export type Confidence = 1 | 2 | 3
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object'], at?: number) => void
export type Tool = 'plane' | 'law' | 'rule' | 'concave' | 'convex'

export const IMAGE_FIELDS: OpticsImageField[] = ['position', 'size', 'nature', 'orientation']

export class StateError extends Error {}

export interface Trial {
  kind: OpticsTrialKind
  id: string
  /** Which experiment this belongs to; with `sample` it is the pairing key the rubric engine uses. */
  tool: Tool
  /** 1-based position within its experiment. */
  sample: number
  title: string
  prediction: Record<string, string> | null
  confidence: Confidence | null
  decisionMs: number
  predictedAt: number
  actedAt: number
  result: OpticsTrialResult | null
  /** When the result appeared on screen: the explanation is timed from here. */
  resultAt: number
  /** The student's explanation of this run, once the lesson service has accepted it. */
  explained: Explained | null
  anomalyNoticed: boolean
}

export interface Explained {
  text: string
  inputMode: 'voice' | 'typed'
  speakMs: number
  words: number
}

/** How an explanation was produced, measured in the browser. */
export interface ExplainMeta {
  inputMode: 'voice' | 'typed'
  speakMs: number
  /** Characters pasted into the box, and times the tab was left while this run was open. */
  pasted: number
  blurs: number
}

export interface Summary {
  planeCorrect: number
  planeTotal: number
  lawsCorrect: number
  lawsTotal: number
  rulesCorrect: number
  rulesTotal: number
  firstTryCorrect: number
  cases: number
  tableCorrect: number
  revisions: number
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export class OpticsExperiment {
  readonly items: Trial[]
  /** The student's own image table: starts as their first prediction and may be revised after each reveal. */
  readonly table: Record<string, Partial<OpticsImage>> = {}
  pending: Trial | null = null
  revisions = 0
  reveal: OpticsReveal | null = null
  private readonly maxWords: number
  readonly minWords: number

  constructor(
    readonly lesson: OpticsLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.maxWords = lesson.config.maxExplanationWords ?? 80
    this.minWords = lesson.config.minExplanationWords ?? 8
    const make = (kind: OpticsTrialKind, id: string, tool: Tool, sample: number, title: string): Trial => ({ kind, id, tool, sample, title, prediction: null, confidence: null, decisionMs: 0, predictedAt: 0, actedAt: 0, result: null, resultAt: 0, explained: null, anomalyNoticed: false })
    this.items = [
      ...lesson.planeMirror.scenarios.map((s, i) => make('plane', s.id, 'plane', i + 1, s.name)),
      ...lesson.lawsOfReflection.laws.map((l, i) => make('law', l.id, 'law', i + 1, l.topic)),
      ...lesson.rayRules.rules.map((r, i) => make('rule', r.id, 'rule', i + 1, r.incident)),
      ...lesson.sphericalMirrors.flatMap((m) => m.cases.map((c, i) => make('case', c.id, m.mirrorType, i + 1, `${m.mirrorType === 'concave' ? 'Concave' : 'Convex'} mirror: candle at ${c.objectPosition}`))),
    ]
  }

  /* ---------------- lookups ---------------- */
  trial(id: string): Trial {
    const t = this.items.find((x) => x.id === id)
    if (!t) throw new StateError(`Unknown experiment ${id}`)
    return t
  }
  of(tool: Tool): Trial[] {
    return this.items.filter((t) => t.tool === tool)
  }
  caseDef(id: string) {
    for (const m of this.lesson.sphericalMirrors) {
      const c = m.cases.find((x) => x.id === id)
      if (c) return { ...c, mirror: m.mirrorType as OpticsMirror }
    }
    throw new StateError(`Unknown case ${id}`)
  }
  /** Surfaces, laws and rays must always be explained; an image only when the first prediction missed. */
  needsExplanation(t: Trial): boolean {
    return !!t.result && (t.kind !== 'case' || !t.result.match)
  }
  /** Run, and explained if it has to be. */
  isComplete(t: Trial): boolean {
    return !!t.result && (!this.needsExplanation(t) || !!t.explained)
  }
  /** The run that still owes an explanation, if any. */
  get owed(): Trial | null {
    return this.items.find((t) => this.needsExplanation(t) && !t.explained) ?? null
  }
  private done = (tool: Tool) => this.of(tool).every((t) => this.isComplete(t))

  get phase(): Phase {
    if (this.reveal) return 'reveal'
    if (!this.done('plane')) return 'plane'
    if (!this.done('law')) return 'laws'
    if (!this.done('rule')) return 'rules'
    if (!this.done('concave')) return 'concave'
    if (!this.done('convex')) return 'convex'
    return 'table'
  }

  get answered(): number {
    return this.items.filter((t) => this.isComplete(t)).length
  }
  get cases(): Trial[] {
    return this.items.filter((t) => t.kind === 'case')
  }

  /* ---------------- predict, then act ---------------- */
  canPredict(id: string): { ok: boolean; reason?: string } {
    const t = this.trial(id)
    if (this.reveal) return { ok: false, reason: 'The experiment is finished.' }
    if (t.result) return { ok: false, reason: 'You already ran this one.' }
    if (this.owed) return { ok: false, reason: 'Explain your last run first.' }
    if (this.pending && this.pending.id !== id) return { ok: false, reason: 'Run the experiment you predicted first.' }
    const order: Tool[] = ['plane', 'law', 'rule', 'concave', 'convex']
    const earlier = order.slice(0, order.indexOf(t.tool))
    const blocked = earlier.find((tool) => !this.done(tool))
    if (blocked) return { ok: false, reason: { plane: 'Fire the laser at both surfaces first.', law: 'Test the three laws of reflection first.', rule: 'Learn the four ray rules first.', concave: 'Finish the concave mirror first.', convex: '' }[blocked] }
    return { ok: true }
  }

  predict(id: string, prediction: Record<string, string>, confidence: Confidence, decisionMs: number): Trial {
    const gate = this.canPredict(id)
    if (!gate.ok) throw new StateError(gate.reason ?? 'You cannot do that yet.')
    const t = this.trial(id)
    const fields = t.kind === 'case' ? IMAGE_FIELDS : ['outcome']
    const missing = fields.filter((f) => !prediction[f])
    if (missing.length) throw new StateError(t.kind === 'case' ? 'Predict the position, size, nature and orientation first.' : 'Choose what you expect first.')
    t.prediction = Object.fromEntries(fields.map((f) => [f, prediction[f]]))
    t.confidence = confidence
    t.decisionMs = Math.max(0, Math.round(decisionMs))
    t.predictedAt = this.now()
    this.pending = t
    const value = t.kind === 'case' ? IMAGE_FIELDS.map((f) => prediction[f]).join('/') : prediction.outcome
    this.emit(XapiVerb.PREDICTED, {
      action: t.kind === 'plane' ? 'predict_surface' : t.kind === 'law' ? 'predict_law' : t.kind === 'rule' ? 'predict_ray' : 'predict_image',
      target: `${t.tool}:${t.sample}`,
      value,
      data: { sample: t.sample, tool: t.tool, id: t.id, confidence, decisionMs: t.decisionMs, prediction: t.prediction },
    })
    return t
  }

  /** The student fired the laser / traced the rays. `result` is what the lesson service disclosed. */
  act(result: OpticsTrialResult, clickedAt?: number): Trial {
    const t = this.pending
    if (!t || t.id !== result.id) throw new StateError('Make a prediction first.')
    t.result = result
    // The student acted when they clicked; the result arrived after the server's reply.
    t.actedAt = clickedAt ?? this.now()
    t.resultAt = this.now()
    this.pending = null
    const data = { sample: t.sample, tool: t.tool, id: t.id }
    this.emit(XapiVerb.ACTED, { action: t.kind === 'plane' ? 'fire_laser' : t.kind === 'law' ? 'fire_law' : t.kind === 'rule' ? 'fire_ray' : 'trace_rays', target: `${t.tool}:${t.sample}`, data }, t.actedAt)
    this.emit(XapiVerb.OBSERVED, { action: 'test_result', target: `${t.tool}:${t.sample}`, value: result.outcome ?? result.image?.position ?? '', data: { ...data, match: result.match, fields: result.fields ?? null, anomaly: result.anomaly === true } })
    if (t.kind === 'case') this.table[t.id] = { ...(t.prediction as Partial<OpticsImage>) }
    return t
  }

  /** The student saw that the rays at F never meet and says so. Counts once. */
  noticeAnomaly(id: string) {
    const t = this.trial(id)
    if (!t.result?.anomaly) throw new StateError('There is nothing odd to flag here.')
    if (t.anomalyNoticed) return
    t.anomalyNoticed = true
    this.emit(XapiVerb.NOTICED_ANOMALY, { action: 'anomaly_at_f', target: `${t.tool}:${t.sample}`, data: { sample: t.sample, tool: t.tool, id } })
  }

  /** What to send to the lesson service for this run's explanation. Throws if it is not worth sending yet. */
  explainPayload(id: string, text: string, meta: ExplainMeta) {
    const t = this.trial(id)
    if (!t.result) throw new StateError('Run it first, then explain what you saw.')
    const clean = text.trim().split(/\s+/).slice(0, this.maxWords).join(' ')
    if (wordCount(clean) < this.minWords) throw new StateError(`Explain it in at least ${this.minWords} words.`)
    return { kind: t.kind, id, text: clean, inputMode: meta.inputMode, speakMs: meta.speakMs, thinkMs: t.decisionMs, pasted: meta.pasted, blurs: meta.blurs }
  }

  /** The lesson service accepted the explanation. */
  explained(id: string, text: string, meta: ExplainMeta) {
    const t = this.trial(id)
    const clean = text.trim().split(/\s+/).slice(0, this.maxWords).join(' ')
    t.explained = { text: clean, inputMode: meta.inputMode, speakMs: meta.speakMs, words: wordCount(clean) }
    this.emit(XapiVerb.EXPLAINED, {
      action: 'explain',
      target: `${t.tool}:${t.sample}`,
      data: { sample: t.sample, tool: t.tool, id, words: t.explained.words, inputMode: meta.inputMode, speakMs: meta.speakMs, pasted: meta.pasted, blurs: meta.blurs, msAfterResult: this.now() - t.resultAt },
    })
  }

  /* ---------------- the table ---------------- */
  setCell(id: string, field: OpticsImageField, value: string) {
    const t = this.trial(id)
    if (t.kind !== 'case' || !t.result) throw new StateError('Run this experiment before changing its row.')
    if (this.reveal) throw new StateError('The table is locked.')
    const row = this.table[id]
    const from = row[field] ?? ''
    if (from === value) return
    row[field] = value
    this.revisions++
    this.emit(XapiVerb.REVISED_MODEL, { action: 'revise_table', target: `${t.tool}:${t.sample}`, value, data: { sample: t.sample, tool: t.tool, id, field, from, to: value } })
  }

  get tableComplete(): boolean {
    return this.cases.every((t) => IMAGE_FIELDS.every((f) => this.table[t.id]?.[f]))
  }
  get canSubmit(): boolean {
    return !this.reveal && !this.pending && this.answered === this.items.length && this.tableComplete
  }
  get submitBlocker(): string | null {
    if (this.reveal) return 'Already locked in.'
    if (this.owed) return 'Explain your last run first.'
    if (this.answered < this.items.length) return `Finish all ${this.items.length} experiments first (${this.answered} done).`
    if (!this.tableComplete) return 'Complete every cell of your table.'
    return null
  }

  submissionPayload(): { table: Record<string, OpticsImage>; notes: Record<string, string> } {
    if (!this.canSubmit) throw new StateError(this.submitBlocker ?? 'Not ready to lock in yet.')
    const notes: Record<string, string> = {}
    for (const t of this.items) if (t.explained) notes[t.id] = t.explained.text
    return { table: Object.fromEntries(this.cases.map((t) => [t.id, { ...(this.table[t.id] as OpticsImage) }])), notes }
  }

  finish(reveal: OpticsReveal): Summary {
    this.reveal = reveal
    const s = this.summary()
    this.emit(XapiVerb.EXPLAINED, {
      action: 'submit_analysis',
      data: { tableCorrect: reveal.tableCorrect, tableTotal: reveal.tableTotal, revisions: this.revisions, planeCorrect: reveal.planeCorrect, lawsCorrect: reveal.lawsCorrect, rulesCorrect: reveal.rulesCorrect },
    })
    return s
  }

  summary(): Summary {
    const r = this.reveal
    return {
      planeCorrect: this.of('plane').filter((t) => t.result?.match).length,
      planeTotal: this.of('plane').length,
      lawsCorrect: this.of('law').filter((t) => t.result?.match).length,
      lawsTotal: this.of('law').length,
      rulesCorrect: this.of('rule').filter((t) => t.result?.match).length,
      rulesTotal: this.of('rule').length,
      firstTryCorrect: this.cases.filter((t) => t.result?.match).length,
      cases: this.cases.length,
      tableCorrect: r?.tableCorrect ?? 0,
      revisions: this.revisions,
    }
  }
}
