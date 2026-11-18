import type { LessonContract } from '@mmaxr/schema'
import { CONFIG } from '../config'

export interface ChemistryIndicator {
  id: string
  name: string
  source: string
  /** Absent on pH-test indicators (e.g. universal pH paper), which read the solution pH instead. */
  colors?: { neutral: string; acid: string; base: string }
  isPhTest?: boolean
}

export interface ChemistrySolution {
  id: string
  name: string
  formula: string
  type: string
  ph: number
}

export interface ChemistryLessonContract {
  lessonId: string
  type: 'chemistry_indicators'
  title: string
  modelUrl: string
  config: {
    totalTestTubes: number
    requiredIndicatorsToSelect: number
  }
  indicators: ChemistryIndicator[]
  assignedSolutions: ChemistrySolution[]
  /** Optional — if backend provides them, we use these URLs instead of deriving */
  assets?: {
    testTube?: string
    erlenmeyer?: string
    dropper?: string
  }
}

export type AnyLesson = LessonContract | ChemistryLessonContract

export async function fetchActiveLesson(
  type?: 'physics' | 'chemistry',
): Promise<AnyLesson> {
  const url = new URL(CONFIG.LESSONS_URL)
  if (type) url.searchParams.set('type', type)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Lesson ${res.status}: ${res.statusText}`)
  }

  const lesson = (await res.json()) as AnyLesson
  if (!lesson.modelUrl) throw new Error('Lesson missing modelUrl')

  if (lesson.type === 'chemistry_indicators') {
    if (!lesson.config) throw new Error('Chemistry lesson missing config')
    if (!Array.isArray(lesson.assignedSolutions)) {
      throw new Error('Chemistry lesson missing assignedSolutions')
    }
    if (!Array.isArray(lesson.indicators)) {
      throw new Error('Chemistry lesson missing indicators')
    }
  } else {
    if (!(lesson as LessonContract).simulation) {
      throw new Error('Physics lesson missing simulation')
    }
  }

  return lesson
}