export const CONFIG = {
  AUTH_URL: 'http://localhost:3004/auth/session',
  LESSONS_URL: 'http://localhost:3007/lessons/active',
  TELEMETRY_URL: 'http://localhost:3001/events',
  SENSOR_UPLOAD_URL: 'http://localhost:3005/upload',
  AI_COACH_WS: 'ws://localhost:3003',
  DEFAULT_STUDENT_ID: 'student_99',
} as const