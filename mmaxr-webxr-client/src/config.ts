const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

export const CONFIG = {
  USER_AUTH_URL: env.VITE_USER_AUTH_URL ?? 'http://localhost:3008',
  SESSION_AUTH_URL: env.VITE_SESSION_AUTH_URL ?? 'http://localhost:3004/auth/session',
  LABS_URL: env.VITE_LABS_URL ?? 'http://localhost:3007',
  LESSONS_URL: env.VITE_LESSONS_URL ?? 'http://localhost:3007/lessons',
  TELEMETRY_URL: env.VITE_TELEMETRY_URL ?? 'http://localhost:3001/events',
  SENSOR_UPLOAD_URL: env.VITE_SENSOR_UPLOAD_URL ?? 'http://localhost:3005/upload',
  AI_COACH_WS: env.VITE_AI_COACH_WS ?? 'ws://localhost:3003',
  REWARDS_URL: env.VITE_REWARDS_URL ?? 'http://localhost:3009',
} as const

/**
 * Card packs, rings and the collection. On by default on the gamification branch; set VITE_GAMIFICATION=false to
 * build the plain client from the same code.
 */
export const GAMIFICATION = env.VITE_GAMIFICATION !== 'false'

/** This client runs in a browser. The headset client reports `vr`. */
export const DEVICE = 'web' as const
