const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

export const CONFIG = {
  USER_AUTH_URL: env.VITE_USER_AUTH_URL ?? 'http://localhost:3008',
  SESSION_AUTH_URL: env.VITE_SESSION_AUTH_URL ?? 'http://localhost:3004/auth/session',
  LESSONS_URL: env.VITE_LESSONS_URL ?? 'http://localhost:3007/lessons',
  TELEMETRY_URL: env.VITE_TELEMETRY_URL ?? 'http://localhost:3001/events',
  SENSOR_UPLOAD_URL: env.VITE_SENSOR_UPLOAD_URL ?? 'http://localhost:3005/upload',
  AI_COACH_WS: env.VITE_AI_COACH_WS ?? 'ws://localhost:3003',
} as const
