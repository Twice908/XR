import { CONFIG } from '../config'

export interface AuthSession {
  sessionId: string
  token: string
  studentId: string
  lessonId: string
}

export async function fetchSession(
  studentId: string,
  lessonId: string,
): Promise<AuthSession> {
  const res = await fetch(CONFIG.AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, lessonId }),
  })
  if (!res.ok) {
    throw new Error(`Auth ${res.status}: ${res.statusText}`)
  }
  const data = (await res.json()) as AuthSession
  if (!data.sessionId || !data.token) {
    throw new Error('Auth response missing sessionId or token')
  }
  return data
}