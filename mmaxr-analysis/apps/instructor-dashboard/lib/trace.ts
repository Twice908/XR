import type { TraceEvent } from './types'

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
  const tube = d.sample ? `sample ${d.sample}` : d.tube ? `tube ${d.tube}` : str(o.target).replace('tube:', 'tube ').replace('sample:', 'sample ')
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
      return d.stage === 'hypothesis' ? `First impression: ${tube} is a ${str(o.value)} (${['', 'a guess', 'fairly sure', 'certain'][Number(d.confidence) || 0] ?? ''})` : `Concluded ${tube} is ${str(o.value)}`
    case 'change_conclusion':
      return `Changed ${tube} from ${str(d.from)} to ${str(d.to)}`
    case 'predict_outcome':
      return `Predicted “${str(o.value).replace(/_/g, ' ')}” for ${tube} with the ${str(d.tool)} (${['', 'a guess', 'fairly sure', 'certain'][Number(d.confidence) || 0] ?? ''}, ${Math.round(Number(d.decisionMs) / 100) / 10}s to decide)`
    case 'run_test':
      return `Ran the ${str(o.value)} test on ${tube}${d.msSincePrediction ? ` (${Math.round(Number(d.msSincePrediction) / 100) / 10}s after predicting)` : ''}`
    case 'test_result':
      return `${str(d.tool)} on ${tube}: ${str(o.value).replace(/_/g, ' ')}${d.match === false ? ' (not as predicted)' : d.match === true ? ' (as predicted)' : ''}`
    case 'record_property':
      return `Wrote “${str(o.value).replace(/_/g, ' ')}” for ${str(d.tool)} on ${tube}`
    case 'record_litmus':
      return `Wrote the litmus result for ${tube}: ${str(o.value).replace(/_/g, ' ')}`
    case 'ask_coach':
      return 'Asked the coach a question'
    case 'coach_mode':
      return `Set the coach to ${str(o.value).replace('_', ' ')}`
    case 'unlock_ph_paper':
      return 'pH paper unlocked'
    case 'arrive_checkpoint':
      return `Arrived at stop ${str(d.sample ?? d.checkpoint)}`
    case 'start_challenge':
      return 'Started the “what if?” challenge'
    case 'predict_selection': {
      const n = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : 0)
      return `Stop ${str(d.sample)}: predicted ${n('glands')} gland${n('glands') === 1 ? '' : 's'}, ${n('juices')} juice${n('juices') === 1 ? '' : 's'}, ${n('components')} enzyme${n('components') === 1 ? '' : 's'}/chemical${n('components') === 1 ? '' : 's'}, ${n('nutrients')} nutrient${n('nutrients') === 1 ? '' : 's'} (${['', 'a guess', 'fairly sure', 'certain'][Number(d.confidence) || 0] ?? ''}, ${Math.round(Number(d.decisionMs) / 100) / 10}s to decide)`
    }
    case 'commit_explanation':
      return `Stop ${str(d.sample)}: explained ${d.inputMode === 'voice' ? 'aloud' : 'in writing'} (${str(d.words)} words)`
    case 'reveal_shown':
      return `Stop ${str(d.sample)}: reveal shown${d.match === true ? ' (prediction matched)' : d.match === false ? ' (prediction missed some)' : ''}`
    case 'revise_explanation':
      return `Stop ${str(d.sample)}: revised the explanation (key ideas ${Math.round(Number(d.coverageBefore) * 100)}% → ${Math.round(Number(d.coverageAfter) * 100)}%)`
    case 'submit_final':
      return 'Submitted the “what if?” challenge'
    case 'submit_analysis':
      return 'Submitted the analysis'
    default:
      return [o.action, o.target, o.value].filter(Boolean).join(' ') || e.verb
  }
}

export function lessonLabel(id: string | null): string {
  if (!id) return 'Unknown lab'
  if (id.startsWith('biology')) return 'Human Digestive System'
  if (id.startsWith('metals')) return 'Metals & Non-Metals'
  if (id.startsWith('chemistry')) return 'Acids, Bases & Indicators'
  if (id.startsWith('physics-light')) return 'Light: Reflection & Spherical Mirrors'
  if (id.startsWith('physics')) return 'Bohr Model Spectral Lab'
  return id
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
