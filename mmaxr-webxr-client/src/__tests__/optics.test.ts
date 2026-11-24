import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { XapiVerb } from '@mmaxr/schema'
import type { OpticsLessonContract, OpticsReveal, OpticsTrialResult, TelemetryEvent } from '@mmaxr/schema'
import { OpticsExperiment, StateError } from '../state/optics'

const full: any = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../mmaxr-platform/services/lesson-loader/data/physics-light.json'), 'utf8'))
const lesson: OpticsLessonContract = full

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new OpticsExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 800))
  return { exp, events }
}

/** What the server would say (computed here from the full lesson, which the browser never has). */
const serve = (exp: OpticsExperiment, id: string): OpticsTrialResult => {
  const t = exp.trial(id)
  if (t.kind === 'plane') {
    const s = full.planeMirror.scenarios.find((x: any) => x.id === id)
    return { kind: 'plane', id, match: t.prediction!.outcome === s.result, outcome: s.result, explanation: s.explanation }
  }
  if (t.kind === 'law') {
    const l = full.lawsOfReflection.laws.find((x: any) => x.id === id)
    return { kind: 'law', id, match: t.prediction!.outcome === l.answer, outcome: l.answer, explanation: l.explanation }
  }
  if (t.kind === 'rule') {
    const r = full.rayRules.rules.find((x: any) => x.id === id)
    return { kind: 'rule', id, match: t.prediction!.outcome === r.reflected, outcome: r.reflected, explanation: r.explanation }
  }
  const c = full.sphericalMirrors.flatMap((m: any) => m.cases).find((x: any) => x.id === id)
  const fields: any = {}
  for (const f of Object.keys(c.expectedImage)) fields[f] = t.prediction![f] === c.expectedImage[f]
  return { kind: 'case', id, match: Object.values(fields).every(Boolean), image: c.expectedImage, fields, anomaly: c.isAnomaly, explanation: c.anomalyExplanation ?? '' }
}

const truth = (id: string) => full.sphericalMirrors.flatMap((m: any) => m.cases).find((x: any) => x.id === id).expectedImage
const META = { inputMode: 'typed' as const, speakMs: 0, pasted: 0, blurs: 0 }
const run = (exp: OpticsExperiment, id: string, right = true, explain = true) => {
  const pre = exp.trial(id)
  let prediction: Record<string, string>
  if (pre.kind === 'plane') prediction = { outcome: right ? full.planeMirror.scenarios.find((s: any) => s.id === id).result : 'x' }
  else if (pre.kind === 'law') prediction = { outcome: right ? full.lawsOfReflection.laws.find((l: any) => l.id === id).answer : 'x' }
  else if (pre.kind === 'rule') prediction = { outcome: right ? full.rayRules.rules.find((r: any) => r.id === id).reflected : 'x' }
  else prediction = right ? { ...truth(id) } : { position: 'at_c', size: 'same_size', nature: 'real', orientation: 'inverted' }
  exp.predict(id, prediction, 2, 3000)
  const t = exp.act(serve(exp, id))
  if (explain && exp.needsExplanation(t)) exp.explained(id, 'I watched the beam on the bench and compared it with what I predicted', META)
  return t
}
const runAll = (exp: OpticsExperiment, right = true) => exp.items.forEach((t) => run(exp, t.id, right))

