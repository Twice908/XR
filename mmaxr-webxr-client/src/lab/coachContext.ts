import { PH_TOOL, truthOf, type ChemistryExperiment } from '../state/chemistry'
import type { SecretTube, Snapshot, TruthTube } from '../services/aiCoach'
import { sameColor } from '../services/colors'

/**
 * What the coach is allowed to know while the lab is running: only things already on the student's screen.
 * The hidden answers are sent separately and only to the coach's deterministic answer guard.
 */
export function buildSnapshot(exp: ChemistryExperiment): Snapshot {
  const name = (tool: string) => (tool === PH_TOOL ? 'universal pH paper' : (exp.indicator(tool)?.name ?? tool))
  return {
    phase: exp.phase,
    tools: exp.chosen.map(name),
    activeTool: exp.activeTool ? name(exp.activeTool) : null,
    tubes: exp.tubes.map((t) => ({
      n: t.index + 1,
      tests: Object.values(t.results).map((r) => ({
        tool: name(r.tool),
        predicted: r.predicted,
        observed: r.actual,
        matched: sameColor(r.predicted, r.actual),
        recorded: r.recorded,
      })),
      conclusion: t.conclusion,
      revisions: Math.max(0, t.conclusionHistory.length - 1),
      recordedPh: t.recordedPh,
    })),
  }
}

export function buildSecrets(exp: ChemistryExperiment): SecretTube[] {
  return exp.tubes.map((t) => ({ tube: t.index + 1, terms: [t.solution.name, t.solution.formula], verdict: truthOf(t.solution), ph: t.solution.ph }))
}

export function buildTruth(exp: ChemistryExperiment): TruthTube[] {
  return exp.tubes.map((t) => ({ tube: t.index + 1, name: t.solution.name, formula: t.solution.formula, type: truthOf(t.solution), ph: t.solution.ph }))
}

export const describe = {
  mismatch: (tube: number, tool: string, predicted: string, observed: string) => `On tube ${tube} the student predicted ${predicted} with ${tool}, but it turned ${observed}.`,
  revision: (tube: number, from: string, to: string) => `The student changed their conclusion for tube ${tube} from ${from} to ${to}.`,
  phUnlocked: 'Every tube now has a conclusion, so the pH paper is unlocked.',
  ready: 'Everything is filled in and the student can submit.',
  idle: 'The student has not done anything for a while.',
}
