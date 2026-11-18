import { XapiVerb } from '@mmaxr/schema'
import type { MaterialKind, MetalsLessonContract, MetalsRevealSample, MetalsSample, MetalsTool, TelemetryEvent } from '@mmaxr/schema'

export type Phase = 'hypothesis' | 'testing' | 'reveal'
export type Confidence = 1 | 2 | 3
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object']) => void

export interface ServerOutcome {
  outcome: string
  litmus?: string
}

export interface TestResult {
  tool: string
  predicted: string
  confidence: Confidence
  decisionMs: number
  predictedAt: number
  actedAt: number
  /** What the server said this test shows. */
  actual: string
  /** Oxygen test only: what litmus did with the oxide. */
  litmus: string | null
  /** What the student wrote in the notebook for this test. */
  recorded: string | null
  recordedLitmus: string | null
}

export interface Sample {
  index: number
  look: MetalsSample
  hypothesis: MaterialKind | null
  hypothesisConfidence: Confidence | null
  conclusion: MaterialKind | null
  conclusionHistory: MaterialKind[]
  results: Record<string, TestResult>
  truth: MetalsRevealSample | null
}

export interface Pending {
  sample: number
  tool: string
  predicted: string
  confidence: Confidence
  decisionMs: number
  predictedAt: number
}

export interface SubmissionPayload {
  samples: { sample: number; conclusion: MaterialKind | null; hypothesis: MaterialKind | null; conclusionHistory: MaterialKind[] }[]
}

export interface Summary {
  samples: number
  correct: number
  hypothesisCorrect: number
  revisions: number
  exceptionsCaught: number
  exceptions: number
  predictions: number
  predictionsCorrect: number
  testsUsed: number
  budget: number
}

export class StateError extends Error {}

/** Outcomes that point towards "metal" when the student weighs up their own evidence. */
export const METALLIC: Record<string, string[]> = {
  hammer: ['flattens'],
  wire: ['draws'],
  tap: ['rings'],
  circuit: ['glows'],
  heat: ['conducts_well'],
}

/**
 * The student's side of the metals experiment. It holds no answers: samples carry only how they look, what a
 * test shows comes from the server, and the truth arrives with the reveal.
 */
export class MetalsExperiment {
  phase: Phase = 'hypothesis'
  readonly samples: Sample[]
  activeTool: string | null = null
  pending: Pending | null = null
  submitted = false
  used = 0

  constructor(
    readonly lesson: MetalsLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    const looks = lesson.samples ?? []
    if (looks.length === 0) throw new StateError('The lesson has no samples for this session')
    this.samples = looks.map((look, index) => ({ index, look, hypothesis: null, hypothesisConfidence: null, conclusion: null, conclusionHistory: [], results: {}, truth: null }))
  }

  get budget(): number {
    return this.lesson.config.testBudget
  }
  get remaining(): number {
    return Math.max(0, this.budget - this.used)
  }
  get minTests(): number {
    return this.lesson.config.minTestsPerSample
  }
  tool(id: string): MetalsTool | undefined {
    return this.lesson.tools.find((t) => t.id === id)
  }
  testsOn(i: number): number {
    return Object.keys(this.samples[i].results).length
  }
  get allClassified(): boolean {
    return this.samples.every((s) => s.hypothesis !== null)
  }
  get canSubmit(): boolean {
    return !this.submitted && this.phase === 'testing' && this.samples.every((s, i) => s.conclusion !== null && this.testsOn(i) >= this.minTests)
  }
  /** Why submitting is not possible yet, for the hint bar. */
  get submitBlocker(): string | null {
    if (this.canSubmit) return null
    const open = this.samples.filter((s, i) => this.testsOn(i) < this.minTests)
    if (open.length) return `Back every conclusion with at least ${this.minTests} tests. Still short: sample ${open.map((s) => s.index + 1).join(', ')}.`
    return 'Give every sample a conclusion.'
  }

