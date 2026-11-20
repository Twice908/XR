import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { MotionLessonContract, MotionObservation } from '@mmaxr/schema'
import { MotionExperiment, StateError } from '../state/motion'

const lesson: MotionLessonContract = {
  lessonId: 'physics-motion',
  type: 'physics_mechanics_sandbox',
  subject: 'Physics',
  title: 'Motion',
  summary: '',
  durationMinutes: 20,
  assets: { car: '', crate: '', feathers: '', cradle: '', pipe: '', trackStraight: '', trackCurve: '' },
  config: { enableScenarioSwitcher: true, minExplanationWords: 4 },
  uiSchema: { hasTabs: true, hasForceSlider: true, hasPlayPauseButton: true },
  scenarios: [
    {
      id: 'a',
      tabName: 'A',
      title: 'Module A',
      setup: '',
      trials: [
        { id: 'a1', kind: 'prediction', anomaly: false, action: 'go', prompt: 'p', needsExplanation: false, params: {}, input: { type: 'numeric', fields: [{ id: 'distance', label: 'Distance', unit: 'm' }, { id: 'displacement', label: 'Displacement', unit: 'm' }] } },
        { id: 'a2', kind: 'prediction', anomaly: true, action: 'go', prompt: 'p', needsExplanation: true, params: {}, input: { type: 'choice', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] } },
        { id: 'a3', kind: 'transfer', anomaly: false, action: null, prompt: 'p', needsExplanation: false, params: {}, input: { type: 'choice', options: [{ id: 'x', label: 'X' }] } },
      ],
    },
    { id: 'b', tabName: 'B', title: 'Module B', setup: '', trials: [{ id: 'b1', kind: 'prediction', anomaly: false, action: 'go', prompt: 'p', needsExplanation: false, params: {}, input: { type: 'choice', options: [{ id: 'x', label: 'X' }] } }] },
  ],
}
const obs = (trial: string, match: boolean, explanation: string | null): MotionObservation => ({ trial, match, fieldMatch: {}, answer: {}, outcome: 'o', law: null, explanation })

function setup() {
  const events: { verb: XapiVerb; object: { action?: string; data?: Record<string, unknown> } }[] = []
  let t = 1000
  const exp = new MotionExperiment(lesson, (verb, object) => events.push({ verb, object: object as never }), () => (t += 1000))
  return { exp, events }
}

