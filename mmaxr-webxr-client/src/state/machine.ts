import type { LessonContract } from '@mmaxr/schema'
import { telemetry } from '../services/telemetry'
import { XapiVerb } from '@mmaxr/schema'

export function createStateMachine(lesson: LessonContract) {
  const p = lesson.simulation
  let trialCount = 0
  let anomalyResolved = false

  const machine = {
    params: p,

    /** E ∝ Z² · (1/nFinal² − 1/nInitial²) in eV (Rydberg approximation) */
    energyEv(nFrom: number, nTo: number): number {
      const RYDBERG = 13.6
      return RYDBERG * p.atomicNumber ** 2 * (1 / nTo ** 2 - 1 / nFrom ** 2)
    },

    /** λ (nm) via E = hc/λ, hc ≈ 1240 eV·nm */
    wavelengthNm(nFrom: number, nTo: number): number {
      const eV = this.energyEv(nFrom, nTo)
      return Math.abs(1240 / eV)
    },

    registerTrial(): { isAnomaly: boolean; multiplier: number } {
      trialCount++
      const isAnomaly = trialCount === p.anomalyTrialNumber && !anomalyResolved
      telemetry.emit(
        XapiVerb.Attempted,
        'photon-trial',
        { trial: trialCount, anomaly: isAnomaly },
      )
      return {
        isAnomaly,
        multiplier: isAnomaly ? p.anomalyShiftMultiplier : 1,
      }
    },

    resolveAnomaly() {
      if (anomalyResolved) return
      anomalyResolved = true
      telemetry.emit(XapiVerb.Completed, 'anomaly-resolution', {
        trial: trialCount,
      })
    },

    get trialCount() { return trialCount },
    get anomalyResolved() { return anomalyResolved },
  }

  return machine
}

export type StateMachine = ReturnType<typeof createStateMachine>