import { describe, expect, it } from 'vitest'
import { XapiVerb } from '@mmaxr/schema'
import type { ChemistryLessonContract, ChemistryRevealTube, TelemetryEvent } from '@mmaxr/schema'
import { ChemistryExperiment, StateError } from '../state/chemistry'

// The browser's view of the lesson: no solutions, only the neutral colour of each indicator.
const lesson: ChemistryLessonContract = {
  lessonId: 'chemistry-101',
  type: 'chemistry_indicators',
  title: 'Test lab',
  modelUrl: 'http://x/y.glb',
  config: { totalTestTubes: 2, requiredIndicatorsToSelect: 2 },
  indicators: [
    { id: 'litmus', name: 'Litmus', source: 'n', colors: { neutral: 'Purple' } },
    { id: 'turmeric', name: 'Turmeric', source: 'n', colors: { neutral: 'Yellow' } },
    { id: 'ph_paper', name: 'pH paper', source: 's', isPhTest: true },
  ],
}

// Stand-in for the server: what each test shows. The experiment itself never sees this table.
const SERVER: Record<string, string> = { '1:litmus': 'Red', '2:litmus': 'Blue', '1:turmeric': 'Yellow', '2:turmeric': 'Reddish-Brown', '1:ph_paper': 'Red', '2:ph_paper': 'Purple' }
const truth: ChemistryRevealTube[] = [
  { tube: 1, id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 },
  { tube: 2, id: 'naoh', name: 'Sodium Hydroxide', formula: 'NaOH', type: 'base', ph: 14 },
]

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new ChemistryExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 500))
  const test = (tube: number, tool: string, predicted: string, conf: 1 | 2 | 3 = 2) => {
    exp.selectTool(tool)
    exp.predict(tube, predicted, conf, 1500)
    return exp.act(SERVER[`${tube + 1}:${tool}`])
  }
  return { exp, events, test }
}
const start = (exp: ChemistryExperiment) => {
  exp.toggleIndicator('litmus')
  exp.toggleIndicator('turmeric')
  exp.startTesting()
}

