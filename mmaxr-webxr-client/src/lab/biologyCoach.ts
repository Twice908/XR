import type { Snapshot } from '../services/aiCoach'
import type { JourneyExperiment } from '../state/biology'

/** What the coach may know: where the student is, what they have been taught, and the quiz answers they have already given. */
export function buildBiologySnapshot(exp: JourneyExperiment): Snapshot {
  const lines = [`Stage: ${exp.stage}. The student is on stop ${Math.min(exp.n, exp.stops.length)} of ${exp.stops.length}.`]
  exp.stops.forEach((s, i) => {
    if (i > exp.index && exp.stage === 'tour') return
    lines.push(`Stop ${i + 1} (${s.cp.organName}): ${s.cp.explanation}`)
  })
  if (exp.stage === 'quiz' || exp.stage === 'final' || exp.stage === 'done') {
    exp.questions.forEach((q, i) => {
      const f = exp.feedback[q.id]
      if (f) lines.push(`Quiz ${i + 1} (${q.organ}): "${q.prompt}" — answered ${f.correct ? 'correctly' : 'wrongly'}.`)
      else if (i === exp.quizIndex && exp.stage === 'quiz') lines.push(`Quiz ${i + 1} (${q.organ}): "${q.prompt}" — not answered yet.`)
    })
  }
  return { phase: exp.stage, tools: [], activeTool: null, tubes: [], lines }
}

export const say = {
  wrong: (organ: string) => `The student got the quiz question about the ${organ} wrong.`,
  ready: 'The student has finished the quiz and is about to explain the whole pathway.',
  idle: 'The student has not done anything for a while.',
}
