import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { BiologyLessonContract, BiologyReveal, TelemetryEvent } from '@mmaxr/schema'
import { JourneyExperiment, StateError } from '../state/biology'

const lesson: BiologyLessonContract = {
  lessonId: 'biology-101',
  type: 'biology_digestive_system',
  title: 'Digestive system',
  modelUrl: 'http://x/d.glb',
  assets: { digestiveSystem: 'a', stomach: 'b', liver: 'c', tooth: 'd' },
  config: { isGuidedTour: true, requireAudioExplanation: true, minExplanationWords: 4, maxRevisions: 2 },
  choices: { glands: [{ id: 'salivary', label: 'Salivary' }, { id: 'none', label: 'None' }], juices: [{ id: 'saliva', label: 'Saliva' }, { id: 'none', label: 'None' }], nutrients: [{ id: 'carbs', label: 'Carbs' }] },
  checkpoints: [
    { id: 'mouth', organName: 'Mouth', prompt: 'p1', cameraPosition: { x: 0, y: 0, z: 0 }, lookAtTarget: { x: 0, y: 0, z: 0 }, modelAnchor: { x: 0, y: 0, z: 0 }, detail: 'tooth' },
    { id: 'stomach', organName: 'Stomach', prompt: 'p2', cameraPosition: { x: 0, y: 0, z: 0 }, lookAtTarget: { x: 0, y: 0, z: 0 }, modelAnchor: { x: 0, y: 0, z: 0 }, detail: 'stomach' },
  ],
  transfer: { scenarios: [{ id: 's1', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] },
}

const reveal = (cp: string, all: boolean, coverage: number): BiologyReveal => ({
  checkpoint: cp, explanation: 'x', answer: { glands: [], juices: [], nutrients: [], targetNutrient: 't' },
  selectionScore: { glands: all ? 1 : 0.5, juices: 1, nutrients: 1, allCorrect: all }, keywords: [], coverage,
})

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new JourneyExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 800))
  const lock = () => {
    exp.toggle('glands', 'salivary'); exp.toggle('juices', 'saliva'); exp.toggle('nutrients', 'carbs'); exp.setConfidence(2)
    exp.lockPrediction()
  }
  return { exp, events, lock }
}

describe('JourneyExperiment', () => {
  it('holds no answers: stops carry only what the student chose', () => {
    const { exp } = setup()
    const dump = JSON.stringify(exp.stops)
    for (const secret of ['revealExplanation', 'expectedKeywords', 'answerGlands']) expect(dump).not.toContain(secret)
    expect(exp.stops.every((s) => s.reveal === null)).toBe(true)
  })

  it('needs a gland, a juice, a nutrient and a confidence before the prediction locks', () => {
    const { exp } = setup()
    expect(exp.canLock).toBe(false)
    expect(() => exp.lockPrediction()).toThrow(StateError)
    exp.toggle('glands', 'salivary')
    exp.toggle('juices', 'saliva')
    exp.toggle('nutrients', 'carbs')
    expect(exp.canLock).toBe(false)
    exp.setConfidence(3)
    expect(exp.canLock).toBe(true)
  })

  it('"none" excludes the other choices in its group and back again', () => {
    const { exp } = setup()
    exp.toggle('glands', 'salivary')
    exp.toggle('glands', 'none')
    expect(exp.stop.selection.glands).toEqual(['none'])
    exp.toggle('glands', 'salivary')
    expect(exp.stop.selection.glands).toEqual(['salivary'])
  })

  it('locking fires PREDICTED with the think time; the selection cannot change afterwards', () => {
    const { exp, events, lock } = setup()
    lock()
    const p = events.find((e) => e.verb === XapiVerb.PREDICTED)!
    expect(p.object.data).toMatchObject({ sample: 1, tool: 'explain', confidence: 2, checkpoint: 'mouth' })
    expect(Number((p.object.data as { decisionMs: number }).decisionMs)).toBeGreaterThan(0)
    expect(() => exp.toggle('glands', 'none')).toThrow(StateError)
  })

  it('requires enough words, then ACTED and OBSERVED follow the server reveal', () => {
    const { exp, events, lock } = setup()
    lock()
    expect(() => exp.commitPayload('too short', 'typed', 0)).toThrow(StateError)
    const body = exp.commitPayload('saliva has amylase for starch', 'voice', 4200)
    expect(body).toMatchObject({ checkpoint: 'mouth', inputMode: 'voice', speakMs: 4200 })
    exp.recordReveal(reveal('mouth', true, 0.8))
    expect(exp.stage).toBe('revealed')
    expect(events.map((e) => e.verb).slice(-3)).toEqual([XapiVerb.PREDICTED, XapiVerb.ACTED, XapiVerb.OBSERVED])
    const obs = events[events.length - 1].object.data as { match: boolean; coverage: number }
    expect(obs).toMatchObject({ match: true, coverage: 0.8 })
  })

  it('a revision is only offered while there is something to improve and revisions remain', () => {
    const { exp, events, lock } = setup()
    lock()
    exp.commitPayload('saliva has amylase for starch', 'typed', 0)
    exp.recordReveal(reveal('mouth', false, 0.4))
    expect(exp.canRevise).toBe(true)
    exp.recordRevision('saliva amylase starch chewing carbohydrate', 1, 1)
    expect(events.find((e) => e.verb === XapiVerb.REVISED_MODEL)!.object.data).toMatchObject({ coverageBefore: 0.4, coverageAfter: 1, revision: 1 })
    expect(exp.canRevise).toBe(false) // coverage is already complete
  })

  it('moves in order, then the challenge, then done', () => {
    const { exp, events, lock } = setup()
    lock(); exp.commitPayload('saliva has amylase for starch', 'typed', 0); exp.recordReveal(reveal('mouth', true, 1))
    exp.next()
    expect(exp.index).toBe(1)
    expect(exp.stage).toBe('predict')
    exp.toggle('glands', 'salivary'); exp.toggle('juices', 'saliva'); exp.toggle('nutrients', 'carbs'); exp.setConfidence(1); exp.lockPrediction()
    exp.commitPayload('pepsin and acid break down protein', 'typed', 0); exp.recordReveal(reveal('stomach', true, 1))
    exp.next()
    expect(exp.stage).toBe('final')
    expect(exp.canSubmitFinal).toBe(false)
    exp.scenarioAnswers.s1 = 'a'
    expect(exp.canSubmitFinal).toBe(true)
    exp.finish({ correct: 1, total: 1, results: [] })
    expect(exp.stage).toBe('done')
    expect(events.some((e) => e.object.action === 'submit_analysis')).toBe(true)
    expect(JSON.stringify(events)).not.toMatch(/revealExplanation|expectedKeywords/)
  })
})
