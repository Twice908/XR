import type { ChemistryLessonContract, LessonContract, LessonSummary } from '@mmaxr/schema'
import { CONFIG } from '../config'

export async function listLessons(): Promise<LessonSummary[]> {
  const res = await fetch(CONFIG.LESSONS_URL)
  if (!res.ok) throw new Error(`Experiments failed to load (${res.status})`)
  return (await res.json()) as LessonSummary[]
}

/** The lesson for one session. The server binds the (hidden) tube assignment to the session; none of it is sent here. */
export async function fetchLesson(lessonId: string, session: { sessionId: string; token: string }): Promise<LessonContract> {
  const res = await fetch(`${CONFIG.LESSONS_URL}/${encodeURIComponent(lessonId)}?sessionId=${encodeURIComponent(session.sessionId)}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  })
  if (!res.ok) throw new Error(`Lesson ${lessonId} failed to load (${res.status})`)
  const lesson = (await res.json()) as LessonContract
  if (!lesson.modelUrl) throw new Error('Lesson contract is missing modelUrl')
  return lesson
}

export function assertChemistry(lesson: LessonContract): ChemistryLessonContract {
  if (lesson.type !== 'chemistry_indicators') throw new Error(`Unsupported lab type: ${lesson.type}`)
  if (!lesson.config?.totalTestTubes) throw new Error('Lesson contract has no test tubes')
  if (!lesson.indicators?.length) throw new Error('Lesson contract has no indicators')
  return lesson
}
