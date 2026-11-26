import type { ClassRings, RingGoals, SessionDetail, SessionSummary, Student, StudentActivity, StudentCollection } from './types'

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3002'
const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_BASE ?? 'http://localhost:3008'
const REWARDS_BASE = process.env.NEXT_PUBLIC_REWARDS_BASE ?? 'http://localhost:3009'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function get<T>(base: string, path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new ApiError('Cannot reach the service. Is the backend running?', 0)
  }
  if (!res.ok) throw new ApiError(res.status === 401 || res.status === 403 ? 'Your session expired. Sign in again.' : `Request failed (${res.status})`, res.status)
  return res.json() as Promise<T>
}

async function put<T>(base: string, path: string, token: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError('Cannot reach the service. Is the backend running?', 0)
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

export const api = {
  async listStudents(token: string): Promise<Student[]> {
    const data = await get<{ students: Student[] }>(AUTH_BASE, '/students', token)
    return data.students ?? []
  },
  async studentActivity(token: string): Promise<StudentActivity[]> {
    const data = await get<StudentActivity[]>(BASE, '/students/summary', token)
    return Array.isArray(data) ? data : []
  },
  async studentSessions(studentId: string, token: string): Promise<SessionSummary[]> {
    const data = await get<SessionSummary[]>(BASE, `/students/${encodeURIComponent(studentId)}/sessions`, token)
    return Array.isArray(data) ? data : []
  },
  getAnalysis(sessionId: string, token: string): Promise<SessionDetail> {
    return get<SessionDetail>(BASE, `/analyze/${encodeURIComponent(sessionId)}`, token)
  },
  classRings(week: string, token: string): Promise<ClassRings> {
    return get<ClassRings>(REWARDS_BASE, `/instructor/rings?week=${encodeURIComponent(week)}`, token)
  },
  async ringGoals(token: string): Promise<RingGoals> {
    return (await get<{ goals: RingGoals }>(REWARDS_BASE, '/instructor/ring-goals', token)).goals
  },
  async setRingGoals(goals: RingGoals, token: string): Promise<RingGoals> {
    return (await put<{ goals: RingGoals }>(REWARDS_BASE, '/instructor/ring-goals', token, goals)).goals
  },
  studentCollection(studentId: string, token: string): Promise<StudentCollection> {
    return get<StudentCollection>(REWARDS_BASE, `/instructor/students/${encodeURIComponent(studentId)}/collection`, token)
  },
}
