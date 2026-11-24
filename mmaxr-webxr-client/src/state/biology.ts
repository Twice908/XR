import { XapiVerb } from '@mmaxr/schema'
import type { BiologyCheckpoint, BiologyFinalResult, BiologyGroup, BiologyLessonContract, BiologyReveal, TelemetryEvent } from '@mmaxr/schema'

export type Stage = 'predict' | 'explain' | 'revealed' | 'final' | 'done'
export type Confidence = 1 | 2 | 3
/** A question group key. Each lesson names its own (digestive: glands, juices ...; respiratory: organs, features ...). */
export type Group = string
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object']) => void

export type Selection = Record<string, string[]>

export interface Stop {
  cp: BiologyCheckpoint
  selection: Selection
  confidence: Confidence | null
  explanation: string
  inputMode: 'voice' | 'typed'
  speakMs: number
  thinkMs: number
  reveal: BiologyReveal | null
  revisions: number
  /** Best keyword coverage so far, including revisions. */
  coverage: number
}

/** Digestive lessons predate `groups`; this is what they ask. */
export const DEFAULT_GROUPS: BiologyGroup[] = [
  { key: 'glands', question: 'Which glands act here?' },
  { key: 'juices', question: 'Which digestive juices?' },
  { key: 'components', question: 'Which enzymes or chemicals are in them?' },
  { key: 'nutrients', question: 'Which nutrients are being worked on?' },
]
export const groupsOf = (lesson: { groups?: BiologyGroup[] }): BiologyGroup[] => (lesson.groups?.length ? lesson.groups : DEFAULT_GROUPS)

export class StateError extends Error {}

