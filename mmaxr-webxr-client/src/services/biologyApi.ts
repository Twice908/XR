import type { BiologyFinalResult, BiologyReveal } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'
import type { Selection } from '../state/biology'

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/biology/${path}`, {
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

export interface CommitBody {
  checkpoint: string
  selection: Selection
  explanation: string
  confidence: number | null
  inputMode: 'voice' | 'typed'
  thinkMs: number
  speakMs: number
}

/** Locks the student's answer for this stop. Only then does the server reveal what is right. */
export async function commitStop(session: LabSessionRef, body: CommitBody): Promise<BiologyReveal> {
  const r = await post<{ reveal: BiologyReveal }>(session, 'commit', body)
  return r.reveal
}

export function reviseStop(session: LabSessionRef, checkpoint: string, explanation: string) {
  return post<{ coverage: number; keywords: { keyword: string; matched: boolean }[]; revisions: number; maxRevisions: number }>(session, 'revise', { checkpoint, explanation })
}

export function submitChallenge(session: LabSessionRef, answers: Record<string, string>): Promise<BiologyFinalResult> {
  return post<BiologyFinalResult>(session, 'final', { answers })
}

/** Best effort: the explanation is already scored; the recording is kept for the instructor. */
export async function uploadAudio(session: LabSessionRef, checkpoint: string, blob: Blob): Promise<void> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  await post(session, 'audio', { checkpoint, contentType: blob.type || 'audio/webm', fileBase64: b64 })
}
