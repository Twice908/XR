import type { Snapshot } from '../services/aiCoach'
import type { MotionExperiment, TrialState } from '../state/motion'

const label = (t: TrialState): string => {
  const v = t.trial.input
  if (v.type === 'choice') return v.options.find((o) => o.id === t.choice)?.label ?? 'nothing yet'
  return v.fields.map((f) => `${f.label} ${t.numbers[f.id] || '?'} ${f.unit}`).join(', ')
}

/** What the coach may know: the questions, the student's predictions, and (once watched) how they compared. */
export function buildMotionSnapshot(exp: MotionExperiment): Snapshot {
  const lines = [`The student is in the “${exp.scenario.title}” module. ${exp.doneCount} of ${exp.trials.length} questions finished.`]
  for (const t of exp.trials) {
    if (t.stage === 'open' && !t.confidence) continue
    const conf = t.confidence ? ` (${['', 'a guess', 'fairly sure', 'certain'][t.confidence]})` : ''
    const result = t.observation ? (t.observation.match ? 'prediction matched what happened' : 'prediction did not match what happened') : t.stage === 'running' ? 'the experiment is running' : 'result not seen yet'
    const said = t.explanation ? ` They explained: "${t.explanation.slice(0, 280)}".` : ''
    lines.push(`Question ${t.n} (${t.trial.prompt}) — predicted ${label(t)}${conf}; ${result}.${said}`)
  }
  return { phase: exp.allDone ? 'done' : exp.current.stage, tools: [], activeTool: null, tubes: [], lines }
}

export const say = {
  mismatch: (n: number) => `For question ${n} the student's prediction did not match what they just watched.`,
  explained: (n: number) => `The student wrote an explanation for question ${n}.`,
  done: 'The student has answered every question in the sandbox.',
  idle: 'The student has not done anything for a while.',
}
