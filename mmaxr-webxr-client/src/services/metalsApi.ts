import type { MetalsRevealSample } from '@mmaxr/schema'
import { CONFIG } from '../config'
import type { ServerOutcome, SubmissionPayload } from '../state/metals'
import type { LabSessionRef } from './labApi'

async function post<T>(session: LabSessionRef, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${CONFIG.LABS_URL}/sessions/${encodeURIComponent(session.sessionId)}/metals/${path}`, {
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

/** What does this tool show on this sample? Only the server knows. */
export function runMetalsTest(session: LabSessionRef, sample: number, tool: string): Promise<ServerOutcome & { used: number; budget: number }> {
  return post(session, 'test', { sample, tool })
}

/** One-shot: locks the submitted analysis, then discloses what each sample was. */
export async function revealMetals(session: LabSessionRef, payload: SubmissionPayload): Promise<MetalsRevealSample[]> {
  const r = await post<{ samples: MetalsRevealSample[] }>(session, 'reveal', payload)
  return r.samples
}
