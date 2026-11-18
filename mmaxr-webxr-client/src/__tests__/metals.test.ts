import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { MetalsLessonContract, MetalsRevealSample, TelemetryEvent } from '@mmaxr/schema'
import { MetalsExperiment, StateError } from '../state/metals'

const lesson: MetalsLessonContract = {
  lessonId: 'metals-101',
  type: 'chemistry_metals',
  title: 'Metals',
  modelUrl: 'http://x/b.glb',
  config: { totalSamples: 3, testBudget: 5, minTestsPerSample: 1, requirePredictionBeforeTest: true },
  tools: [
    { id: 'hammer', name: 'Hammer', property: 'Malleability', group: 'Physical', question: 'q', outcomes: [{ id: 'flattens', label: 'Flattens' }, { id: 'shatters', label: 'Shatters' }, { id: 'not_possible', label: 'n/a' }] },
    { id: 'circuit', name: 'Circuit', property: 'Electrical conductivity', group: 'Physical', question: 'q', outcomes: [{ id: 'glows', label: 'Glows' }, { id: 'dark', label: 'Dark' }] },
  ],
  samples: [
    { slot: 1, color: 'grey', colorHex: '#888', state: 'solid', lustre: 'shiny', texture: 'chunk' },
    { slot: 2, color: 'black', colorHex: '#222', state: 'solid', lustre: 'dull', texture: 'flaky' },
    { slot: 3, color: 'silver', colorHex: '#ccc', state: 'liquid', lustre: 'shiny', texture: 'liquid' },
  ],
}
const SERVER: Record<string, { outcome: string }> = {
  '1:hammer': { outcome: 'flattens' }, '1:circuit': { outcome: 'glows' },
  '2:hammer': { outcome: 'shatters' }, '2:circuit': { outcome: 'glows' },
  '3:hammer': { outcome: 'not_possible' }, '3:circuit': { outcome: 'glows' },
}
const truth: MetalsRevealSample[] = [
  { sample: 1, id: 'iron', name: 'Iron', formula: 'Fe', type: 'metal', anomaly: false, why: '', results: {}, oxideLitmus: 'no_change' },
  { sample: 2, id: 'graphite', name: 'Graphite', formula: 'C', type: 'non-metal', anomaly: true, why: 'x', results: {}, oxideLitmus: 'none' },
  { sample: 3, id: 'mercury', name: 'Mercury', formula: 'Hg', type: 'metal', anomaly: true, why: 'y', results: {}, oxideLitmus: 'no_change' },
]

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new MetalsExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 500))
  const classify = (a: ('metal' | 'non-metal')[]) => a.forEach((k, i) => exp.setHypothesis(i, k, 2))
  const test = (i: number, tool: string, predicted: string) => {
    exp.selectTool(tool)
    exp.predict(i, predicted, 2, 1500)
    return exp.act(SERVER[`${i + 1}:${tool}`])
  }
  return { exp, events, classify, test }
}

describe('MetalsExperiment', () => {
  it('holds no answers: samples carry looks only', () => {
    const { exp } = setup()
    const dump = JSON.stringify(exp.samples)
    for (const secret of ['Iron', 'Graphite', 'Mercury', 'formula', 'anomaly']) expect(dump).not.toContain(secret)
    expect(exp.samples.every((s) => s.truth === null)).toBe(true)
  })

  it('locks testing until every sample has a first impression', () => {
    const { exp } = setup()
    expect(exp.canTest(0).ok).toBe(false)
    exp.setHypothesis(0, 'metal', 3)
    exp.setHypothesis(1, 'non-metal', 1)
    expect(exp.phase).toBe('hypothesis')
    exp.setHypothesis(2, 'metal', 2)
    expect(exp.phase).toBe('testing')
    expect(exp.canTest(0).ok).toBe(true)
  })

  it('enforces the prediction gate and rejects an option the tool does not offer', () => {
    const { exp, classify } = setup()
    classify(['metal', 'metal', 'metal'])
    expect(() => exp.act({ outcome: 'flattens' })).toThrow(StateError)
    expect(() => exp.predict(0, 'nonsense', 2, 100)).toThrow(StateError)
    exp.predict(0, 'flattens', 2, 100)
    expect(() => exp.act({ outcome: '' })).toThrow(StateError)
  })

  it('fires PREDICTED then ACTED then OBSERVED with the server outcome, and spends budget', () => {
    const { exp, events, classify, test } = setup()
    classify(['metal', 'metal', 'metal'])
    const r = test(1, 'hammer', 'flattens')
    expect(r.match).toBe(false)
    expect(r.actual).toBe('shatters')
    expect(events.map((e) => e.verb).slice(-3)).toEqual([XapiVerb.PREDICTED, XapiVerb.ACTED, XapiVerb.OBSERVED])
    expect(exp.used).toBe(1)
    expect(exp.remaining).toBe(4)
  })

  it('stops at the budget and does not allow repeating a result', () => {
    const { exp, classify, test } = setup()
    classify(['metal', 'metal', 'metal'])
    test(0, 'hammer', 'flattens'); test(0, 'circuit', 'glows'); test(1, 'hammer', 'shatters'); test(1, 'circuit', 'glows')
    expect(exp.canTest(1).ok).toBe(false) // already done
    test(2, 'hammer', 'not_possible')
    expect(exp.remaining).toBe(0)
    exp.selectTool('circuit')
    expect(exp.canTest(2).reason).toMatch(/budget/i)
  })

  it('treats a changed conclusion as a revision without saying whether it was right', () => {
    const { exp, events, classify, test } = setup()
    classify(['metal', 'metal', 'metal'])
    test(1, 'hammer', 'flattens')
    exp.setConclusion(1, 'non-metal')
    const rev = events.find((e) => e.verb === XapiVerb.REVISED_MODEL)!
    expect(rev.object.data).toMatchObject({ sample: 2, from: 'metal', to: 'non-metal', evidenceCount: 1 })
    for (const leak of ['wasCorrect', 'nowCorrect', 'truth']) expect(JSON.stringify(events)).not.toContain(leak)
  })

  it('needs a conclusion and enough evidence on every sample before submitting', () => {
    const { exp, classify, test } = setup()
    classify(['metal', 'non-metal', 'metal'])
    test(0, 'hammer', 'flattens')
    expect(exp.canSubmit).toBe(false)
    expect(exp.submitBlocker).toMatch(/sample 2, 3/)
    test(1, 'hammer', 'shatters')
    test(2, 'hammer', 'not_possible')
    expect(exp.canSubmit).toBe(true)
  })

  it('discloses the truth only through finish() and then summarises', () => {
    const { exp, events, classify, test } = setup()
    classify(['metal', 'metal', 'metal'])
    test(0, 'hammer', 'flattens'); test(1, 'hammer', 'shatters'); test(2, 'hammer', 'not_possible')
    exp.setConclusion(1, 'non-metal')
    const payload = exp.submissionPayload()
    expect(payload.samples[1]).toMatchObject({ sample: 2, conclusion: 'non-metal', hypothesis: 'metal' })
    expect(exp.samples[1].truth).toBeNull()
    const s = exp.finish(truth)
    expect(exp.phase).toBe('reveal')
    expect(s).toMatchObject({ correct: 3, hypothesisCorrect: 2, revisions: 1, exceptions: 2, exceptionsCaught: 2, predictions: 3, predictionsCorrect: 3, testsUsed: 3 })
    const submit = events.find((e) => e.object.action === 'submit_analysis')!
    expect(JSON.stringify(submit)).not.toMatch(/Graphite|Mercury|formula|type/)
  })
})
