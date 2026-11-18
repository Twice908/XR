import type { LessonContract } from '@mmaxr/schema'
import type { ChemistryLessonContract } from '../services/lessons'
import { telemetry } from '../services/telemetry'
import { XapiVerb } from '@mmaxr/schema'
import { phPaperColor } from '../services/colors'

// ---- Physics ----

function createPhysicsMachine(lesson: LessonContract) {
  const p = lesson.simulation
  let trialCount = 0
  let anomalyResolved = false

  return {
    type: 'physics' as const,
    params: p,
    energyEv(nFrom: number, nTo: number): number {
      return 13.6 * p.atomicNumber ** 2 * (1 / nTo ** 2 - 1 / nFrom ** 2)
    },
    wavelengthNm(nFrom: number, nTo: number): number {
      return Math.abs(1240 / this.energyEv(nFrom, nTo))
    },
    registerTrial() {
      trialCount++
      const isAnomaly = trialCount === p.anomalyTrialNumber && !anomalyResolved
      telemetry.emit(XapiVerb.Attempted, 'photon-trial', { trial: trialCount, anomaly: isAnomaly })
      return { isAnomaly, multiplier: isAnomaly ? p.anomalyShiftMultiplier : 1 }
    },
    resolveAnomaly() {
      if (anomalyResolved) return
      anomalyResolved = true
      telemetry.emit(XapiVerb.Completed, 'anomaly-resolution', { trial: trialCount })
    },
    get trialCount() {
      return trialCount
    },
    get anomalyResolved() {
      return anomalyResolved
    },
  }
}

// ---- Chemistry ----

export type Conclusion = 'acid' | 'base' | 'neutral'

export interface ChemistryTubeState {
  solution: ChemistryLessonContract['assignedSolutions'][number]
  indicatorsApplied: string[]
  observedColors: string[]
  predictedColors: string[]
  conclusion: Conclusion | null
}

function normalizeAcidBase(type: string): Conclusion {
  const t = (type ?? '').toLowerCase()
  if (t.includes('acid')) return 'acid'
  if (t.includes('base') || t.includes('alkaline')) return 'base'
  return 'neutral'
}

function createChemistryMachine(lesson: ChemistryLessonContract) {
  const tubes: ChemistryTubeState[] = lesson.assignedSolutions.map((sol) => ({
    solution: sol,
    indicatorsApplied: [],
    observedColors: [],
    predictedColors: [],
    conclusion: null,
  }))

  const machine = {
    type: 'chemistry_indicators' as const,
    lesson,
    tubes,
    revealed: false,

    get maxIndicatorsPerTube(): number {
      return lesson.config.requiredIndicatorsToSelect
    },

    getIndicator(indicatorId: string) {
      return lesson.indicators.find((i) => i.id === indicatorId) ?? null
    },

    /** Predicted color logged to telemetry the moment the student confirms */
    logPrediction(tubeIndex: number, indicatorId: string, predictedColor: string): void {
      telemetry.emit(XapiVerb.Predicted, 'indicator-color-prediction', {
        tube: tubeIndex + 1,
        indicator: indicatorId,
        predictedColor,
      })
    },

    /** Apply an indicator: compute result color, update state, log telemetry */
    applyIndicator(
      tubeIndex: number,
      indicatorId: string,
      predictedColor: string,
    ): {
      resultColor: string
      indicatorName: string
      solutionType: Conclusion
    } | null {
      const tube = tubes[tubeIndex]
      if (!tube) return null
      if (tube.indicatorsApplied.length >= lesson.config.requiredIndicatorsToSelect) return null
      if (tube.indicatorsApplied.includes(indicatorId)) return null

      const indicator = lesson.indicators.find((i) => i.id === indicatorId)
      if (!indicator) return null

      const solutionType = normalizeAcidBase(tube.solution.type)
      const resultColor = indicator.isPhTest
        ? phPaperColor(tube.solution.ph)
        : indicator.colors?.[solutionType]
      if (!resultColor) return null

      tube.indicatorsApplied.push(indicatorId)
      tube.observedColors.push(resultColor)
      tube.predictedColors.push(predictedColor)

      telemetry.emit(XapiVerb.Attempted, 'indicator-application', {
        tube: tubeIndex + 1,
        indicator: indicatorId,
        predictedColor,
        actualColor: resultColor,
        solutionType,
        match: predictedColor.toLowerCase() === resultColor.toLowerCase(),
      })

      return { resultColor, indicatorName: indicator.name, solutionType }
    },

    setConclusion(tubeIndex: number, conclusion: Conclusion): void {
      const tube = tubes[tubeIndex]
      if (!tube) return
      tube.conclusion = conclusion
      telemetry.emit(XapiVerb.Completed, 'conclusion-set', {
        tube: tubeIndex + 1,
        conclusion,
        correct: conclusion === normalizeAcidBase(tube.solution.type),
      })
    },

    submit(): void {
      if (machine.revealed) return
      machine.revealed = true

      telemetry.emit(XapiVerb.Completed, 'analysis-submitted', {
        tubes: tubes.map((t, i) => ({
          tube: i + 1,
          solutionId: t.solution.id,
          studentConclusion: t.conclusion,
          correct: t.conclusion === normalizeAcidBase(t.solution.type),
          actualType: normalizeAcidBase(t.solution.type),
          actualPh: t.solution.ph,
          indicatorsUsed: t.indicatorsApplied,
        })),
      })
    },
  }

  return machine
}

export type PhysicsMachine = ReturnType<typeof createPhysicsMachine>
export type ChemistryMachine = ReturnType<typeof createChemistryMachine>
export type StateMachine = PhysicsMachine | ChemistryMachine

export function createStateMachine(
  lesson: LessonContract | ChemistryLessonContract,
): StateMachine {
  if (lesson.type === 'chemistry_indicators') {
    return createChemistryMachine(lesson)
  }
  return createPhysicsMachine(lesson as LessonContract)
}

export function solutionTypeOf(tube: ChemistryTubeState): Conclusion {
  return normalizeAcidBase(tube.solution.type)
}