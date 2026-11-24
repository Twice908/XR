import type { Snapshot } from '../services/aiCoach'
import { IMAGE_FIELDS, type OpticsExperiment } from '../state/optics'

const label = (exp: OpticsExperiment, field: string, id: string | undefined) => (id ? (exp.lesson.imageFields as Record<string, { id: string; label: string }[]>)[field]?.find((o) => o.id === id)?.label ?? id : '–')

/** Student-visible state of the optics lab as plain lines. Nothing here the student has not already been shown. */
export function buildOpticsSnapshot(exp: OpticsExperiment): Snapshot {
  const lines: string[] = [`Experiments run: ${exp.answered} of ${exp.items.length}. Revisions to the table so far: ${exp.revisions}.`]
  const outcome = (kind: 'plane' | 'law' | 'rule', id: string | undefined) => [...exp.lesson.planeMirror.predictionOptions, ...exp.lesson.lawsOfReflection.laws.flatMap((l) => l.options), ...exp.lesson.rayRules.outcomes].find((o) => o.id === id)?.label ?? id ?? '–'
  for (const t of exp.items) {
    if (!t.prediction) continue
    const seen = t.result
    if (t.kind === 'case') {
      const said = IMAGE_FIELDS.map((f) => label(exp, f, t.prediction![f])).join(', ')
      if (!seen) lines.push(`${t.title}: predicted ${said} (not run yet).`)
      else {
        const wrong = IMAGE_FIELDS.filter((f) => seen.fields && !seen.fields[f])
        lines.push(`${t.title}: predicted ${said}; ${seen.match ? 'all four parts matched' : `${wrong.map((f) => f).join(' and ')} did not match`}${t.explained ? `; explained: "${t.explained.text}"` : ''}.`)
      }
    } else {
      lines.push(`${t.title}: predicted "${outcome(t.kind as 'plane' | 'law' | 'rule', t.prediction.outcome)}"${seen ? (seen.match ? ' (as predicted)' : ' (not as predicted)') : ' (not run yet)'}.`)
    }
  }
  return { phase: exp.phase, tools: [], activeTool: exp.pending?.title ?? null, tubes: [], lines, claims: [] }
}

export const say = {
  mismatch: (title: string, parts: string) => `For "${title}" the student predicted wrongly on: ${parts}. Ask what they were picturing.`,
  anomaly: 'The student has just seen that the rays from a candle at the focus leave parallel, which broke their pattern.',
  revision: (title: string, field: string, from: string, to: string) => `The student changed ${field} for "${title}" from "${from}" to "${to}" after seeing the trace.`,
  ready: 'Every experiment is run and the table is complete, so the student can lock it in.',
  idle: 'The student has not done anything for a while.',
}
