import type { Snapshot } from '../services/aiCoach'
import type { JourneyExperiment } from '../state/biology'

/** What the coach may know: the questions, and the student's own predictions and words. Revealed stops include what was missed. */
export function buildBiologySnapshot(exp: JourneyExperiment): Snapshot {
  const label = (g: 'glands' | 'juices' | 'components' | 'nutrients', ids: string[]) => ids.map((id) => exp.lesson.choices[g].find((o) => o.id === id)?.label ?? id).join(', ')
  const lines = [`Stage: ${exp.stage}. The student is on stop ${Math.min(exp.n, exp.stops.length)} of ${exp.stops.length}.`]
  exp.stops.forEach((s, i) => {
    if (i > exp.index && exp.stage !== 'final' && exp.stage !== 'done') return
    const sel = s.selection.glands.length ? `predicted glands: ${label('glands', s.selection.glands)}; juices: ${label('juices', s.selection.juices)}; enzymes/chemicals: ${label('components', s.selection.components)}; nutrients: ${label('nutrients', s.selection.nutrients)}${s.confidence ? ` (${['', 'a guess', 'fairly sure', 'certain'][s.confidence]})` : ''}` : 'no prediction yet'
    const said = s.explanation ? `explained: "${s.explanation.slice(0, 280)}"` : 'no explanation yet'
    const rev = s.reveal ? `revealed; they covered ${Math.round(s.coverage * 100)}% of the key ideas${s.reveal.keywords.some((k) => !k.matched) ? `, missing: ${s.reveal.keywords.filter((k) => !k.matched).map((k) => k.keyword).join(', ')}` : ''}` : 'not yet revealed'
    lines.push(`Stop ${i + 1} (${s.cp.organName}): question: "${s.cp.prompt}" — ${sel}; ${said}; ${rev}.`)
  })
  return { phase: exp.stage, tools: [], activeTool: null, tubes: [], lines }
}

export const say = {
  mismatch: (organ: string) => `At the ${organ} stop the student's prediction or explanation was not fully right once the answer was revealed.`,
  revision: (organ: string) => `The student improved their explanation for the ${organ} stop after seeing the reveal.`,
  ready: 'The student has finished every stop and is about to try the final challenge.',
  idle: 'The student has not done anything for a while.',
}
