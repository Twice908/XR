import type { Snapshot } from '../services/aiCoach'
import type { MetalsExperiment } from '../state/metals'

/** Student-visible state of the metals lab, as plain lines the coach can read. No names, types or hidden results. */
export function buildMetalsSnapshot(exp: MetalsExperiment): Snapshot {
  const label = (tool: string, id: string) => exp.tool(tool)?.outcomes.find((o) => o.id === id)?.label ?? id
  const lines = [`Tests used: ${exp.used} of ${exp.budget}.`]
  for (const s of exp.samples) {
    const bits = Object.values(s.results).map((r) => {
      const t = exp.tool(r.tool)
      return `${t?.property ?? r.tool}: predicted "${label(r.tool, r.predicted)}", saw "${label(r.tool, r.actual)}"${r.predicted === r.actual ? ' (as predicted)' : ' (not as predicted)'}${r.recorded ? `, wrote "${label(r.tool, r.recorded)}"` : ''}`
    })
    const call = s.conclusion ? `currently calls it ${s.conclusion}${s.conclusionHistory.length > 1 ? ` after changing their mind ${s.conclusionHistory.length - 1} time${s.conclusionHistory.length > 2 ? 's' : ''}` : ''}` : 'no call yet'
    const first = s.hypothesis ? `first impression ${s.hypothesis}` : 'no first impression'
    lines.push(`Sample ${s.index + 1} (${s.look.color}, ${s.look.lustre}, ${s.look.state}): ${first}; ${call}; ${bits.length ? bits.join('; ') : 'untested'}.`)
  }
  return { phase: exp.phase, tools: [], activeTool: exp.activeTool ? (exp.tool(exp.activeTool)?.name ?? null) : null, tubes: [], lines, claims: exp.samples.filter((s) => s.conclusion).map((s) => ({ n: s.index + 1, verdict: s.conclusion as string })) }
}

export const say = {
  mismatch: (n: number, tool: string, predicted: string, observed: string) => `On sample ${n} the student predicted "${predicted}" for ${tool}, but the result was "${observed}".`,
  revision: (n: number, from: string, to: string) => `The student changed sample ${n} from ${from} to ${to}.`,
  budgetLow: 'The student has only a few test runs left.',
  ready: 'Every sample has a call and enough tests, so the student can submit.',
  idle: 'The student has not done anything for a while.',
}
