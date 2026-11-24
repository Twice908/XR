import type { SoundAct, SoundCalcResult, SoundExplainResult, SoundReveal, SoundTrialResult } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/sound/${path}`, {
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

/** Commit a prediction and run the experiment. The service checks the experiment was really done before it answers. */
export function runTask(session: LabSessionRef, req: { id: string; prediction: string; confidence: number; thinkMs: number; act: SoundAct }): Promise<SoundTrialResult & { hasCalc: boolean }> {
  return post(session, 'trial', req)
}

export function submitCalc(session: LabSessionRef, id: string, value: number): Promise<SoundCalcResult> {
  return post(session, 'calc', { id, value })
}

export function submitExplanation(session: LabSessionRef, body: { id: string; text: string; inputMode: 'voice' | 'typed'; speakMs: number; thinkMs: number; pasted: number; blurs: number }): Promise<SoundExplainResult> {
  return post(session, 'explain', body)
}

export function finishSound(session: LabSessionRef): Promise<SoundReveal> {
  return post(session, 'submit', {})
}

/** Best effort: the explanation is already accepted; the recording is kept for the instructor. */
export async function uploadAudio(session: LabSessionRef, id: string, blob: Blob): Promise<void> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  await post(session, 'audio', { id, contentType: blob.type || 'audio/webm', fileBase64: b64 })
}
