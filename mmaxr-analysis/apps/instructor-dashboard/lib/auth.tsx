'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AuthUser } from './types'

const BASE = process.env.NEXT_PUBLIC_AUTH_BASE ?? 'http://localhost:3008'
const KEY = 'mmaxr.instructor.auth'

interface Stored {
  token: string
  user: AuthUser
}

export class AuthError extends Error {
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
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch {
    throw new AuthError('Cannot reach the account service. Is the backend running?', 0)
  }
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new AuthError(body.error ?? `Request failed (${res.status})`, res.status)
  return body as T
}

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn'
  user: AuthUser | null
  token: string | null
  login(username: string, password: string): Promise<void>
  register(input: { username: string; password: string; email?: string; inviteCode: string }): Promise<void>
  forgotPassword(username: string): Promise<{ message: string; devResetToken?: string }>
  resetPassword(token: string, newPassword: string): Promise<void>
  logout(): void
  deleteAccount(password: string): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}
function write(v: Stored | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ status: AuthContextValue['status']; stored: Stored | null }>({ status: 'loading', stored: null })

  // Validate the remembered token once on load.
  useEffect(() => {
    const stored = read()
    if (!stored) return setState({ status: 'signedOut', stored: null })
    call<{ user: AuthUser }>('/users/me', { token: stored.token })
      .then(({ user }) => {
        if (user.role !== 'instructor') throw new AuthError('Not an instructor', 403)
        const next = { token: stored.token, user }
        write(next)
        setState({ status: 'signedIn', stored: next })
      })
      .catch((err) => {
        if (err instanceof AuthError && err.status === 0) return setState({ status: 'signedIn', stored }) // offline: keep session
        write(null)
        setState({ status: 'signedOut', stored: null })
      })
  }, [])

  const accept = useCallback((s: Stored) => {
    write(s)
    setState({ status: 'signedIn', stored: s })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.stored?.user ?? null,
      token: state.stored?.token ?? null,
      async login(username, password) {
        accept(await call<Stored>('/users/login', { method: 'POST', body: JSON.stringify({ username, password, role: 'instructor' }) }))
      },
      async register({ username, password, email, inviteCode }) {
        accept(await call<Stored>('/users/register', { method: 'POST', body: JSON.stringify({ username, password, email: email || undefined, role: 'instructor', inviteCode }) }))
      },
      forgotPassword: (username) => call('/users/forgot-password', { method: 'POST', body: JSON.stringify({ username }) }),
      async resetPassword(token, newPassword) {
        await call('/users/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) })
      },
      logout() {
        write(null)
        setState({ status: 'signedOut', stored: null })
      },
      async deleteAccount(password) {
        if (!state.stored) throw new AuthError('Not signed in', 401)
        await call<void>('/users/me', { method: 'DELETE', token: state.stored.token, body: JSON.stringify({ password }) })
        write(null)
        setState({ status: 'signedOut', stored: null })
      },
    }),
    [state, accept],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
