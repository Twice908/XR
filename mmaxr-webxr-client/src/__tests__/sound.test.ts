import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { XapiVerb } from '@mmaxr/schema'
import type { SoundLessonContract, SoundTrialResult, TelemetryEvent } from '@mmaxr/schema'
import { SoundExperiment, StateError } from '../state/sound'
import { SIZE, scanImage } from '../lab/soundScan'

// The raw lesson has the same shape as the one the browser gets (just with variants and answers still in it).
const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../mmaxr-platform/services/lesson-loader/data/physics-sound.json'), 'utf8')) as SoundLessonContract

function setup() {
  const events: { verb: XapiVerb; object: TelemetryEvent['object'] }[] = []
  let t = 1000
  const exp = new SoundExperiment(lesson, (verb, object) => events.push({ verb, object }), () => (t += 800))
  return { exp, events }
}
const META = { inputMode: 'typed' as const, speakMs: 0, pasted: 0, blurs: 0 }
const result = (id: string, match: boolean, hasCalc = false, anomaly = false): SoundTrialResult & { hasCalc: boolean } => ({ id, match, hasCalc, anomaly: anomaly || undefined, data: {} })
const runTask = (exp: SoundExperiment, id: string, match = true, hasCalc = false) => {
  exp.predict(id, 'a', 2, 3000)
  return exp.act(result(id, match, hasCalc, id === 'wave_1' && !match))
}
const finish = (exp: SoundExperiment, id: string, hasCalc = false) => {
  if (hasCalc) exp.calcResult(id, { ok: true, attempts: 1, value: 600 }, 600)
  exp.explained(id, 'I set it up and watched what the instrument showed me', META, { ok: true, words: 10, reveal: { explanation: 'x', facts: {} } })
}

describe('SoundExperiment', () => {
  it('lists the tasks tab by tab, with pairing keys that never collide', () => {
    const { exp } = setup()
    expect(exp.items.map((t) => t.tab)).toEqual(['wave', 'wave', 'echo', 'echo', 'sonar', 'sonar'])
    const keys = exp.items.map((t) => `${t.sample}:${t.tab}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('emits predicted, acted and a matching test_result', () => {
    const { exp, events } = setup()
    runTask(exp, 'wave_2')
    expect(events.map((e) => [e.verb, e.object.action])).toEqual([[XapiVerb.PREDICTED, 'predict_sound'], [XapiVerb.ACTED, 'run_task'], [XapiVerb.OBSERVED, 'test_result']])
    expect(events[0].object.data).toMatchObject({ tool: 'wave', confidence: 2, decisionMs: 3000 })
    expect(events[2].object.data).toMatchObject({ match: true })
  })

  it('blocks every new task until the last run is calculated (where asked) and explained', () => {
    const { exp } = setup()
    runTask(exp, 'sonar_1', true, true)
    expect(exp.canPredict('wave_1').ok).toBe(false)
    expect(exp.canPredict('wave_1').reason).toMatch(/Finish your last run/)
    expect(() => exp.explainPayload('sonar_1', 'I sent the pulse and read the timer before working it out', META)).toThrow(/calculation/)
    exp.calcResult('sonar_1', { ok: false, attempts: 1 }, 1200)
    expect(exp.trial('sonar_1').calc.ok).toBe(false)
    exp.calcResult('sonar_1', { ok: true, attempts: 2, value: 600 }, 600)
    expect(exp.trial('sonar_1').calc).toMatchObject({ ok: true, attempts: 2, value: 600 })
    expect(exp.canPredict('wave_1').ok).toBe(false)
    finish(exp, 'sonar_1')
    expect(exp.canPredict('wave_1').ok).toBe(true)
  })

  it('asks for a real explanation and keeps the answer hidden until it is accepted', () => {
    const { exp, events } = setup()
    runTask(exp, 'wave_2')
    expect(exp.trial('wave_2').reveal).toBeNull()
    expect(() => exp.explainPayload('wave_2', 'too short', META)).toThrow(/at least 8 words/)
    const body = exp.explainPayload('wave_2', 'I raised it to five millimetres and the trace grew taller on the screen', { ...META, pasted: 5, blurs: 1 })
    expect(body).toMatchObject({ id: 'wave_2', inputMode: 'typed', pasted: 5, blurs: 1, thinkMs: 3000 })
    exp.explained('wave_2', body.text, META, { ok: true, words: 14, reveal: { explanation: 'Loudness increases.', facts: {} } })
    expect(exp.trial('wave_2').reveal?.explanation).toBe('Loudness increases.')
    expect(events.at(-1)!.object.action).toBe('explain')
  })

  it('flags the frequency anomaly only where there is one, once', () => {
    const { exp, events } = setup()
    runTask(exp, 'wave_1', false)
    exp.noticeAnomaly('wave_1')
    exp.noticeAnomaly('wave_1')
    expect(events.filter((e) => e.verb === XapiVerb.NOTICED_ANOMALY)).toHaveLength(1)
    const { exp: e2 } = setup()
    runTask(e2, 'wave_2')
    expect(() => e2.noticeAnomaly('wave_2')).toThrow(StateError)
  })

  it('can be finished only when every task is complete', () => {
    const { exp } = setup()
    expect(exp.canSubmit).toBe(false)
    for (const t of exp.items) {
      const hasCalc = t.id === 'sonar_1'
      runTask(exp, t.id, true, hasCalc)
      finish(exp, t.id, hasCalc)
    }
    expect(exp.phase).toBe('finish')
    expect(exp.canSubmit).toBe(true)
    const s = exp.finish({ tasks: [], correct: 6, total: 6, calcAttempts: 1, uses: [] })
    expect(s.correct).toBe(6)
    expect(exp.phase).toBe('reveal')
  })
})

describe('the ultrasound scan', () => {
  const image = (lambdaMm: number) => scanImage({ lambdaMm, label: '' }, 5, 17)
  /** How much the picture varies: a sharp image has edges, a blur is nearly flat. */
  const contrast = (px: Uint8ClampedArray) => {
    let min = 255
    let max = 0
    for (let i = 1; i < px.length; i += 4) {
      min = Math.min(min, px[i])
      max = Math.max(max, px[i])
    }
    return max - min
  }
  const edges = (px: Uint8ClampedArray) => {
    let e = 0
    for (let y = 0; y < SIZE; y += 2) for (let x = 1; x < SIZE; x += 2) e += Math.abs(px[(y * SIZE + x) * 4 + 1] - px[(y * SIZE + x - 1) * 4 + 1])
    return e
  }
  it('is sharp for a short wavelength and a smear for a long one', () => {
    const ultra = image(0.31)
    const audible = image(343)
    expect(edges(ultra)).toBeGreaterThan(edges(audible) * 8)
    expect(contrast(ultra)).toBeGreaterThan(150)
  })
})
