import type { SessionDetail, SessionSummary } from './types'

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3002'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function get<T>(path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new ApiError('Cannot reach the analysis service. Is it running?', 0)
  }
  if (!res.ok) throw new ApiError(res.status === 401 || res.status === 403 ? 'Your session expired. Sign in again.' : `Request failed (${res.status})`, res.status)
  return res.json() as Promise<T>
}

export const api = {
  async listSessions(token: string): Promise<SessionSummary[]> {
    const data = await get<SessionSummary[]>('/sessions', token)
    return Array.isArray(data) ? data.filter((s) => Boolean(s.session_id)) : []
  },
  getAnalysis(sessionId: string, token: string): Promise<SessionDetail> {
    return get<SessionDetail>(`/analyze/${encodeURIComponent(sessionId)}`, token)
  },
}
