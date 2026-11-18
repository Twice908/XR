import { PH_TOOL, type ChemistryExperiment } from '../state/chemistry'
import type { Snapshot } from '../services/aiCoach'
import { sameColor } from '../services/colors'

/**
 * What the coach is told: only things already on the student's screen. The coach service reads the hidden
 * answers itself from the lesson service, so none of that passes through the browser.
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

export const describe = {
  mismatch: (tube: number, tool: string, predicted: string, observed: string) => `On tube ${tube} the student predicted ${predicted} with ${tool}, but it turned ${observed}.`,
  revision: (tube: number, from: string, to: string) => `The student changed their conclusion for tube ${tube} from ${from} to ${to}.`,
  phUnlocked: 'Every tube now has a conclusion, so the pH paper is unlocked.',
  ready: 'Everything is filled in and the student can submit.',
  idle: 'The student has not done anything for a while.',
}
