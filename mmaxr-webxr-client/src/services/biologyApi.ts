import type { BiologyFinalResult, BiologyQuizFeedback, BiologyQuizQuestion } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { LabSessionRef } from './labApi'

async function call<T>(session: LabSessionRef, path: string, init?: { body: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/biology/${path}`, {
      method: init ? 'POST' : 'GET',
      headers: { ...(init ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${session.token}` },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new Error('Cannot reach the lab service. Check your connection and try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `The lab service answered ${res.status}`)
  return data as T
}

/** Tells the server this organ has been seen. After the last one the quiz opens. */
export const visitStop = (session: LabSessionRef, checkpoint: string) => call<{ visited: number; total: number; quizOpen: boolean }>(session, 'visit', { body: { checkpoint } })

/** This session's own questions, in this session's order. */
export const fetchQuiz = (session: LabSessionRef) => call<{ questions: BiologyQuizQuestion[]; answered: string[] }>(session, 'quiz')

/** Locks the answer to one question. Only then does the server say which option was right. */
export const answerQuestion = (session: LabSessionRef, body: { question: string; choice: string; thinkMs: number }) => call<BiologyQuizFeedback>(session, 'quiz/answer', { body })

export const submitChallenge = (session: LabSessionRef, body: { explanation?: string; inputMode?: 'voice' | 'typed'; speakMs?: number }) => call<BiologyFinalResult>(session, 'final', { body })

/** Best effort: the explanation is already scored; the recording is kept for the instructor. */
export async function uploadAudio(session: LabSessionRef, blob: Blob): Promise<void> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  await call(session, 'audio', { body: { contentType: blob.type || 'audio/webm', fileBase64: b64 } })
}