/** Small seeded generator so a shuffled order stays put while the HUD re-renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hashString = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Fisher-Yates with a seeded generator. Entries flagged `last` (the "none" choice) stay at the end. */
export function shuffleOptions<T extends { id: string }>(items: T[], seed: string, keepLast: (o: T) => boolean = (o) => o.id === 'none'): T[] {
  const rnd = mulberry32(hashString(seed))
  const pool = items.filter((o) => !keepLast(o))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return [...pool, ...items.filter(keepLast)]
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** The student's side of the guided journey. It holds no answers: the reveal arrives from the server per stop. */
export class JourneyExperiment {
  stage: Stage = 'predict'
  index = 0
  readonly stops: Stop[]
  scenarioAnswers: Record<string, string> = {}
  finalResult: BiologyFinalResult | null = null
  /** The closing explain-back, when the lesson has one. */
  finalText = ''
  finalMode: 'voice' | 'typed' = 'typed'
  finalSpeakMs = 0
  private arrivedAt: number
  private predictedAt = 0
  /** Fresh for every run, so the option order differs between attempts and between stops. */
  private readonly seed = String(Math.random())

  constructor(
    readonly lesson: BiologyLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    this.stops = lesson.checkpoints.map((cp) => ({ cp, selection: Object.fromEntries(groupsOf(lesson).map((g) => [g.key, [] as string[]])), confidence: null, explanation: '', inputMode: 'typed', speakMs: 0, thinkMs: 0, reveal: null, revisions: 0, coverage: 0 }))
    this.arrivedAt = this.now()
    this.emit(XapiVerb.INVESTIGATED, { action: 'arrive_checkpoint', target: this.stop.cp.id, value: 1 })
  }

  /** The answer pool for a group in this stop's own random order. Stable until the next stop. */
  optionsFor(group: Group, stopIndex = this.index) {
    const id = this.stops[Math.min(stopIndex, this.stops.length - 1)].cp.id
    return shuffleOptions(this.lesson.choices[group], `${this.seed}|${id}|${group}`)
  }
  /** Scenario options, shuffled once per run. */
  scenarioOptions(scenarioId: string) {
    const sc = this.lesson.transfer.scenarios.find((x) => x.id === scenarioId)
    return sc ? shuffleOptions(sc.options, `${this.seed}|${scenarioId}`, () => false) : []
  }

  get groups(): BiologyGroup[] {
    return groupsOf(this.lesson)
  }

  get stop(): Stop {
    return this.stops[Math.min(this.index, this.stops.length - 1)]
  }
  get minWords(): number {
    return this.lesson.config.minExplanationWords
  }
  get maxRevisions(): number {
    return this.lesson.config.maxRevisions
  }
  get n(): number {
    return this.index + 1
  }
  get isLastStop(): boolean {
    return this.index === this.stops.length - 1
  }

  // ---- predict ----
  toggle(group: Group, id: string): void {
    if (this.stage !== 'predict') throw new StateError('Your prediction is already locked in.')
    const list = this.stop.selection[group]
    const at = list.indexOf(id)
    // "none" excludes everything else in that group.
    if (id === 'none') this.stop.selection[group] = at >= 0 ? [] : ['none']
    else if (at >= 0) list.splice(at, 1)
    else this.stop.selection[group] = [...list.filter((x) => x !== 'none'), id]
  }

  setConfidence(c: Confidence): void {
    if (this.stage !== 'predict') throw new StateError('Your prediction is already locked in.')
    this.stop.confidence = c
  }

  get canLock(): boolean {
    const s = this.stop
    return this.stage === 'predict' && this.groups.every((g) => s.selection[g.key].length > 0) && s.confidence !== null
  }

  lockPrediction(): void {
    if (!this.canLock) throw new StateError('Choose at least one option in every group, then say how sure you are.')
    const s = this.stop
    this.predictedAt = this.now()
    s.thinkMs = this.predictedAt - this.arrivedAt
    this.stage = 'explain'
    this.emit(XapiVerb.PREDICTED, {
      action: 'predict_selection',
      target: `checkpoint:${s.cp.id}`,
      value: this.groups.flatMap((g) => s.selection[g.key]).join(','),
      data: { sample: this.n, tool: 'explain', checkpoint: s.cp.id, confidence: s.confidence, decisionMs: s.thinkMs, groups: this.groups.map((g) => g.key), ...s.selection },
    })
  }

  // ---- explain + reveal ----
  canCommit(text: string): boolean {
    return this.stage === 'explain' && wordCount(text) >= this.minWords
  }

  commitPayload(text: string, inputMode: 'voice' | 'typed', speakMs: number) {
    if (!this.canCommit(text)) throw new StateError(`Explain it in at least ${this.minWords} words.`)
    const s = this.stop
    s.explanation = text.trim()
    s.inputMode = inputMode
    s.speakMs = speakMs
    return { checkpoint: s.cp.id, selection: s.selection, explanation: s.explanation, confidence: s.confidence, inputMode, thinkMs: s.thinkMs, speakMs }
  }

  /** Called with the server's reveal. Only now does the client learn the right answer for this stop. */
  recordReveal(reveal: BiologyReveal): void {
    const s = this.stop
    s.reveal = reveal
    s.coverage = reveal.coverage
    this.stage = 'revealed'
    const at = this.now()
    this.emit(XapiVerb.ACTED, { action: 'commit_explanation', target: `checkpoint:${s.cp.id}`, value: 'explain', data: { sample: this.n, tool: 'explain', msSincePrediction: at - this.predictedAt, words: wordCount(s.explanation), inputMode: s.inputMode, speakMs: s.speakMs } })
    this.emit(XapiVerb.OBSERVED, {
      action: 'reveal_shown',
      target: `checkpoint:${s.cp.id}`,
      value: reveal.selectionScore.allCorrect ? 'correct' : 'partly',
      // "Match" = the student's understanding held up: the right selections and at least half the key ideas.
      data: { sample: this.n, tool: 'explain', match: reveal.selectionScore.allCorrect && reveal.coverage >= 0.5, coverage: reveal.coverage, selection: reveal.selectionScore },
    })
  }

  get canRevise(): boolean {
    return this.stage === 'revealed' && this.stop.revisions < this.maxRevisions && !!this.stop.reveal && this.stop.coverage < 1
  }

  recordRevision(text: string, coverage: number, revisions: number): void {
    const s = this.stop
    const before = s.coverage
    s.revisions = revisions
    s.coverage = Math.max(s.coverage, coverage)
    this.emit(XapiVerb.REVISED_MODEL, { action: 'revise_explanation', target: `checkpoint:${s.cp.id}`, value: coverage, data: { sample: this.n, checkpoint: s.cp.id, coverageBefore: before, coverageAfter: coverage, revision: revisions, words: wordCount(text) } })
  }

  next(): void {
    if (this.stage !== 'revealed') throw new StateError('Answer this stop first.')
    if (this.isLastStop) {
      this.stage = 'final'
      this.emit(XapiVerb.INVESTIGATED, { action: 'start_challenge' })
      return
    }
    this.index += 1
    this.stage = 'predict'
    this.arrivedAt = this.now()
    this.emit(XapiVerb.INVESTIGATED, { action: 'arrive_checkpoint', target: this.stop.cp.id, value: this.n })
  }

  // ---- final challenge ----
  get canSubmitFinal(): boolean {
    const fe = this.lesson.finalExplain
    return this.stage === 'final' && this.lesson.transfer.scenarios.every((s) => this.scenarioAnswers[s.id]) && (!fe || wordCount(this.finalText) >= fe.minWords)
  }

  finalPayload() {
    return { answers: this.scenarioAnswers, explanation: this.finalText.trim(), inputMode: this.finalMode, speakMs: this.finalSpeakMs }
  }

  finish(result: BiologyFinalResult): void {
    if (this.stage === 'done') return
    this.finalResult = result
    this.stage = 'done'
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_final', data: { answered: Object.keys(this.scenarioAnswers).length, ...(this.lesson.finalExplain ? { words: wordCount(this.finalText), inputMode: this.finalMode, coverage: result.explain?.coverage ?? null } : {}) } })
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { checkpoints: this.stops.length, revisions: this.stops.reduce((a, s) => a + s.revisions, 0) } })
  }

  summary() {
    const stops = this.stops
    return {
      selectionsRight: stops.filter((s) => s.reveal?.selectionScore.allCorrect).length,
      stops: stops.length,
      avgCoverage: stops.length ? stops.reduce((a, s) => a + (s.reveal?.coverage ?? 0), 0) / stops.length : 0,
      bestCoverage: stops.length ? stops.reduce((a, s) => a + s.coverage, 0) / stops.length : 0,
      revisions: stops.reduce((a, s) => a + s.revisions, 0),
      challengeCorrect: this.finalResult?.correct ?? 0,
      challengeTotal: this.finalResult?.total ?? this.lesson.transfer.scenarios.length,
      finalCoverage: this.finalResult?.explain?.coverage ?? null,
    }
  }
}
