import type { OpticsReveal, OpticsTrialKind, OpticsTrialResult, OpticsImage } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/optics/${path}`, {
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

/** Commit a prediction, then learn what really happens. Only the server knows. */
export function runTrial(session: LabSessionRef, req: { kind: OpticsTrialKind; id: string; prediction: Record<string, string>; confidence: number; thinkMs: number }): Promise<OpticsTrialResult> {
  return post(session, 'trial', req)
}

/** One-shot: locks the student's table, then discloses the textbook answers and the real-world uses. */
export function lockIn(session: LabSessionRef, payload: { table: Record<string, OpticsImage>; notes: Record<string, string> }): Promise<OpticsReveal> {
  return post(session, 'submit', payload)
}

/** The explanation a run owes. The service refuses it if it is too short, too quick, or not about this run's own numbers. */
export function submitExplanation(session: LabSessionRef, body: { kind: OpticsTrialKind; id: string; text: string; inputMode: 'voice' | 'typed'; speakMs: number; thinkMs: number; pasted: number; blurs: number }): Promise<{ ok: true; words: number }> {
  return post(session, 'explain', body)
}

/** Best effort: the explanation is already accepted; the recording is kept for the instructor. */
export async function uploadAudio(session: LabSessionRef, kind: OpticsTrialKind, id: string, blob: Blob): Promise<void> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  await post(session, 'audio', { kind, id, contentType: blob.type || 'audio/webm', fileBase64: b64 })
}
