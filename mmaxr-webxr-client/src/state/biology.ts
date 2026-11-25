import { XapiVerb } from '@mmaxr/schema'
import type { BiologyCheckpoint, BiologyFinalResult, BiologyLessonContract, BiologyQuizFeedback, BiologyQuizQuestion, TelemetryEvent } from '@mmaxr/schema'

/** tour: walk the organs (view-only). quiz: a few questions, one at a time. final: the closing explanation. */
export type Stage = 'tour' | 'quiz' | 'final' | 'done'
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object'], at?: number) => void

export interface Stop {
  cp: BiologyCheckpoint
  /** True once the student has watched the animation for this stop. */
  watched: boolean
}

export class StateError extends Error {}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** The student's side of the guided journey. It holds no answers: feedback arrives from the server per question. */
export class JourneyExperiment {
  stage: Stage = 'tour'
  index = 0
  readonly stops: Stop[]
  /** Dealt by the server once the tour is finished. */
  questions: BiologyQuizQuestion[] = []
  quizIndex = 0
  /** The option the student has picked for the current question, before checking it. */
  picked: string | null = null
  feedback: Record<string, BiologyQuizFeedback> = {}
  finalResult: BiologyFinalResult | null = null
  /** The closing explain-back. */
  finalText = ''
  finalMode: 'voice' | 'typed' = 'typed'
  finalSpeakMs = 0
  private shownAt = 0

  constructor(
    readonly lesson: BiologyLessonContract,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    this.stops = lesson.checkpoints.map((cp) => ({ cp, watched: false }))
    this.emit(XapiVerb.INVESTIGATED, { action: 'arrive_checkpoint', target: this.stop.cp.id, value: 1 })
  }

  get stop(): Stop {
    return this.stops[Math.min(this.index, this.stops.length - 1)]
  }
  get n(): number {
    return this.index + 1
  }
  get isLastStop(): boolean {
    return this.index === this.stops.length - 1
  }
  get question(): BiologyQuizQuestion | null {
    return this.stage === 'quiz' ? this.questions[this.quizIndex] ?? null : null
  }
  get isLastQuestion(): boolean {
    return this.quizIndex >= this.questions.length - 1
  }
  get quizCorrect(): number {
    return Object.values(this.feedback).filter((f) => f.correct).length
  }

  // ---- tour ----
  markWatched(): void {
    if (this.stage !== 'tour' || this.stop.watched) return
    this.stop.watched = true
    this.emit(XapiVerb.OBSERVED, { action: 'watch_animation', target: `checkpoint:${this.stop.cp.id}`, value: 'watched', data: { sample: this.n } })
  }

  /** Moves on after a stop. Returns true when that was the last one, so the quiz should be fetched. */
  nextStop(): boolean {
    if (this.stage !== 'tour') throw new StateError('The tour is over.')
    if (this.isLastStop) {
      this.emit(XapiVerb.INVESTIGATED, { action: 'finish_tour', value: this.stops.length })
      return true
    }
    this.index += 1
    this.emit(XapiVerb.INVESTIGATED, { action: 'arrive_checkpoint', target: this.stop.cp.id, value: this.n })
    return false
  }

  // ---- quiz ----
  startQuiz(questions: BiologyQuizQuestion[], answered: string[] = []): void {
    this.questions = questions
    this.quizIndex = Math.max(0, questions.findIndex((q) => !answered.includes(q.id)))
    this.picked = null
    this.stage = questions.length ? 'quiz' : 'final'
    this.shownAt = this.now()
    this.emit(XapiVerb.INVESTIGATED, { action: 'start_quiz', value: questions.length })
  }

  pick(optionId: string): void {
    const q = this.question
    if (!q || this.feedback[q.id]) throw new StateError('This question is already answered.')
    if (!q.options.some((o) => o.id === optionId)) throw new StateError('Pick one of the options.')
    this.picked = optionId
  }

  get canCheck(): boolean {
    const q = this.question
    return !!q && this.picked !== null && !this.feedback[q.id]
  }

  checkPayload() {
    if (!this.canCheck) throw new StateError('Pick an answer first.')
    return { question: this.question!.id, choice: this.picked!, thinkMs: Math.max(0, this.now() - this.shownAt) }
  }

  recordFeedback(f: BiologyQuizFeedback): void {
    const q = this.question
    if (!q) return
    this.feedback[q.id] = f
    this.emit(XapiVerb.ACTED, { action: 'quiz_answer', target: `question:${q.id}`, value: f.correct ? 'correct' : 'wrong', data: { sample: this.quizIndex + 1, tool: 'quiz', match: f.correct, decisionMs: this.now() - this.shownAt } })
  }

  nextQuestion(): void {
    const q = this.question
    if (!q || !this.feedback[q.id]) throw new StateError('Check your answer first.')
    this.picked = null
    this.shownAt = this.now()
    if (this.isLastQuestion) {
      this.stage = 'final'
      this.emit(XapiVerb.INVESTIGATED, { action: 'start_challenge' })
      return
    }
    this.quizIndex += 1
  }

  // ---- final explanation ----
  get canSubmitFinal(): boolean {
    const fe = this.lesson.finalExplain
    return this.stage === 'final' && (!fe || wordCount(this.finalText) >= fe.minWords)
  }

  finalPayload() {
    return { explanation: this.finalText.trim(), inputMode: this.finalMode, speakMs: this.finalSpeakMs }
  }

  finish(result: BiologyFinalResult): void {
    if (this.stage === 'done') return
    this.finalResult = result
    this.stage = 'done'
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_final', data: { answered: Object.keys(this.feedback).length, ...(this.lesson.finalExplain ? { words: wordCount(this.finalText), inputMode: this.finalMode, coverage: result.explain?.coverage ?? null } : {}) } })
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { checkpoints: this.stops.length, quizCorrect: result.correct, quizTotal: result.total } })
  }

  summary() {
    return {
      stops: this.stops.length,
      watched: this.stops.filter((s) => s.watched).length,
      quizCorrect: this.finalResult?.correct ?? this.quizCorrect,
      quizTotal: this.finalResult?.total ?? this.questions.length,
      finalCoverage: this.finalResult?.explain?.coverage ?? null,
    }
  }
}