  // ---- 1. first impressions ----
  setHypothesis(i: number, kind: MaterialKind, confidence: Confidence): void {
    if (this.phase !== 'hypothesis') throw new StateError('First impressions are already locked in.')
    const s = this.samples[i]
    if (!s) throw new StateError('Unknown sample')
    const first = s.hypothesis === null
    s.hypothesis = kind
    s.hypothesisConfidence = confidence
    s.conclusion = kind
    s.conclusionHistory = [kind]
    if (first) {
      this.emit(XapiVerb.EXPLAINED, { action: 'set_conclusion', target: `sample:${i + 1}`, value: kind, data: { sample: i + 1, stage: 'hypothesis', confidence, evidence: [] } })
    }
    if (this.allClassified) {
      this.phase = 'testing'
      this.activeTool = this.lesson.tools[0]?.id ?? null
      this.emit(XapiVerb.INVESTIGATED, { action: 'start_testing', data: { budget: this.budget } })
    }
  }

  // ---- 2. prediction gate ----
  selectTool(id: string): boolean {
    if (this.pending || this.phase !== 'testing' || !this.tool(id)) return false
    this.activeTool = id
    return true
  }

  canTest(i: number): { ok: boolean; reason?: string } {
    const s = this.samples[i]
    if (!s) return { ok: false, reason: 'Unknown sample' }
    if (this.phase === 'hypothesis') return { ok: false, reason: 'Give every sample a first impression before you start testing.' }
    if (this.phase === 'reveal') return { ok: false, reason: 'The experiment is finished.' }
    if (this.pending) return { ok: false, reason: 'Finish the test you started: run it.' }
    if (!this.activeTool) return { ok: false, reason: 'Pick a test first.' }
    if (s.results[this.activeTool]) return { ok: false, reason: `Sample ${i + 1} already has this result.` }
    if (this.remaining <= 0) return { ok: false, reason: 'You have used your whole test budget. Time to decide.' }
    return { ok: true }
  }

  predict(i: number, outcome: string, confidence: Confidence, decisionMs: number): Pending {
    const gate = this.canTest(i)
    if (!gate.ok) throw new StateError(gate.reason)
    const tool = this.tool(this.activeTool!)!
    if (!tool.outcomes.some((o) => o.id === outcome)) throw new StateError('A prediction is required before the test.')
    const predictedAt = this.now()
    this.pending = { sample: i, tool: tool.id, predicted: outcome, confidence, decisionMs, predictedAt }
    this.emit(XapiVerb.PREDICTED, {
      action: 'predict_outcome',
      target: `sample:${i + 1}`,
      value: outcome,
      data: { sample: i + 1, tool: tool.id, confidence, decisionMs, priorResults: this.testsOn(i) },
    })
    return this.pending
  }

  // ---- 3. action + observation ----
  act(server: ServerOutcome): { sample: number; tool: string; actual: string; litmus: string | null; predicted: string; match: boolean } {
    const p = this.pending
    if (!p) throw new StateError('Make a prediction first.')
    if (!server?.outcome) throw new StateError('The lab did not report a result.')
    const s = this.samples[p.sample]
    const actedAt = this.now()
    s.results[p.tool] = {
      tool: p.tool,
      predicted: p.predicted,
      confidence: p.confidence,
      decisionMs: p.decisionMs,
      predictedAt: p.predictedAt,
      actedAt,
      actual: server.outcome,
      litmus: server.litmus ?? null,
      recorded: null,
      recordedLitmus: null,
    }
    this.pending = null
    this.used += 1
    const match = p.predicted === server.outcome
    this.emit(XapiVerb.ACTED, { action: 'run_test', target: `sample:${p.sample + 1}`, value: p.tool, data: { sample: p.sample + 1, tool: p.tool, msSincePrediction: actedAt - p.predictedAt } })
    this.emit(XapiVerb.OBSERVED, {
      action: 'test_result',
      target: `sample:${p.sample + 1}`,
      value: server.outcome,
      data: { sample: p.sample + 1, tool: p.tool, predicted: p.predicted, match, ...(server.litmus ? { litmus: server.litmus } : {}), used: this.used },
    })
    return { sample: p.sample, tool: p.tool, actual: server.outcome, litmus: server.litmus ?? null, predicted: p.predicted, match }
  }

