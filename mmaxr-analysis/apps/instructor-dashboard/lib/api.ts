import type { SessionDetail, SessionSummary } from './types'

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3002'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

async function listSessions(): Promise<SessionSummary[]> {
  const data = await get<SessionSummary[]>('/sessions')
  if (!Array.isArray(data)) return []
  return data.filter((s) => Boolean(s.session_id))
}

async function getAnalysis(sessionId: string): Promise<SessionDetail> {
  return get<SessionDetail>(`/analyze/${encodeURIComponent(sessionId)}`)
}

export const api = {
  listSessions,
  getAnalysis,
}