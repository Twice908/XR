import { CONFIG } from '../config'
import { blobToBase64 } from '../lab/voiceBox'
import type { Reasoning } from '../lab/reasoningDialog'
import type { LabSessionRef } from './labApi'

async function post(session: LabSessionRef, path: string, body: unknown): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the lab service. Check your connection and try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `The lab service answered ${res.status}`)
}

/** Keeps the student's spoken or typed reasoning with the session. Safe to repeat: the first one is kept. */
export async function sendReasoning(session: LabSessionRef, r: Reasoning): Promise<void> {
  await post(session, 'reasoning', { text: r.text, inputMode: r.inputMode, speakMs: r.speakMs })
  // Best effort: the words are already stored; the recording is for the instructor.
  if (r.audio) void blobToBase64(r.audio).then((b64) => post(session, 'reasoning/audio', { contentType: r.audio!.type || 'audio/webm', fileBase64: b64 })).catch(() => {})
}