describe('OpticsExperiment flow', () => {
  it('walks plane mirror, laws, rules, concave, convex, then the table', () => {
    const { exp } = setup()
    expect(exp.phase).toBe('plane')
    run(exp, 'smooth')
    expect(exp.phase).toBe('plane')
    run(exp, 'rough')
    expect(exp.phase).toBe('laws')
    for (const l of exp.of('law')) run(exp, l.id)
    expect(exp.phase).toBe('rules')
    for (const r of exp.of('rule')) run(exp, r.id)
    expect(exp.phase).toBe('concave')
    for (const c of exp.of('concave')) run(exp, c.id)
    expect(exp.phase).toBe('convex')
    for (const c of exp.of('convex')) run(exp, c.id)
    expect(exp.phase).toBe('table')
  })

  it('will not skip ahead, and will not act without a prediction', () => {
    const { exp } = setup()
    expect(() => exp.predict('rule1', { outcome: 'a' }, 2, 1000)).toThrow(StateError)
    expect(() => exp.predict('concave_at_c', { position: 'at_c', size: 'same_size', nature: 'real', orientation: 'inverted' }, 2, 1000)).toThrow(/rules|surfaces|laser/i)
    expect(() => exp.act(serve(Object.assign(exp, {}), 'smooth'))).toThrow()
  })

  it('keeps the laws between the surfaces and the ray rules, and emits law events', () => {
    const { exp, events } = setup()
    run(exp, 'smooth')
    run(exp, 'rough')
    expect(() => exp.predict('rule1', { outcome: 'a' }, 2, 1000)).toThrow(/laws/i)
    run(exp, 'law_angle')
    expect(events.filter((e) => e.object.action === 'predict_law')).toHaveLength(1)
    expect(events.find((e) => e.object.action === 'fire_law')!.object.data).toMatchObject({ tool: 'law', sample: 1 })
  })

  it('needs a complete prediction and only one open prediction at a time', () => {
    const { exp } = setup()
    expect(() => exp.predict('smooth', {}, 2, 1000)).toThrow(/expect/i)
    exp.predict('smooth', { outcome: 'a' }, 3, 2500)
    expect(() => exp.predict('rough', { outcome: 'b' }, 3, 2500)).toThrow(/first/i)
  })

  it('emits predicted, acted and a matching test_result, paired by sample and tool', () => {
    const { exp, events } = setup()
    run(exp, 'smooth', true, false)
    expect(events.map((e) => [e.verb, e.object.action])).toEqual([
      [XapiVerb.PREDICTED, 'predict_surface'],
      [XapiVerb.ACTED, 'fire_laser'],
      [XapiVerb.OBSERVED, 'test_result'],
    ])
    expect(events[0].object.data).toMatchObject({ sample: 1, tool: 'plane', confidence: 2, decisionMs: 3000 })
    expect(events[2].object.data).toMatchObject({ sample: 1, tool: 'plane', match: true })
  })

  it('numbers concave and convex cases separately so their keys never collide', () => {
    const { exp, events } = setup()
    runAll(exp)
    const keys = events.filter((e) => e.verb === XapiVerb.PREDICTED).map((e) => `${(e.object.data as any).sample}:${(e.object.data as any).tool}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('1:convex')
    expect(keys).toContain('6:concave')
  })
})

describe('the table and the anomaly', () => {
  it('starts as the first prediction and records revisions after the reveal', () => {
    const { exp, events } = setup()
    for (const t of exp.items.slice(0, 9)) run(exp, t.id)
    run(exp, 'concave_infinity')
    run(exp, 'concave_beyond_c')
    run(exp, 'concave_at_c')
    run(exp, 'concave_between_c_f')
    // The student predicts "at F" for the candle at F: wrong, because the image forms at infinity.
    exp.predict('concave_at_f', { position: 'at_f', size: 'highly_enlarged', nature: 'real', orientation: 'inverted' }, 3, 4000)
    const r = serve(exp, 'concave_at_f')
    exp.act(r)
    expect(r.match).toBe(false)
    expect(r.anomaly).toBe(true)
    expect(exp.table.concave_at_f?.position).toBe('at_f')
    exp.noticeAnomaly('concave_at_f')
    exp.noticeAnomaly('concave_at_f')
    expect(events.filter((e) => e.verb === XapiVerb.NOTICED_ANOMALY)).toHaveLength(1)
    exp.setCell('concave_at_f', 'position', 'at_infinity')
    expect(exp.table.concave_at_f?.position).toBe('at_infinity')
    expect(exp.revisions).toBe(1)
    expect(events.filter((e) => e.verb === XapiVerb.REVISED_MODEL)[0].object.data).toMatchObject({ id: 'concave_at_f', field: 'position', from: 'at_f', to: 'at_infinity' })
    exp.setCell('concave_at_f', 'position', 'at_infinity')
    expect(exp.revisions).toBe(1)
  })

  it('refuses to flag an anomaly where there is none, and to edit a row that has not been run', () => {
    const { exp } = setup()
    run(exp, 'smooth')
    expect(() => exp.noticeAnomaly('smooth')).toThrow(StateError)
    expect(() => exp.setCell('concave_at_c', 'size', 'enlarged')).toThrow(StateError)
  })

  it('asks for an explanation of every surface, law and ray, but of an image only when it was wrong', () => {
    const { exp } = setup()
    const smooth = run(exp, 'smooth', true, false)
    expect(exp.needsExplanation(smooth)).toBe(true)
    expect(exp.canPredict('rough').ok).toBe(false)
    expect(exp.canPredict('rough').reason).toMatch(/Explain/)
    expect(exp.phase).toBe('plane')
    exp.explained('smooth', 'I saw the five beams leave side by side on the mirror', META)
    expect(exp.canPredict('rough').ok).toBe(true)
  })

  it('will not send an explanation that is too short, or before the run', () => {
    const { exp, events } = setup()
    expect(() => exp.explainPayload('smooth', 'a long enough explanation of what I saw here', META)).toThrow(/Run it first/)
    run(exp, 'smooth', true, false)
    expect(() => exp.explainPayload('smooth', 'too short', META)).toThrow(/at least 8 words/)
    const body = exp.explainPayload('smooth', 'The five beams left the mirror side by side and stayed parallel', { ...META, pasted: 12, blurs: 1 })
    expect(body).toMatchObject({ kind: 'plane', id: 'smooth', inputMode: 'typed', pasted: 12, blurs: 1, thinkMs: 3000 })
    exp.explained('smooth', body.text, { ...META, pasted: 12, blurs: 1 })
    const ev = events.at(-1)!
    expect(ev.verb).toBe(XapiVerb.EXPLAINED)
    expect(ev.object.data).toMatchObject({ words: 12, inputMode: 'typed', pasted: 12, blurs: 1, tool: 'plane', sample: 1 })
  })

  it('a spoken explanation is reported as spoken, with how long it took', () => {
    const { exp, events } = setup()
    run(exp, 'smooth', true, false)
    exp.explained('smooth', 'I aimed the laser and watched the five beams bounce away together', { inputMode: 'voice', speakMs: 7400, pasted: 0, blurs: 0 })
    expect(events.at(-1)!.object.data).toMatchObject({ inputMode: 'voice', speakMs: 7400 })
  })

  it('locks in only when everything is run and the table is complete, then reveals', () => {
    const { exp, events } = setup()
    expect(exp.canSubmit).toBe(false)
    expect(() => exp.submissionPayload()).toThrow(StateError)
    runAll(exp)
    expect(exp.canSubmit).toBe(true)
    const payload = exp.submissionPayload()
    expect(Object.keys(payload.table)).toHaveLength(8)
    const reveal = { planeCorrect: 2, planeTotal: 2, lawsCorrect: 3, lawsTotal: 3, laws: [], rulesCorrect: 4, rulesTotal: 4, tableCorrect: 8, tableTotal: 8, cases: [], uses: [] } as OpticsReveal
    const s = exp.finish(reveal)
    expect(exp.phase).toBe('reveal')
    expect(s.tableCorrect).toBe(8)
    expect(events.at(-1)!.object.action).toBe('submit_analysis')
    expect(() => exp.setCell('concave_at_c', 'size', 'enlarged')).toThrow(/locked/)
  })
})
