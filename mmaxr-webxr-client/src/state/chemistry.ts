import { XapiVerb } from '@mmaxr/schema'
import type { ChemistryIndicator, ChemistryLessonContract, ChemistrySolution, TelemetryEvent } from '@mmaxr/schema'
import { phPaperColor, sameColor } from '../services/colors'

export type Conclusion = 'acid' | 'base' | 'neutral'
export type Phase = 'select_tools' | 'testing' | 'ph' | 'reveal'
export type Confidence = 1 | 2 | 3

export const PH_TOOL = 'ph_paper'

export type Emit = (verb: XapiVerb, object: TelemetryEvent['object']) => void

export interface TestResult {
  tool: string
  predicted: string
  confidence: Confidence
  decisionMs: number
  predictedAt: number
  actedAt: number
  actual: string
  /** What the student typed into the notebook for this observation, if anything yet. */
  recorded: string | null
}

export interface Tube {
  index: number
  solution: ChemistrySolution
  results: Record<string, TestResult>
  conclusion: Conclusion | null
  conclusionHistory: Conclusion[]
  recordedPh: number | null
}

export interface PendingTest {
  tube: number
  tool: string
  predicted: string
  confidence: Confidence
  decisionMs: number
  predictedAt: number
}

export interface Summary {
  conclusionsCorrect: number
  tubes: number
  phExact: number
  phWithinOne: number
  colorEntriesCorrect: number
  colorEntries: number
  predictionsCorrect: number
  predictions: number
  revisions: number
}

export class StateError extends Error {}

const normalizeType = (t: string): Conclusion => {
  const v = (t ?? '').toLowerCase()
  if (v.includes('acid')) return 'acid'
  if (v.includes('base') || v.includes('alkal')) return 'base'
  return 'neutral'
}

export const truthOf = (s: ChemistrySolution): Conclusion => normalizeType(s.type)

export class ChemistryExperiment {
  phase: Phase = 'select_tools'
  readonly tubes: Tube[]
  chosen: string[] = []
  activeTool: string | null = null
  pending: PendingTest | null = null
  submitted = false
  private testingStarted = false

  constructor(
    readonly lesson: ChemistryLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    this.tubes = lesson.assignedSolutions.map((solution, index) => ({
      index,
      solution,
      results: {},
      conclusion: null,
      conclusionHistory: [],
      recordedPh: null,
    }))
  }

  // ---- lookups ----
  get required(): number {
    return this.lesson.config.requiredIndicatorsToSelect
  }
  /** The indicators the student can choose from (pH paper is handled separately). */
  get colorIndicators(): ChemistryIndicator[] {
    return this.lesson.indicators.filter((i) => !i.isPhTest)
  }
  get phIndicator(): ChemistryIndicator | undefined {
    return this.lesson.indicators.find((i) => i.isPhTest)
  }
  indicator(id: string): ChemistryIndicator | undefined {
    return this.lesson.indicators.find((i) => i.id === id)
  }
  get allConcluded(): boolean {
    return this.tubes.every((t) => t.conclusion !== null)
  }
  get allPhRecorded(): boolean {
    return this.tubes.every((t) => t.recordedPh !== null)
  }
  get phUnlocked(): boolean {
    return this.phase === 'ph' || this.phase === 'reveal'
  }
  get canStartTesting(): boolean {
    return this.phase === 'select_tools' && this.chosen.length === this.required
  }
  get canSubmit(): boolean {
    return this.allConcluded && this.allPhRecorded && !this.submitted
  }

  // ---- 1. tool selection ----
  toggleIndicator(id: string): boolean {
    if (this.phase !== 'select_tools') return false
    const ind = this.indicator(id)
    if (!ind || ind.isPhTest) return false
    const at = this.chosen.indexOf(id)
    if (at >= 0) {
      this.chosen.splice(at, 1)
      this.emit(XapiVerb.INVESTIGATED, { action: 'deselect_indicator', target: id })
      return true
    }
    if (this.chosen.length >= this.required) return false
    this.chosen.push(id)
    this.emit(XapiVerb.INVESTIGATED, { action: 'select_indicator', target: id, value: this.chosen.length })
    return true
  }

  startTesting(): void {
    if (!this.canStartTesting) throw new StateError(`Choose ${this.required} indicators first`)
    this.phase = 'testing'
    this.testingStarted = true
    this.activeTool = this.chosen[0]
    this.emit(XapiVerb.INVESTIGATED, { action: 'start_testing', data: { indicators: [...this.chosen] } })
  }

