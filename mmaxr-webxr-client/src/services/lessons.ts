import type { LessonContract } from '@mmaxr/schema'
import { CONFIG } from '../config'

export async function fetchActiveLesson(): Promise<LessonContract> {
  const res = await fetch(CONFIG.LESSONS_URL)
  if (!res.ok) {
    throw new Error(`Lesson ${res.status}: ${res.statusText}`)
  }
  const lesson = (await res.json()) as LessonContract

  // Fail-fast so the state machine never receives garbage
  if (!lesson.modelUrl) throw new Error('LessonContract missing modelUrl')
  if (!lesson.simulation) throw new Error('LessonContract missing simulation')

  return lesson
}