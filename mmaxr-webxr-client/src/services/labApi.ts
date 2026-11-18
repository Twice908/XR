import type { ChemistryRevealTube } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { SubmissionPayload } from '../state/chemistry'

export interface LabSessionRef {
  sessionId: string
  token: string
}

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/chemistry/${path}`, {
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

/** What does this tool show on this tube? The server answers with a colour and nothing else. */
export async function runTest(session: LabSessionRef, tube: number, tool: string): Promise<string> {
  const r = await post<{ color: string }>(session, 'test', { tube, tool })
  return r.color
}

/** One-shot: locks the submitted analysis, then returns what was really in each tube. */
export async function revealTruth(session: LabSessionRef, payload: SubmissionPayload): Promise<ChemistryRevealTube[]> {
  const r = await post<{ tubes: ChemistryRevealTube[] }>(session, 'reveal', payload)
  return r.tubes
}
