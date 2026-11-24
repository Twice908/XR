import { CONFIG, DEVICE } from '../config'

export interface LabSession {
  sessionId: string
  token: string
  studentId: string
  lessonId: string
}

/** Opens a lab session. The user token makes the account id the (pseudonymous) student id. */
export async function openSession(userToken: string, lessonId: string): Promise<LabSession> {
  const res = await fetch(CONFIG.SESSION_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ lessonId, device: DEVICE }),
  })
  if (!res.ok) throw new Error(`Session service answered ${res.status}`)
  const data = (await res.json()) as LabSession
  if (!data.sessionId || !data.token) throw new Error('Session response missing sessionId or token')
  return data
}
