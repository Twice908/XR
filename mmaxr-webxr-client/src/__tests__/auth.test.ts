import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../config', () => ({
  CONFIG: { AUTH_URL: 'http://test/auth/session' },
}))

import { fetchSession } from '../services/auth'

describe('fetchSession', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs correct body and returns parsed session', async () => {
    const payload = { sessionId: 's1', token: 't1', studentId: 'student_99', lessonId: 'physics-101' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    )
    const result = await fetchSession('student_99', 'physics-101')
    expect(result).toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://test/auth/session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 'student_99', lessonId: 'physics-101' }),
      }),
    )
  })

  it('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500, statusText: 'Server Error' }),
    )
    await expect(fetchSession('a', 'b')).rejects.toThrow(/Auth 500/)
  })

  it('throws when sessionId missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: 'x' }), { status: 200 }),
    )
    await expect(fetchSession('a', 'b')).rejects.toThrow(/missing sessionId/)
  })
})