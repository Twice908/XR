import type { MotionExplanationResult, MotionObservation } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/motion/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the lab service. Check your connection and try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `The lab service answered ${res.status}`)
  return data as T
}

export interface PredictBody {
  trial: string
  value: Record<string, number | string>
  confidence: number | null
  thinkMs: number
}

/** Locks a prediction. The server keeps it; it cannot be changed afterwards. */
export const lockPrediction = (s: LabSessionRef, body: PredictBody) => post<{ locked: true }>(s, 'predict', body)
/** After the student has watched the result: whether it matched, and what really happened. */
export const observeResult = (s: LabSessionRef, trial: string) => post<MotionObservation>(s, 'observe', { trial })
export const explainResult = (s: LabSessionRef, trial: string, explanation: string) => post<MotionExplanationResult>(s, 'explain', { trial, explanation })
