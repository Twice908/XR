'use client'
import useSWR from 'swr'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export function useStudents() {
  const { token } = useAuth()
  return useSWR(token ? ['students', token] : null, ([, t]) => api.listStudents(t), { refreshInterval: 15000 })
}

export function useStudentActivity() {
  const { token } = useAuth()
  return useSWR(token ? ['activity', token] : null, ([, t]) => api.studentActivity(t), { refreshInterval: 5000 })
}

export function useStudentSessions(studentId: string) {
  const { token } = useAuth()
  return useSWR(token ? ['student-sessions', studentId, token] : null, ([, id, t]) => api.studentSessions(id, t), { refreshInterval: 5000 })
}

export function useSessionData(sessionId: string) {
  const { token } = useAuth()
  return useSWR(token ? ['analyze', sessionId, token] : null, ([, id, t]) => api.getAnalysis(id, t), {
    refreshInterval: 4000,
    revalidateOnFocus: true,
  })
}
