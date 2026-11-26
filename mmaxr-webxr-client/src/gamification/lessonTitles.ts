import { listLessons } from '../services/lessons'
import { prettyLesson } from './rarity'

let titles: Map<string, string> | null = null
let loading: Promise<void> | null = null

/** Lesson titles for pack labels, loaded once. Falls back to a tidied id while loading or offline. */
export function lessonTitle(lessonId: string | null): string {
  if (!lessonId) return 'This week'
  if (!titles && !loading) {
    loading = listLessons()
      .then((list) => {
        titles = new Map(list.map((l) => [l.lessonId, l.title]))
      })
      .catch(() => {
        loading = null
      })
  }
  return titles?.get(lessonId) ?? prettyLesson(lessonId)
}

export async function loadLessonTitles(): Promise<void> {
  lessonTitle('')
  await loading
}
