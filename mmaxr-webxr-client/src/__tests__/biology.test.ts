import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { BiologyLessonContract, BiologyQuizFeedback, BiologyQuizQuestion, TelemetryEvent } from '@mmaxr/schema'
import { JourneyExperiment, StateError } from '../state/biology'

const v = { x: 0, y: 0, z: 0 }
const lesson: BiologyLessonContract = {
  lessonId: 'biology-101',
  type: 'biology_digestive_system',
  title: 'Digestive system',
  modelUrl: 'http://x/d.glb',
  assets: { digestiveSystem: 'a' },
  config: { isGuidedTour: true, requireAudioExplanation: true, minExplanationWords: 4, quizSize: 2 },
  finalExplain: { prompt: 'Explain it all', minWords: 4 },
  checkpoints: [
    { id: 'mouth', organName: 'Mouth', cameraPosition: v, lookAtTarget: v, modelAnchor: v, detail: 'tooth', explanation: 'Chewing and saliva.', animLabels: ['Saliva'] },
    { id: 'stomach', organName: 'Stomach', cameraPosition: v, lookAtTarget: v, modelAnchor: v, detail: 'stomach', explanation: 'Acid and pepsin.', animLabels: ['HCl'] },
  ],
}
const questions: BiologyQuizQuestion[] = [
  { id: 'q1', organ: 'Stomach', prompt: 'p1', options: [{ id: 'p0', label: 'A' }, { id: 'p1', label: 'B' }, { id: 'p2', label: 'C' }, { id: 'p3', label: 'D' }] },
  { id: 'q2', organ: 'Mouth', prompt: 'p2', options: [{ id: 'p0', label: 'A' }, { id: 'p1', label: 'B' }] },
]
const fb = (correct: boolean, answered: number): BiologyQuizFeedback => ({ correct, answer: 'p1', yourAnswer: correct ? 'p1' : 'p0', explanation: 'because', answered, total: 2 })

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new JourneyExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 800))
  return { exp, events }
}

describe('JourneyExperiment (tour, quiz, final)', () => {
  it('starts on the first stop of a view-only tour', () => {
    const { exp, events } = setup()
    expect(exp.stage).toBe('tour')
    expect(exp.stop.cp.id).toBe('mouth')
    expect(events[0].object.action).toBe('arrive_checkpoint')
  })

  it('records a watched animation once', () => {
    const { exp, events } = setup()
    exp.markWatched()
    exp.markWatched()
    expect(exp.stop.watched).toBe(true)
    expect(events.filter((e) => e.object.action === 'watch_animation')).toHaveLength(1)
  })

  it('moves through the stops, then asks for the quiz after the last', () => {
    const { exp } = setup()
    expect(exp.nextStop()).toBe(false)
    expect(exp.stop.cp.id).toBe('stomach')
    expect(exp.isLastStop).toBe(true)
    expect(exp.nextStop()).toBe(true)
    expect(exp.stage).toBe('tour')
  })

  it('shows one question at a time and needs a pick before checking', () => {
    const { exp } = setup()
    exp.startQuiz(questions)
    expect(exp.stage).toBe('quiz')
    expect(exp.question?.id).toBe('q1')
    expect(exp.canCheck).toBe(false)
    expect(() => exp.checkPayload()).toThrow(StateError)
    expect(() => exp.pick('p9')).toThrow(StateError)
    exp.pick('p2')
    expect(exp.canCheck).toBe(true)
    expect(exp.checkPayload()).toMatchObject({ question: 'q1', choice: 'p2' })
  })

  it('locks a question once feedback arrives and cannot move on before it', () => {
    const { exp, events } = setup()
    exp.startQuiz(questions)
    expect(() => exp.nextQuestion()).toThrow(StateError)
    exp.pick('p0')
    exp.recordFeedback(fb(false, 1))
    expect(() => exp.pick('p1')).toThrow(StateError)
    expect(events.find((e) => e.object.action === 'quiz_answer')?.object.value).toBe('wrong')
    exp.nextQuestion()
    expect(exp.question?.id).toBe('q2')
    expect(exp.picked).toBeNull()
  })

  it('resumes at the first unanswered question', () => {
    const { exp } = setup()
    exp.startQuiz(questions, ['q1'])
    expect(exp.question?.id).toBe('q2')
  })

  it('goes to the final explanation after the last question, which needs enough words', () => {
    const { exp } = setup()
    exp.startQuiz(questions)
    exp.pick('p1'); exp.recordFeedback(fb(true, 1)); exp.nextQuestion()
    exp.pick('p1'); exp.recordFeedback(fb(true, 2)); exp.nextQuestion()
    expect(exp.stage).toBe('final')
    expect(exp.canSubmitFinal).toBe(false)
    exp.finalText = 'one two three four'
    expect(exp.canSubmitFinal).toBe(true)
    expect(exp.finalPayload()).toMatchObject({ explanation: 'one two three four', inputMode: 'typed' })
    exp.finish({ correct: 2, total: 2, explain: { coverage: 0.8, keywords: [], modelAnswer: 'm' } })
    expect(exp.stage).toBe('done')
    expect(exp.summary()).toMatchObject({ quizCorrect: 2, quizTotal: 2, finalCoverage: 0.8 })
  })

  it('holds no answers of its own: questions carry wording and options only', () => {
    expect(JSON.stringify(questions)).not.toMatch(/answer|correct/)
  })

  it('skips the quiz when there are no questions', () => {
    const { exp } = setup()
    exp.startQuiz([])
    expect(exp.stage).toBe('final')
  })
})