  selectTool(id: string): boolean {
    if (this.pending) return false
    const allowed = this.phase === 'testing' ? this.chosen.includes(id) : this.phase === 'ph' && id === PH_TOOL
    if (!allowed) return false
    this.activeTool = id
    return true
  }

  // ---- 2. prediction gate ----
  canTest(tubeIndex: number): { ok: boolean; reason?: string } {
    const tube = this.tubes[tubeIndex]
    if (!tube) return { ok: false, reason: 'Unknown test tube' }
    if (this.phase === 'select_tools') return { ok: false, reason: `Choose ${this.required} indicators and press Start testing first.` }
    if (this.phase === 'reveal') return { ok: false, reason: 'The experiment is finished.' }
    if (this.pending) return { ok: false, reason: 'Finish the test you started: add the indicator to the tube.' }
    if (!this.activeTool) return { ok: false, reason: 'Pick a tool first.' }
    if (this.phase === 'testing' && !this.chosen.includes(this.activeTool)) return { ok: false, reason: 'Pick one of your indicators.' }
    if (this.phase === 'ph' && this.activeTool !== PH_TOOL) return { ok: false, reason: 'Use the pH paper now.' }
    if (tube.results[this.activeTool]) return { ok: false, reason: `Tube ${tubeIndex + 1} already has this result.` }
    return { ok: true }
  }

  predict(tubeIndex: number, color: string, confidence: Confidence, decisionMs: number): PendingTest {
    const gate = this.canTest(tubeIndex)
    if (!gate.ok) throw new StateError(gate.reason)
    if (!color) throw new StateError('A prediction is required before the test.')
    const predictedAt = this.now()
    this.pending = { tube: tubeIndex, tool: this.activeTool!, predicted: color, confidence, decisionMs, predictedAt }
    this.emit(XapiVerb.PREDICTED, {
      action: this.activeTool === PH_TOOL ? 'predict_paper_color' : 'predict_color',
      target: `tube:${tubeIndex + 1}`,
      value: color,
      data: {
        tube: tubeIndex + 1,
        tool: this.activeTool,
        confidence,
        decisionMs,
        priorResults: Object.keys(this.tubes[tubeIndex].results).length,
      },
    })
    return this.pending
  }

  // ---- 3. action + observation ----
  act(): { tube: number; tool: string; actual: string; predicted: string; match: boolean } {
    const p = this.pending
    if (!p) throw new StateError('Make a prediction first.')
    const tube = this.tubes[p.tube]
    const actedAt = this.now()
    const actual = this.reactionColor(tube.solution, p.tool)
    tube.results[p.tool] = {
      tool: p.tool,
      predicted: p.predicted,
      confidence: p.confidence,
      decisionMs: p.decisionMs,
      predictedAt: p.predictedAt,
      actedAt,
      actual,
      recorded: null,
    }
    this.pending = null
    const match = sameColor(p.predicted, actual)
    this.emit(XapiVerb.ACTED, {
      action: p.tool === PH_TOOL ? 'dip_ph_paper' : 'add_indicator',
      target: `tube:${p.tube + 1}`,
      value: p.tool,
      data: { tube: p.tube + 1, tool: p.tool, msSincePrediction: actedAt - p.predictedAt },
    })
    this.emit(XapiVerb.OBSERVED, {
      action: 'liquid_color',
      target: `tube:${p.tube + 1}`,
      value: actual,
      data: { tube: p.tube + 1, tool: p.tool, predicted: p.predicted, match },
    })
    return { tube: p.tube, tool: p.tool, actual, predicted: p.predicted, match }
  }

  reactionColor(solution: ChemistrySolution, tool: string): string {
    const ind = this.indicator(tool)
    if (!ind) throw new StateError(`Unknown tool ${tool}`)
    if (ind.isPhTest) return phPaperColor(solution.ph)
    const color = ind.colors?.[truthOf(solution)]
    if (!color) throw new StateError(`${ind.name} has no colour for ${solution.type}`)
    return color
  }

  // ---- 4. data entry ----
  recordColor(tubeIndex: number, tool: string, color: string): void {
    const result = this.tubes[tubeIndex]?.results[tool]
    if (!result) throw new StateError('Run this test before recording it.')
    result.recorded = color || null
    if (!color) return
    this.emit(XapiVerb.OBSERVED, {
      action: 'record_color',
      target: `table:tube:${tubeIndex + 1}:${tool}`,
      value: color,
      data: { tube: tubeIndex + 1, tool, actual: result.actual, correct: sameColor(color, result.actual) },
    })
  }

