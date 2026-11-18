import type { RubricScores, TraceEvent } from './types'

export const DIMENSIONS: { key: keyof RubricScores; label: string; hint: string }[] = [
  { key: 'predictionDiscipline', label: 'Prediction discipline', hint: 'Committed to a prediction before acting' },
  { key: 'retrievalEffort', label: 'Retrieval effort', hint: 'Time and hand movement between predicting and acting' },
  { key: 'revisionQuality', label: 'Revision quality', hint: 'Changed conclusions when new evidence contradicted them' },
  { key: 'causalCoherence', label: 'Causal coherence', hint: 'Final conclusions agree with the evidence' },
  { key: 'metacognitiveCalibration', label: 'Metacognitive calibration', hint: 'Confidence matched correctness' },
  { key: 'transfer', label: 'Transfer', hint: 'Applied the idea to a new situation' },
]

export const VERB_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'purple' | 'blue' | 'orange'> = {
  predicted: 'blue',
  acted: 'orange',
  observed: 'neutral',
  investigated: 'info',
  explained: 'success',
  revised_model: 'purple',
  noticed_anomaly: 'warning',
  transferred: 'success',
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** One plain-English line per xAPI event for the timeline. */
export function describeEvent(e: TraceEvent): string {
  const o = e.object_data ?? {}
  const d = (o.data ?? {}) as Record<string, unknown>
  const tube = d.tube ? `tube ${d.tube}` : str(o.target).replace('tube:', 'tube ')
  switch (o.action) {
    case 'enter_lab':
      return `Entered ${str(o.target)}`
    case 'select_indicator':
      return `Chose ${str(o.target)} (${str(o.value)})`
    case 'deselect_indicator':
      return `Put back ${str(o.target)}`
    case 'start_testing':
      return 'Started testing'
    case 'predict_color':
      return `Predicted ${str(o.value)} for ${tube} (${['', 'a guess', 'fairly sure', 'certain'][Number(d.confidence) || 0] ?? ''}, ${Math.round(Number(d.decisionMs) / 100) / 10}s to decide)`
    case 'predict_paper_color':
      return `Predicted ${str(o.value)} paper for ${tube}`
    case 'add_indicator':
      return `Added ${str(o.value)} to ${tube}${d.msSincePrediction ? ` (${Math.round(Number(d.msSincePrediction) / 100) / 10}s after predicting)` : ''}`
    case 'dip_ph_paper':
      return `Dipped pH paper in ${tube}`
    case 'liquid_color':
      return `${tube} turned ${str(o.value)}${d.match === false ? ' (not as predicted)' : d.match === true ? ' (as predicted)' : ''}`
    case 'record_color':
      return `Wrote ${str(o.value)} in the notebook for ${tube}`
    case 'record_ph':
      return `Wrote pH ${str(o.value)} for ${tube}`
    case 'set_conclusion':
      return `Concluded ${tube} is ${str(o.value)}`
    case 'change_conclusion':
      return `Changed ${tube} from ${str(d.from)} to ${str(d.to)}`
    case 'unlock_ph_paper':
      return 'pH paper unlocked'
    case 'submit_analysis':
      return 'Submitted the analysis'
    default:
      return [o.action, o.target, o.value].filter(Boolean).join(' ') || e.verb
  }
}

export interface Highlights {
  isChemistry: boolean
  predictions: number
  predictionsRight: number
  revisions: number
  conclusionsCorrect: number | null
  tubes: number | null
  confidentWrong: number
  durationMs: number
}

/** Plain counts from the trace. Scores come from the rubric engine, never from here. */
export function highlights(trace: TraceEvent[]): Highlights {
  let predictions = 0
  let predictionsRight = 0
  let revisions = 0
  let confidentWrong = 0
  let conclusionsCorrect: number | null = null
  let tubes: number | null = null
  const confidenceByKey = new Map<string, number>()
  for (const e of trace) {
    const o = e.object_data ?? {}
    const d = (o.data ?? {}) as Record<string, unknown>
    if (e.verb === 'predicted') {
      predictions++
      confidenceByKey.set(`${d.tube}:${d.tool}`, Number(d.confidence))
    }
    if (o.action === 'liquid_color') {
      if (d.match === true) predictionsRight++
      if (d.match === false && confidenceByKey.get(`${d.tube}:${d.tool}`) === 3) confidentWrong++
    }
    if (e.verb === 'revised_model') revisions++
    if (o.action === 'submit_analysis') {
      const s = (d.summary ?? {}) as Record<string, unknown>
      if (typeof s.conclusionsCorrect === 'number') conclusionsCorrect = s.conclusionsCorrect
      if (typeof s.tubes === 'number') tubes = s.tubes
    }
  }
  const first = trace[0]?.timestamp ?? 0
  const last = trace[trace.length - 1]?.timestamp ?? first
  return {
    isChemistry: trace.some((e) => e.object_data?.action === 'enter_lab' && String(e.object_data?.target).startsWith('chemistry')),
    predictions,
    predictionsRight,
    revisions,
    conclusionsCorrect,
    tubes,
    confidentWrong,
    durationMs: last - first,
  }
}
