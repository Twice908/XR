'use client'
import useSWR from 'swr'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export function useSessionList() {
  const { token } = useAuth()
  return useSWR(token ? ['sessions', token] : null, ([, t]) => api.listSessions(t), { refreshInterval: 5000 })
}

export function useSessionData(sessionId: string) {
  const { token } = useAuth()
  return useSWR(token ? ['analyze', sessionId, token] : null, ([, id, t]) => api.getAnalysis(id, t), {
    refreshInterval: 4000,
    revalidateOnFocus: true,
  })
}