  setConclusion(tubeIndex: number, conclusion: Conclusion): void {
    const tube = this.tubes[tubeIndex]
    if (!tube) throw new StateError('Unknown test tube')
    if (this.phase === 'reveal') throw new StateError('The experiment is finished.')
    if (Object.keys(tube.results).length === 0) throw new StateError('Test this tube before concluding.')
    const before = tube.conclusion
    if (before === conclusion) return
    tube.conclusion = conclusion
    tube.conclusionHistory.push(conclusion)
    const truth = truthOf(tube.solution)
    const evidence = Object.keys(tube.results).filter((k) => k !== PH_TOOL)
    if (before === null) {
      this.emit(XapiVerb.EXPLAINED, {
        action: 'set_conclusion',
        target: `tube:${tubeIndex + 1}`,
        value: conclusion,
        data: { tube: tubeIndex + 1, evidence, correct: conclusion === truth },
      })
    } else {
      this.emit(XapiVerb.REVISED_MODEL, {
        action: 'change_conclusion',
        target: `tube:${tubeIndex + 1}`,
        value: conclusion,
        data: {
          tube: tubeIndex + 1,
          from: before,
          to: conclusion,
          evidence,
          evidenceCount: evidence.length,
          wasCorrect: before === truth,
          nowCorrect: conclusion === truth,
          revisionNumber: tube.conclusionHistory.length - 1,
        },
      })
    }
    this.maybeUnlockPh()
  }

  private maybeUnlockPh() {
    if (this.phase === 'testing' && this.allConcluded && !this.pending) {
      this.phase = 'ph'
      this.activeTool = PH_TOOL
      this.emit(XapiVerb.INVESTIGATED, { action: 'unlock_ph_paper' })
    }
  }

  // ---- 5. pH ----
  recordPh(tubeIndex: number, value: number | null): void {
    const tube = this.tubes[tubeIndex]
    if (!tube) throw new StateError('Unknown test tube')
    if (!tube.results[PH_TOOL]) throw new StateError('Dip pH paper in this tube first.')
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 14)) throw new StateError('pH is between 0 and 14.')
    tube.recordedPh = value
    if (value === null) return
    this.emit(XapiVerb.OBSERVED, {
      action: 'record_ph',
      target: `table:tube:${tubeIndex + 1}:ph`,
      value,
      data: { tube: tubeIndex + 1, actual: tube.solution.ph, offBy: Math.abs(value - tube.solution.ph) },
    })
  }

  // ---- 6. disclosure ----
  submit(): Summary {
    if (!this.canSubmit) throw new StateError('Conclude every tube and record every pH first.')
    this.submitted = true
    this.phase = 'reveal'
    this.activeTool = null
    const summary = this.summary()
    this.emit(XapiVerb.EXPLAINED, {
      action: 'submit_analysis',
      data: {
        summary,
        tubes: this.tubes.map((t) => ({
          tube: t.index + 1,
          solutionId: t.solution.id,
          conclusion: t.conclusion,
          conclusionHistory: t.conclusionHistory,
          truth: truthOf(t.solution),
          recordedPh: t.recordedPh,
          actualPh: t.solution.ph,
          toolsUsed: Object.keys(t.results),
        })),
      },
    })
    return summary
  }

  summary(): Summary {
    let colorEntries = 0
    let colorEntriesCorrect = 0
    let predictions = 0
    let predictionsCorrect = 0
    let phExact = 0
    let phWithinOne = 0
    let conclusionsCorrect = 0
    let revisions = 0
    for (const t of this.tubes) {
      if (t.conclusion === truthOf(t.solution)) conclusionsCorrect++
      revisions += Math.max(0, t.conclusionHistory.length - 1)
      if (t.recordedPh !== null) {
        const d = Math.abs(t.recordedPh - t.solution.ph)
        if (d === 0) phExact++
        if (d <= 1) phWithinOne++
      }
      for (const r of Object.values(t.results)) {
        predictions++
        if (sameColor(r.predicted, r.actual)) predictionsCorrect++
        if (r.tool !== PH_TOOL && r.recorded) {
          colorEntries++
          if (sameColor(r.recorded, r.actual)) colorEntriesCorrect++
        }
      }
    }
    return {
      conclusionsCorrect,
      tubes: this.tubes.length,
      phExact,
      phWithinOne,
      colorEntriesCorrect,
      colorEntries,
      predictionsCorrect,
      predictions,
      revisions,
    }
  }

  get hasStartedTesting(): boolean {
    return this.testingStarted
  }
}