describe('ChemistryExperiment', () => {
  it('holds no answers: tubes carry no solution and the lesson has none', () => {
    const { exp } = setup()
    const dump = JSON.stringify({ tubes: exp.tubes, lesson: exp.lesson })
    for (const secret of ['Hydrochloric', 'HCl', 'NaOH', 'solutionPool', 'assignedSolutions', 'acid', 'base"']) expect(dump).not.toContain(secret)
    expect(exp.tubes.every((t) => t.truth === null)).toBe(true)
  })

  it('blocks testing until the required indicators are chosen', () => {
    const { exp } = setup()
    expect(exp.canTest(0).ok).toBe(false)
    exp.toggleIndicator('litmus')
    expect(() => exp.startTesting()).toThrow(StateError)
    exp.toggleIndicator('turmeric')
    exp.startTesting()
    expect(exp.phase).toBe('testing')
  })

  it('refuses a third indicator and the pH paper as a choice', () => {
    const { exp } = setup()
    expect(exp.toggleIndicator('ph_paper')).toBe(false)
    exp.toggleIndicator('litmus')
    exp.toggleIndicator('turmeric')
    expect(exp.toggleIndicator('nope')).toBe(false)
  })

  it('enforces the prediction gate: no action without a prediction, none without a server result', () => {
    const { exp } = setup()
    start(exp)
    expect(() => exp.act('Red')).toThrow(StateError)
    expect(() => exp.predict(0, '', 2, 100)).toThrow(StateError)
    exp.predict(0, 'Red', 2, 100)
    expect(() => exp.act('')).toThrow(StateError)
  })

  it('fires PREDICTED before ACTED and OBSERVED, using the colour the server reported', () => {
    const { exp, events, test } = setup()
    start(exp)
    const r = test(0, 'litmus', 'Red', 3)
    expect(r.actual).toBe('Red')
    expect(r.match).toBe(true)
    expect(events.map((e) => e.verb).slice(-3)).toEqual([XapiVerb.PREDICTED, XapiVerb.ACTED, XapiVerb.OBSERVED])
    expect(events.find((e) => e.verb === XapiVerb.PREDICTED)!.object.value).toBe('Red')
  })

  it('does not allow a second test while one is pending, or repeating a result', () => {
    const { exp } = setup()
    start(exp)
    exp.predict(0, 'Red', 1, 10)
    expect(exp.canTest(1).ok).toBe(false)
    exp.act('Red')
    expect(exp.canTest(0).ok).toBe(false)
    expect(exp.canTest(1).ok).toBe(true)
  })

  it('logs REVISED_MODEL without saying whether either conclusion was right', () => {
    const { exp, events, test } = setup()
    start(exp)
    test(0, 'turmeric', 'Yellow')
    exp.setConclusion(0, 'neutral')
    test(0, 'litmus', 'Purple')
    exp.setConclusion(0, 'acid')
    const revised = events.filter((e) => e.verb === XapiVerb.REVISED_MODEL)
    expect(revised).toHaveLength(1)
    expect(revised[0].object.data).toMatchObject({ from: 'neutral', to: 'acid', evidenceCount: 2 })
    // No verdict-bearing fields: whether a conclusion is right is judged later from server-held truth.
    for (const leak of ['wasCorrect', 'nowCorrect', 'truth', 'actualPh', 'offBy']) expect(JSON.stringify(events)).not.toContain(leak)
  })

  it('keeps the pH paper locked until every chosen indicator is tested on every tube', () => {
    const { exp, events, test } = setup()
    start(exp)
    // The reported bug: one indicator on every tube, every tube concluded.
    test(0, 'litmus', 'Red')
    test(1, 'litmus', 'Blue')
    exp.setConclusion(0, 'acid')
    exp.setConclusion(1, 'base')
    expect(exp.phase).toBe('testing')
    expect(exp.indicatorTests).toEqual({ done: 2, total: 4 })
    expect(exp.allIndicatorsTested).toBe(false)
    // The other indicator can still be picked and used, and pH paper cannot.
    expect(exp.selectTool('ph_paper')).toBe(false)
    expect(exp.selectTool('turmeric')).toBe(true)
    expect(exp.canTest(0).ok).toBe(true)
    test(0, 'turmeric', 'Yellow')
    expect(exp.phase).toBe('testing')
    // The last indicator test, with every tube already concluded, unlocks it.
    test(1, 'turmeric', 'Reddish-Brown')
    expect(exp.phase).toBe('ph')
    expect(exp.activeTool).toBe('ph_paper')
    expect(events.filter((e) => e.object.action === 'unlock_ph_paper')).toHaveLength(1)
  })

  it('unlocks the pH paper on the last conclusion when every test is already done', () => {
    const { exp, test } = setup()
    start(exp)
    for (const tube of [0, 1]) for (const tool of ['litmus', 'turmeric']) test(tube, tool, 'Red')
    expect(exp.phase).toBe('testing')
    exp.setConclusion(0, 'acid')
    expect(exp.phase).toBe('testing')
    exp.setConclusion(1, 'base')
    expect(exp.phase).toBe('ph')
  })

  it('refuses to conclude an untested tube', () => {
    const { exp } = setup()
    start(exp)
    expect(() => exp.setConclusion(1, 'base')).toThrow(StateError)
  })

  it('walks the whole flow; the truth only arrives with finish()', () => {
    const { exp, events, test } = setup()
    start(exp)
    test(0, 'litmus', 'Red')
    exp.recordColor(0, 'litmus', 'Red')
    exp.setConclusion(0, 'acid')
    test(1, 'litmus', 'Purple')
    exp.setConclusion(1, 'base')
    // Concluded, but the second indicator is still untested on both tubes: pH paper stays locked.
    expect(exp.phase).toBe('testing')
    test(0, 'turmeric', 'Yellow')
    test(1, 'turmeric', 'Yellow')
    expect(exp.phase).toBe('ph')
    expect(exp.activeTool).toBe('ph_paper')
    test(0, 'ph_paper', 'Red', 3)
    exp.recordPh(0, 1)
    test(1, 'ph_paper', 'Purple', 3)
    expect(() => exp.submissionPayload()).toThrow(StateError)
    exp.recordPh(1, 13)

    const payload = exp.submissionPayload()
    expect(payload.tubes[0]).toMatchObject({ tube: 1, conclusion: 'acid', ph: 1 })
    expect(exp.tubes[0].truth).toBeNull()

    const s = exp.finish(truth)
    expect(exp.phase).toBe('reveal')
    expect(s.conclusionsCorrect).toBe(2)
    expect(s.phExact).toBe(1)
    expect(s.phWithinOne).toBe(2)
    expect(s.predictionsCorrect).toBe(4)
    expect(s.colorEntriesCorrect).toBe(1)
    const submit = events.find((e) => e.object.action === 'submit_analysis')!
    expect(JSON.stringify(submit)).not.toMatch(/Hydrochloric|HCl|truth|actualPh/)
  })

  it('rejects an out-of-range pH', () => {
    const { exp } = setup()
    expect(() => exp.recordPh(0, 20)).toThrow(StateError)
  })
})
