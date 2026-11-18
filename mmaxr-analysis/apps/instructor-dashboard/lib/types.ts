export type Role = 'student' | 'instructor'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  role: Role
  createdAt: string
}

export interface SessionSummary {
  session_id: string
  event_count: string | number
  last_update: string | number
}

export interface RubricScores {
  predictionDiscipline: number
  retrievalEffort: number
  revisionQuality: number
  causalCoherence: number
  metacognitiveCalibration: number
  transfer: number
}

export interface TraceEvent {
  verb: string
  timestamp: number
  object_data: {
    action?: string
    target?: string
    value?: string | number
    data?: Record<string, unknown>
  } | null
}

export interface SessionMetrics {
  predictionsMade: number
  actionsMade: number
  anomaliesNoticed: number
  avgThinkTimeMs: number
  avgHandMovementMeters: number
  hasSensorData: boolean
}

export interface SessionDetail {
  sessionId: string
  timestamp: string
  scores: RubricScores
  metrics: SessionMetrics
  trace: TraceEvent[]
}
