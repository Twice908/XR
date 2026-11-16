'use client'
import useSWR from 'swr'
import { api } from '@/lib/api'

export function useSessionData(sessionId: string) {
  return useSWR(['analyze', sessionId], () => api.getAnalysis(sessionId), {
    refreshInterval: 3000,
    revalidateOnFocus: true,
  })
}

export function useSessionList() {
  return useSWR('sessions', api.listSessions, { refreshInterval: 5000 })
}

export function useSessionSummary(sessionId: string) {
  const { data } = useSessionList()
  return data?.find((s) => s.session_id === sessionId)
}