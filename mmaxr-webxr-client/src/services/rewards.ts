import type { ClaimPackResponse, OpenPackResponse, RewardPack } from '@mmaxr/schema'
import { CONFIG } from '../config'
import { userAuth } from './userAuth'

export class RewardsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

type Fetch = typeof fetch

async function call<T>(path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<T> {
  const token = userAuth.current()?.token
  if (!token) throw new RewardsError('Sign in first', 401)
  let res: Response
  try {
    res = await fetchImpl(`${CONFIG.REWARDS_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new RewardsError('Cannot reach the rewards service', 0)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new RewardsError(String(body.error ?? `Request failed (${res.status})`), res.status, body)
  return body as T
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Claim a finished session's pack. The server is idempotent, so retrying is always safe. It retries network errors
 * and a session the server does not see as finished yet (the submit can land a moment after this is called).
 * A session left early is final: no retry.
 */
export async function claimPack(sessionId: string, opts: { attempts?: number; delayMs?: number; fetchImpl?: Fetch } = {}): Promise<ClaimPackResponse> {
  const attempts = opts.attempts ?? 4
  const delayMs = opts.delayMs ?? 1500
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await call<ClaimPackResponse>(`/sessions/${encodeURIComponent(sessionId)}/claim`, { method: 'POST' }, opts.fetchImpl)
    } catch (err) {
      last = err
      const retryable = err instanceof RewardsError && (err.status === 0 || err.status >= 500 || (err.status === 409 && err.body.status === 'in_progress'))
      if (!retryable || i === attempts - 1) throw err
      await wait(delayMs * (i + 1))
    }
  }
  throw last
}

export const listPacks = (unopened = false) => call<{ packs: RewardPack[] }>(`/packs${unopened ? '?unopened=true' : ''}`)
export const openPack = (packId: string) => call<OpenPackResponse>(`/packs/${encodeURIComponent(packId)}/open`, { method: 'POST' })

// ---------- a tiny shared store, so the top bar badge follows packs earned anywhere in the app ----------

type Listener = (count: number) => void
const listeners = new Set<Listener>()
let unopened = 0

export const packStore = {
  get unopened() {
    return unopened
  },
  set(count: number) {
    unopened = Math.max(0, count)
    for (const l of listeners) l(unopened)
  },
  async refresh() {
    try {
      packStore.set((await listPacks(true)).packs.length)
    } catch {
      /* the badge simply stays as it was */
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(unopened)
    return () => listeners.delete(listener)
  },
}
