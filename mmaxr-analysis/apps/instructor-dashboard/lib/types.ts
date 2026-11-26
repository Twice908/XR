export type Role = 'student' | 'instructor'
export type Device = 'web' | 'vr' | 'unknown'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  role: Role
  createdAt: string
}

/** From user-auth GET /students. */
export interface Student {
  id: string
  username: string
  createdAt: string
  lastLoginAt: string | null
}

/** From rubric-engine GET /students/summary. */
export interface StudentActivity {
  student_id: string
  sessions: string | number
  events: string | number
  last_update: string | number
  used_web: boolean | null
  used_vr: boolean | null
}

export interface SessionSummary {
  session_id: string
  student_id: string
  event_count: string | number
  started_at: string | number
  last_update: string | number
  device: 'web' | 'vr' | null
  lesson_id: string | null
  completed: boolean | null
  /** Only finished or left sessions are listed. Missing from older backends: fall back to `completed`. */
  status?: 'completed' | 'left'
  ended_at: string | number | null
}

export interface TraceEvent {
  id: number
  verb: string
  timestamp: number
  device?: string | null
  object_data: {
    action?: string
    target?: string
    value?: string | number
    data?: Record<string, unknown>
  } | null
}

export interface DimensionResult {
  key: string
  label: string
  score: number | null
  max: 3
  basis: string
  evidence: number[]
  measures: Record<string, number | string | null>
}

export interface StatItem {
  label: string
  value: string
  hint: string
}

export interface SessionDetail {
  sessionId: string
  studentId: string
  timestamp: string
  rubricVersion: string
  lessonType: 'chemistry_indicators' | 'physics_bohr' | 'unknown'
  device: Device
  complete: boolean
  status?: 'completed' | 'left'
  dimensions: DimensionResult[]
  overall: { points: number; max: number; percent: number | null }
  deviceStats: { kind: Device; items: StatItem[] }
  metrics: Record<string, number | boolean | string | null>
  trace: TraceEvent[]
}

// ---------- rewards service (/rewards/*) ----------

export interface LearningRing {
  value: number
  goal: number
  percent: number
  closed: boolean
}

export type RingGoalLevel = 'light' | 'standard' | 'stretch'

export interface RingGoals {
  exploreMinutes: number
  masterCount: number
  completeCount: number
  masteryPercent: number
}

export interface StudentRings {
  studentId: string
  level: RingGoalLevel
  explore: LearningRing
  master: LearningRing
  complete: LearningRing
  allClosed: boolean
  /** Finished nothing this week or last week. */
  stalled: boolean
}

export interface ClassRings {
  week: string
  goals: RingGoals
  summary: { students: number; allClosed: number; stalled: number }
  students: StudentRings[]
}

export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface CollectionEntry {
  id: string
  subject: string
  set: string
  rarity: CardRarity
  title: string
  subtitle: string
  order: number
  owned: boolean
  count?: number
  foil?: boolean
  firstObtainedAt?: string
}

export interface StudentCollection {
  shards: number
  totals: { owned: number; total: number }
  sets: { subject: string; set: string; title: string; owned: number; total: number; complete: boolean }[]
  cards: CollectionEntry[]
}