describe('MotionExperiment', () => {
  it('needs a complete prediction and a confidence before it can lock', () => {
    const { exp } = setup()
    expect(exp.canLock).toBe(false)
    exp.setNumber('distance', '50')
    exp.setConfidence(2)
    expect(exp.canLock).toBe(false) // displacement missing
    exp.setNumber('displacement', '5,5') // decimal comma accepted
    expect(exp.canLock).toBe(true)
    expect(exp.predictionValue()).toEqual({ distance: 50, displacement: 5.5 })
    exp.setNumber('displacement', 'lots')
    expect(exp.canLock).toBe(false)
    expect(() => exp.lockPayload()).toThrow(StateError)
  })

  it('emits predicted, acted and observed in order, with the same sample and tool', () => {
    const { exp, events } = setup()
    exp.setNumber('distance', '50')
    exp.setNumber('displacement', '50')
    exp.setConfidence(3)
    const body = exp.lockPayload()
    exp.recordLocked(body.thinkMs)
    exp.startRun()
    exp.recordObservation(obs('a1', true, 'because'))
    const [p, a, o] = events.filter((e) => e.object.action !== 'arrive_checkpoint')
    expect([p.verb, a.verb, o.verb]).toEqual([XapiVerb.PREDICTED, XapiVerb.ACTED, XapiVerb.OBSERVED])
    expect(p.object.data).toMatchObject({ sample: 1, tool: 'run', confidence: 3, trial: 'a1' })
    expect(a.object.data).toMatchObject({ sample: 1, tool: 'run' })
    expect(o.object.data).toMatchObject({ sample: 1, tool: 'run', match: true })
    expect(exp.current.stage).toBe('done')
  })

  it('cannot change a locked prediction, or run before locking', () => {
    const { exp } = setup()
    expect(() => exp.startRun()).toThrow(StateError)
    exp.setNumber('distance', '1')
    exp.setNumber('displacement', '1')
    exp.setConfidence(1)
    exp.recordLocked(exp.lockPayload().thinkMs)
    expect(() => exp.setNumber('distance', '9')).toThrow(StateError)
    expect(() => exp.setConfidence(3)).toThrow(StateError)
  })

  it('keeps a finished question on screen until the student moves on', () => {
    const { exp } = setup()
    exp.setNumber('distance', '1')
    exp.setNumber('displacement', '1')
    exp.setConfidence(1)
    exp.recordLocked(0)
    exp.startRun()
    exp.recordObservation(obs('a1', true, 'e'))
    expect(exp.current.trial.id).toBe('a1')
    expect(exp.canAdvance).toBe(true)
    exp.advance()
    expect(exp.current.trial.id).toBe('a2')
    expect(exp.current.stage).toBe('open')
  })

  it('an anomaly waits for an explanation of enough words', () => {
    const { exp, events } = setup()
    // finish a1
    exp.setNumber('distance', '1'); exp.setNumber('displacement', '1'); exp.setConfidence(1)
    exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a1', true, 'e')); exp.advance()
    exp.setChoice('x'); exp.setConfidence(2); exp.recordLocked(0); exp.startRun()
    exp.recordObservation(obs('a2', false, null))
    expect(exp.current.stage).toBe('observed')
    exp.setExplanation('too short')
    expect(exp.canExplain).toBe(false)
    expect(() => exp.explainPayload()).toThrow(StateError)
    exp.setExplanation('this is long enough now')
    expect(exp.canExplain).toBe(true)
    exp.recordExplained({ keywords: [{ keyword: 'k', matched: true }], coverage: 1, explanation: 'why' })
    expect(exp.current.stage).toBe('done')
    expect(events.at(-1)?.object.action).toBe('explain_result')
    expect(exp.current.observation?.explanation).toBe('why')
  })

  it('carries whether the explanation was spoken', () => {
    const { exp, events } = setup()
    exp.setNumber('distance', '1'); exp.setNumber('displacement', '1'); exp.setConfidence(1)
    exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a1', true, 'e')); exp.advance()
    exp.setChoice('x'); exp.setConfidence(2); exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a2', false, null))
    exp.setExplanation('this is long enough now', 'voice', 8000)
    expect(exp.explainPayload()).toMatchObject({ inputMode: 'voice', speakMs: 8000 })
    exp.recordExplained({ keywords: [], coverage: 1, explanation: 'e' })
    expect(events.at(-1)?.object.data).toMatchObject({ inputMode: 'voice', speakMs: 8000 })
  })

  it('a question with no simulation emits answer events instead of run events', () => {
    const { exp, events } = setup()
    exp.setNumber('distance', '1'); exp.setNumber('displacement', '1'); exp.setConfidence(1)
    exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a1', true, 'e')); exp.advance()
    exp.setChoice('x'); exp.setConfidence(2); exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a2', true, null))
    exp.setExplanation('a perfectly fine explanation text'); exp.recordExplained({ keywords: [], coverage: 1, explanation: 'e' }); exp.advance()
    exp.setChoice('x'); exp.setConfidence(2); exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('a3', true, 'e'))
    const actions = events.map((e) => e.object.action)
    expect(actions).toContain('predict_transfer')
    expect(actions).toContain('answer_transfer')
    expect(actions).toContain('transfer_result')
    expect(exp.moduleDone('a')).toBe(true)
  })

  it('switching module is recorded, and everything done is reported exactly once', () => {
    const { exp, events } = setup()
    exp.switchModule('b')
    expect(events.at(-1)?.object.action).toBe('select_module')
    exp.switchModule('b')
    expect(events.filter((e) => e.object.action === 'select_module')).toHaveLength(1)
    exp.setChoice('x'); exp.setConfidence(1); exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs('b1', true, 'e'))
    expect(exp.allDone).toBe(false)
    exp.switchModule('a')
    for (const id of ['a1', 'a2', 'a3']) {
      if (id === 'a1') { exp.setNumber('distance', '1'); exp.setNumber('displacement', '1') } else exp.setChoice('x')
      exp.setConfidence(2); exp.recordLocked(0); exp.startRun(); exp.recordObservation(obs(id, true, id === 'a2' ? null : 'e'))
      if (id === 'a2') { exp.setExplanation('a perfectly fine explanation text'); exp.recordExplained({ keywords: [], coverage: 1, explanation: 'e' }) }
      if (exp.canAdvance) exp.advance()
    }
    expect(exp.allDone).toBe(true)
    expect(events.filter((e) => e.object.action === 'submit_analysis')).toHaveLength(1)
    const s = exp.summary()
    expect(s.predictions).toBe(3)
    expect(s.transfer).toBe(1)
  })
})
