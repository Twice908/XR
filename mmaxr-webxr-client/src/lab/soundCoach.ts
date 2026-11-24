import type { Snapshot } from '../services/aiCoach'
import type { SoundExperiment } from '../state/sound'

/** Student-visible state of the sound lab as plain lines. Nothing here the student has not already been shown. */
export function buildSoundSnapshot(exp: SoundExperiment): Snapshot {
  const lines = [`Tasks finished: ${exp.answered} of ${exp.items.length}. Tab open: ${exp.tab}.`]
  for (const t of exp.items) {
    if (!t.prediction) continue
    const said = t.task.predictionOptions.find((o) => o.id === t.prediction)?.label ?? ''
    const seen = t.result ? (t.result.match ? ' (as predicted)' : ' (not as predicted)') : ' (not run yet)'
    const calc = t.result?.hasCalc ? `; calculation tries: ${t.calc.attempts}${t.calc.ok ? ', accepted' : ''}` : ''
    lines.push(`${t.tabName}, task ${t.sample}: predicted "${said}"${seen}${calc}${t.explained ? `; explained: "${t.explained.text}"` : ''}.`)
  }
  return { phase: exp.phase, tools: [], activeTool: exp.pending?.task.prompt.slice(0, 80) ?? null, tubes: [], lines, claims: [] }
}

export const say = {
  mismatch: (prompt: string) => `The student's prediction for "${prompt.slice(0, 90)}" did not match what the instruments showed. Ask what they were picturing.`,
  anomaly: 'The student has just seen the wavelength shrink when the frequency went up while the wave speed stayed the same, which went against their expectation.',
  calc: (tries: number) => `The student has tried the calculation ${tries} times and it is still not right. Ask what the pulse or sound actually travels.`,
  ready: 'Every task is run, calculated and explained, so the student can finish.',
  idle: 'The student has not done anything for a while.',
}
