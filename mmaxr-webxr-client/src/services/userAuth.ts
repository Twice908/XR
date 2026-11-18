import type { AuthUser } from '@mmaxr/schema'
import { CONFIG } from '../config'

const STORAGE_KEY = 'mmaxr.student.auth'

export interface Account {
  token: string
  user: AuthUser
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init
  let res: Response
  try {
    res = await fetch(`${CONFIG.USER_AUTH_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new ApiError('Cannot reach the account service. Is the backend running?', 0)
  }
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
  return body as T
}

export const userAuth = {
  current(): Account | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Account) : null
    } catch {
      return null
    }
  },

  save(account: Account) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },

  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  },

  async login(username: string, password: string): Promise<Account> {
    const account = await call<Account>('/users/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, role: 'student' }),
    })
    userAuth.save(account)
    return account
  },

  async register(username: string, password: string, email?: string): Promise<Account> {
    const account = await call<Account>('/users/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, email: email || undefined, role: 'student' }),
    })
    userAuth.save(account)
    return account
  },

  forgotPassword(username: string) {
    return call<{ message: string; devResetToken?: string }>('/users/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username }),
    })
  },

  resetPassword(token: string, newPassword: string) {
    return call<{ message: string }>('/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    })
  },

  /** Re-validate a stored token. Returns null when it has expired or the account is gone. */
  async refresh(): Promise<Account | null> {
    const account = userAuth.current()
    if (!account) return null
    try {
      const { user } = await call<{ user: AuthUser }>('/users/me', { token: account.token })
      const next = { token: account.token, user }
      userAuth.save(next)
      return next
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) return account // offline: keep the session
      userAuth.clear()
      return null
    }
  },

  async deleteAccount(password: string) {
    const account = userAuth.current()
    if (!account) throw new ApiError('Not signed in', 401)
    await call<void>('/users/me', { method: 'DELETE', token: account.token, body: JSON.stringify({ password }) })
    userAuth.clear()
  },
}
