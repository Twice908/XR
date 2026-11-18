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

export function lessonLabel(id: string | null): string {
  if (!id) return 'Unknown lab'
  if (id.startsWith('chemistry')) return 'Acids, Bases & Indicators'
  if (id.startsWith('physics')) return 'Bohr Model Spectral Lab'
  return id
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
