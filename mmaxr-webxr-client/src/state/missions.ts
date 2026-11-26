import { XapiVerb } from '@mmaxr/schema'
import type { MissionsAnswerResult, MissionsCheckResult, MissionsHintResult, MissionsLessonContract, MissionsMission, MissionsProgress, MissionsQuestion, MissionsSummary, TelemetryEvent } from '@mmaxr/schema'

/**
 * intro: the welcome, before the first mission. build: work on the bench, then Check. questions: the checkpoint
 * questions the mission unlocked, one at a time. done: every mission met and every question answered.
 */
export type Phase = 'intro' | 'build' | 'questions' | 'done'
export type Emit = (verb: XapiVerb, object: TelemetryEvent['object'], at?: number) => void

export class StateError extends Error {}

/** One question's outcome, in the opaque ids the server dealt. */
export interface Feedback {
  correct: boolean
  answer: string
  yourAnswer: string
  explanation: string
}

/**
 * The student's side of a mission lab (MMAXR's lesson flow). It holds no goals or answers: the server checks
 * each build and each answer and says what was right only once it is earned.
 */
export class MissionsRun {
  phase: Phase = 'intro'
  progress: MissionsProgress
  /** Hints shown so far for the current mission, in order. */
  hints: string[] = []
  /** The last "not yet" or refusal shown under the mission. */
  feedback: string | null = null
  questions: MissionsQuestion[] = []
  qIndex = 0
  picked: string | null = null
  answers: Record<string, Feedback> = {}
  summary: MissionsSummary | null = null
  private shownAt = 0

  constructor(
    readonly lesson: MissionsLessonContract,
    progress: MissionsProgress,
    private readonly emit: Emit,
    private readonly now: () => number = Date.now,
  ) {
    this.progress = progress
  }

  get mission(): MissionsMission | null {
    return this.lesson.missions.find((m) => m.id === this.progress.current) ?? null
  }
  get missionIndex(): number {
    const i = this.lesson.missions.findIndex((m) => m.id === this.progress.current)
    return i < 0 ? this.lesson.missions.length : i
  }
  get missionMet(): boolean {
    const m = this.mission
    return !!m && !!this.progress.missions[m.id]?.met
  }
  get hintsLeft(): number {
    const m = this.mission
    return m ? m.hintCount - (this.progress.missions[m.id]?.hintsUsed ?? 0) : 0
  }
  get question(): MissionsQuestion | null {
    return this.phase === 'questions' ? this.questions[this.qIndex] ?? null : null
  }
  get isLastQuestion(): boolean {
    return this.qIndex >= this.questions.length - 1
  }
  get canCheckAnswer(): boolean {
    return !!this.question && !!this.picked && !this.answers[this.question.id]
  }

  /** Pick up where the server says the student is (a reload mid-lab lands here too). */
  resume(unlocked: MissionsQuestion[]) {
    if (this.progress.current === null) {
      this.phase = 'done'
      return
    }
    if (unlocked.length) this.openQuestions(unlocked)
    else if (this.progress.missions[this.progress.current]?.met === false && Object.values(this.progress.missions).some((m) => m.met || m.attempts > 0)) this.startMission()
  }

  startMission() {
    if (!this.mission) throw new StateError('Every mission is done.')
    this.phase = 'build'
    this.hints = []
    this.feedback = null
    this.emit(XapiVerb.INVESTIGATED, { action: 'start_mission', target: `mission:${this.mission.id}`, value: this.missionIndex + 1 })
  }

  recordHint(r: MissionsHintResult) {
    const m = this.mission!
    this.hints.push(r.hint)
    this.progress.missions[m.id] = { ...this.progress.missions[m.id], hintsUsed: r.used }
    this.emit(XapiVerb.INVESTIGATED, { action: 'hint', target: `mission:${m.id}`, value: r.level, data: { hintIndex: r.used - 1 } })
  }

  /** A move the bench refused, with MMAXR's reason. */
  refuse(reason: string) {
    this.feedback = reason
  }

  recordCheck(r: MissionsCheckResult, state: unknown) {
    const m = this.mission!
    this.progress = r.progress
    this.emit(XapiVerb.ACTED, { action: 'check_mission', target: `mission:${m.id}`, value: r.met ? 'met' : 'not_yet', data: { attempts: r.attempts, state } })
    if (!r.met) {
      this.feedback = r.feedback
      return
    }
    this.feedback = null
    this.emit(XapiVerb.OBSERVED, { action: 'mission_complete', target: `mission:${m.id}`, value: r.attempts, data: { hintsUsed: this.progress.missions[m.id]?.hintsUsed ?? 0 } })
  }

  /** Show the questions a met mission unlocked; with none, go straight to the next mission. */
  openQuestions(questions: MissionsQuestion[]) {
    this.questions = questions
    this.qIndex = 0
    this.picked = null
    if (questions.length) {
      this.phase = 'questions'
      this.shownAt = this.now()
    }
  }

  pick(optionId: string) {
    if (!this.question || this.answers[this.question.id]) return
    this.picked = optionId
  }

  answerPayload() {
    const q = this.question
    if (!q || !this.picked) throw new StateError('Choose an answer first.')
    return { question: q.id, choice: this.picked, thinkMs: this.now() - this.shownAt }
  }

  recordAnswer(r: MissionsAnswerResult) {
    const q = this.question!
    this.answers[q.id] = { correct: r.correct, answer: r.answer, yourAnswer: this.picked!, explanation: r.explanation }
    this.progress = r.progress
    this.emit(XapiVerb.ACTED, { action: 'quiz_answer', target: `question:${q.id}`, value: r.correct ? 'correct' : 'wrong', data: { tool: 'quiz', match: r.correct, decisionMs: this.now() - this.shownAt } })
  }

  /** After a question: the next one, or the next mission, or the end. Returns what comes next. */
  next(): 'question' | 'mission' | 'finish' {
    if (!this.isLastQuestion) {
      this.qIndex += 1
      this.picked = null
      this.shownAt = this.now()
      return 'question'
    }
    this.questions = []
    if (this.progress.current === null) return 'finish'
    this.startMission()
    return 'mission'
  }

  finish(summary: MissionsSummary) {
    this.summary = summary
    this.phase = 'done'
    this.emit(XapiVerb.EXPLAINED, { action: 'submit_analysis', data: { missions: summary.missions, hintsUsed: summary.hintsUsed, attempts: summary.attempts, quizCorrect: summary.correct, quizTotal: summary.total } })
  }
}
