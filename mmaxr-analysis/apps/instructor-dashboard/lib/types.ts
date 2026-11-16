import type { RubricDimension } from '@mmaxr/schema'

export type RubricScores = Record<RubricDimension, number>

export interface SessionSummary {
  session_id: string
  /** Fields the backend actually returns from GET /sessions */
  event_count?: string | number
  last_update?: string | number
  /** Optional enrichment fields — present only when backend includes them */
  studentId?: string
  lessonId?: string
  status?: 'active' | 'completed' | 'abandoned'
  startedAt?: string
  endedAt?: string
}

export interface TraceEvent {
  id?: string
  timestamp: string
  dimension?: RubricDimension | null
  verb?: string
  action?: string
  object?: string
  detail?: string
  context?: Record<string, unknown>
}

export interface SessionDetail {
  sessionId: string
  timestamp: string
  scores: RubricScores
  metrics: Record<string, unknown>
  trace: TraceEvent[]
}