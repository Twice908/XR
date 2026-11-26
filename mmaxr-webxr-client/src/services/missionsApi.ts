import type { MissionsAnswerResult, MissionsCheckResult, MissionsHintResult, MissionsProgress, MissionsQuestion, MissionsSummary } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'

async function call<T>(session: LabSessionRef, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/missions${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${session.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error('Cannot reach the lab service. Check your connection and try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `The lab service answered ${res.status}`)
  return data as T
}

/** Where this session is, including questions already unlocked but not answered. */
export const fetchProgress = (s: LabSessionRef) => call<{ progress: MissionsProgress; questions: MissionsQuestion[] }>(s, '')
/** Check the build against the mission goal (the goal stays on the server). */
export const checkMission = (s: LabSessionRef, mission: string, state: unknown) => call<MissionsCheckResult>(s, '/check', { mission, state })
export const takeHint = (s: LabSessionRef, mission: string) => call<MissionsHintResult>(s, '/hint', { mission })
export const answerQuestion = (s: LabSessionRef, body: { question: string; choice: string; thinkMs: number }) => call<MissionsAnswerResult>(s, '/answer', body)
export const finishRun = (s: LabSessionRef) => call<MissionsSummary>(s, '/finish', {})