  // ---- 4. notebook ----
  recordObservation(i: number, tool: string, value: string): void {
    const r = this.samples[i]?.results[tool]
    if (!r) throw new StateError('Run this test before recording it.')
    r.recorded = value || null
    if (!value) return
    this.emit(XapiVerb.OBSERVED, { action: 'record_property', target: `table:sample:${i + 1}:${tool}`, value, data: { sample: i + 1, tool, actual: r.actual, correct: value === r.actual } })
  }

  recordLitmus(i: number, value: string): void {
    const r = this.samples[i]?.results.oxygen
    if (!r) throw new StateError('Burn it in air first.')
    r.recordedLitmus = value || null
    if (!value) return
    this.emit(XapiVerb.OBSERVED, { action: 'record_litmus', target: `table:sample:${i + 1}:oxide`, value, data: { sample: i + 1, actual: r.litmus, correct: value === r.litmus } })
  }

  /** Changing a conclusion after the first impression is a revision. Whether it was right is judged server-side later. */
  setConclusion(i: number, kind: MaterialKind): void {
    const s = this.samples[i]
    if (!s) throw new StateError('Unknown sample')
    if (this.phase !== 'testing') throw new StateError(this.phase === 'reveal' ? 'The experiment is finished.' : 'Give every sample a first impression first.')
    if (s.conclusion === kind) return
    const from = s.conclusion
    s.conclusion = kind
    s.conclusionHistory.push(kind)
    const evidence = Object.keys(s.results)
    this.emit(XapiVerb.REVISED_MODEL, {
      action: 'change_conclusion',
      target: `sample:${i + 1}`,
      value: kind,
      data: { sample: i + 1, from, to: kind, evidence, evidenceCount: evidence.length, revisionNumber: s.conclusionHistory.length - 1 },
    })
  }

  // ---- 5. submission and disclosure ----
  submissionPayload(): SubmissionPayload {
    if (!this.canSubmit) throw new StateError(this.submitBlocker ?? 'Not ready to submit.')
    return { samples: this.samples.map((s) => ({ sample: s.index + 1, conclusion: s.conclusion, hypothesis: s.hypothesis, conclusionHistory: [...s.conclusionHistory] })) }
  }

  finish(truth: MetalsRevealSample[]): Summary {
    if (this.submitted) return this.summary()
    this.submitted = true
    this.phase = 'reveal'
    this.activeTool = null
    for (const t of truth) {
      const s = this.samples[t.sample - 1]
      if (s) s.truth = t
    }
    this.emit(XapiVerb.EXPLAINED, {
      action: 'submit_analysis',
      data: { samples: this.samples.map((s) => ({ sample: s.index + 1, conclusion: s.conclusion, hypothesis: s.hypothesis, conclusionHistory: s.conclusionHistory, toolsUsed: Object.keys(s.results) })), testsUsed: this.used },
    })
    return this.summary()
  }

  summary(): Summary {
    let correct = 0
    let hypothesisCorrect = 0
    let revisions = 0
    let exceptions = 0
    let exceptionsCaught = 0
    let predictions = 0
    let predictionsCorrect = 0
    for (const s of this.samples) {
      const t = s.truth
      revisions += Math.max(0, s.conclusionHistory.length - 1)
      if (t && s.conclusion === t.type) correct++
      if (t && s.hypothesis === t.type) hypothesisCorrect++
      if (t?.anomaly) {
        exceptions++
        if (s.conclusion === t.type) exceptionsCaught++
      }
      for (const r of Object.values(s.results)) {
        predictions++
        if (r.predicted === r.actual) predictionsCorrect++
      }
    }
    return { samples: this.samples.length, correct, hypothesisCorrect, revisions, exceptionsCaught, exceptions, predictions, predictionsCorrect, testsUsed: this.used, budget: this.budget }
  }
}
