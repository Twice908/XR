import { askReasoning } from '../lab/reasoningDialog'
import { sendReasoning } from '../services/reasoningApi'
import { wordsIn } from '../lab/voiceBox'
import { XapiVerb } from '@mmaxr/schema'
import type { MaterialKind, MetalsLessonContract } from '@mmaxr/schema'
import { go } from '../router'
import { CoachClient, loadMode } from '../services/aiCoach'
import type { LabSession } from '../services/session'
import { revealMetals, runMetalsTest } from '../services/metalsApi'
import { sensorTracker } from '../services/sensorTracker'
import { telemetry } from '../services/telemetry'
import { CoachPanel } from '../lab/coachPanel'
import { buildMetalsSnapshot, say } from '../lab/metalsCoach'
import { MetalsHud, type MetalsHudHandlers } from '../lab/metalsHud'
import { MetalsScene } from '../lab/metalsScene'
import { MetalsExperiment, StateError } from '../state/metals'
import { toast } from '../ui/components'

interface Ctx {
  root: HTMLElement
  canvas: HTMLCanvasElement
  status: HTMLElement
  session: LabSession
  lesson: MetalsLessonContract
  isDestroyed: () => boolean
}

/** Runs the Metals & Non-Metals lab. Returns a cleanup function. */
export async function startMetalsLab(ctx: Ctx): Promise<() => void> {
  const { root, canvas, status, session, lesson } = ctx
  const exp = new MetalsExperiment(lesson, (verb, object, at) => telemetry.emit(verb, object, at))
  let busy = false
  let submitting = false
  let reasoned = false
  let coach: CoachClient | null = null
  let idleTimer: number | null = null
  let hud: MetalsHud | null = null
  let scene: MetalsScene | null = null

  const outcomeLabel = (tool: string, id: string) => exp.tool(tool)?.outcomes.find((o) => o.id === id)?.label ?? id

  const defaultHint = () => {
    if (exp.phase === 'hypothesis') {
      const done = exp.samples.filter((s) => s.hypothesis).length
      return { text: `Click each sample and give your first impression: metal or non-metal? (${done} of ${exp.samples.length})`, action: null as { label: string; run: () => void } | null }
    }
    if (exp.phase === 'testing') {
      if (exp.pending) return { text: 'Prediction locked. Run the test when you are ready.', action: { label: 'Run test', run: () => void run() } }
      if (exp.canSubmit) return { text: 'Every sample has a call and enough tests. Ready to see what they really were?', action: { label: 'Submit & reveal', run: () => void submit() } }
      return { text: `Pick a test, then click a sample. ${exp.remaining} run${exp.remaining === 1 ? '' : 's'} left. ${exp.submitBlocker ?? ''}`, action: null }
    }
    return { text: 'Experiment complete. Orbit the bench to review it.', action: null }
  }

  const refresh = (hint?: { text: string; action?: { label: string; run: () => void } | null }) => {
    scene!.setActiveTool(exp.phase === 'testing' ? exp.activeTool : null)
    hud!.update()
    const d = hint ?? defaultHint()
    hud!.hint(d.text, d.action ?? null)
  }

  const guard = <T,>(fn: () => T): T | undefined => {
    try {
      return fn()
    } catch (err) {
      toast(err instanceof StateError ? err.message : (err as Error).message, 'error')
      hud?.update()
      return undefined
    }
  }

  const run = async () => {
    if (busy || !exp.pending) return
    busy = true
    const p = exp.pending
    hud!.hint('Running the test…', null)
    const clickedAt = Date.now()
    let server: Awaited<ReturnType<typeof runMetalsTest>>
    try {
      server = await runMetalsTest(session, p.sample + 1, p.tool)
    } catch (err) {
      busy = false
      toast((err as Error).message, 'error')
      refresh()
      return
    }
    const r = guard(() => exp.act({ outcome: server.outcome, litmus: server.litmus }, clickedAt))
    if (!r) {
      busy = false
      return
    }
    await scene!.play(r.tool, r.sample, { outcome: r.actual, litmus: r.litmus })
    busy = false
    const tool = exp.tool(r.tool)!
    if (!r.match) coach?.event('prediction_mismatch', say.mismatch(r.sample + 1, tool.property, outcomeLabel(r.tool, r.predicted), outcomeLabel(r.tool, r.actual)), buildMetalsSnapshot(exp))
    else if (exp.remaining === 3) coach?.event('ph_unlocked', say.budgetLow, buildMetalsSnapshot(exp))
    refresh({
      text: `${tool.property} of sample ${r.sample + 1}: ${outcomeLabel(r.tool, r.actual)}${r.match ? '' : ' (not what you predicted: think about why)'}. Write it in your notebook.`,
    })
    hud!.openNotebook()
  }

  const onSample = async (i: number) => {
    if (busy) return
    if (exp.phase === 'hypothesis') {
      scene!.focusSample(i)
      const ans = await hud!.promptHypothesis(i)
      scene!.focusSample(null)
      if (!ans || ctx.isDestroyed()) return
      if (!guard(() => (exp.setHypothesis(i, ans.kind, ans.confidence), true))) return
      scene!.setConclusion(i, ans.kind)
      const started = exp.allClassified
      refresh(started ? { text: 'Impressions locked in. Now test them: pick a test, then click a sample. Every run is a prediction first.' } : undefined)
      if (started) hud!.openNotebook()
      return
    }
    const gate = exp.canTest(i)
    if (!gate.ok) {
      hud!.hint(gate.reason ?? 'You cannot test that right now.', exp.pending ? { label: 'Run test', run: () => void run() } : null)
      return
    }
    const tool = exp.tool(exp.activeTool!)!
    scene!.focusSample(i)
    const ans = await hud!.promptPrediction({ sample: i, tool })
    scene!.focusSample(null)
    if (!ans || ctx.isDestroyed()) return
    if (!guard(() => exp.predict(i, ans.outcome, ans.confidence, ans.decisionMs))) return
    refresh()
  }

  scene = new MetalsScene(canvas, {
    onSampleClick: (i) => void onSample(i),
    onToolClick: (id) => {
      if (busy) return
      if (exp.pending && exp.pending.tool === id) return void run()
      if (exp.phase !== 'testing') return hud!.hint('First give every sample a first impression. Then pick a test.', null)
      if (!exp.selectTool(id)) return hud!.hint('Run the test you started first.', null)
      refresh()
    },
  })

  const handlers: MetalsHudHandlers = {
    onBack: () => go('/experiments'),
    onSelectTool: (id) => {
      exp.selectTool(id)
      refresh()
    },
    onSampleOpen: (i) => void onSample(i),
    onRecord: (sample, tool, value) => {
      const ok = guard(() => (exp.recordObservation(sample, tool, value), true))
      hud!.update()
      if (ok && value) {
        hud!.hint(`Saved. Test another sample, or reconsider what sample ${sample + 1} is.`, null)
        hud!.closeNotebookSoon()
      }
    },
    onRecordLitmus: (sample, value) => {
      const ok = guard(() => (exp.recordLitmus(sample, value), true))
      hud!.update()
      if (ok && value) hud!.closeNotebookSoon()
    },
    onConclusion: (sample, kind) => {
      if (!kind) return hud!.update()
      const prior = exp.samples[sample].conclusion
      const tests = exp.testsOn(sample)
      const ok = guard(() => (exp.setConclusion(sample, kind), true))
      if (!ok) return
      scene!.setConclusion(sample, kind)
      hud!.closeNotebookSoon()
      if (prior && prior !== kind && tests > 0) coach?.event('revision', say.revision(sample + 1, prior, kind), buildMetalsSnapshot(exp))
      refresh()
      if (exp.canSubmit) coach?.event('ready_to_submit', say.ready, buildMetalsSnapshot(exp))
    },
    onLayout: (insets) => scene?.setInsets(insets),
    onSubmit: () => void submit(),
  }

  const submit = async () => {
    if (submitting || !exp.canSubmit) {
      if (!exp.canSubmit) toast(exp.submitBlocker ?? 'Not ready to submit yet.', 'error')
      return
    }
    submitting = true
    try {
      if (!reasoned) {
        const why = await askReasoning({ title: 'Explain your conclusions', description: 'Before you see what the samples really were, tell us how you decided metal or non-metal for each. Speak it or type it.' })
        if (!why) return
        await sendReasoning(session, why)
        telemetry.emit(XapiVerb.EXPLAINED, { action: 'explain_conclusions', data: { words: wordsIn(why.text), inputMode: why.inputMode, speakMs: why.speakMs } })
        reasoned = true
      }
      const payload = guard(() => exp.submissionPayload())
      if (!payload) return
      hud!.hint('Submitting your analysis…', null)
      const truth = await revealMetals(session, payload)
      const summary = exp.finish(truth)
      truth.forEach((t) => scene!.revealLabel(t.sample - 1, t.name))
      refresh()
      hud!.showReveal(summary, () => go('/experiments'), () => scene!.focusSample(null))
      coach?.reveal(buildMetalsSnapshot(exp))
    } catch (err) {
      toast((err as Error).message, 'error')
      refresh()
    } finally {
      submitting = false
    }
  }

  hud = new MetalsHud(exp, handlers, lesson.title)
  root.appendChild(hud.root)

  // ---- AI coach ----
  const client = new CoachClient()
  coach = client
  const panel: CoachPanel = new CoachPanel({
    initialMode: loadMode(),
    setOpen: (open) => hud!.setPanelOpen(panel.el, open),
    onAsk: (text) => {
      client.ask(text, buildMetalsSnapshot(exp))
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'ask_coach', data: { length: text.length } })
    },
    onMode: (mode) => {
      client.setMode(mode)
      telemetry.emit(XapiVerb.INVESTIGATED, { action: 'coach_mode', value: mode })
    },
  })
  hud.attachPanel(panel.el, panel.toggle, (open) => panel.setOpenState(open), panel.bubble)
  let info: { provider?: string; configured?: boolean } = {}
  client.onStatus((s) => panel.setStatus(s, info))
  client.onMessage((m) => {
    if (m.type === 'ready') {
      info = { provider: m.provider, configured: m.configured }
      panel.setStatus('online', info)
    } else if (m.type === 'thinking') panel.setThinking(true)
    else if (m.type === 'coach') {
      panel.addCoach(m.text, m.reason, m.degraded)
      if (m.reason === 'wrapup') hud!.setPanelOpen(panel.el, true)
    } else if (m.type === 'coach_off' || m.type === 'error') panel.setThinking(false)
  })
  client.connect({ sessionId: session.sessionId, studentId: session.studentId, token: session.token }, { lessonId: lesson.lessonId, title: lesson.title, labType: lesson.type, summary: lesson.summary })
  let lastActive = Date.now()
  root.addEventListener('pointerdown', () => (lastActive = Date.now()))
  idleTimer = window.setInterval(() => {
    if (exp.phase !== 'reveal' && Date.now() - lastActive > 75_000) {
      lastActive = Date.now()
      client.event('idle', say.idle, buildMetalsSnapshot(exp))
    }
  }, 10_000)

  await scene.load(lesson, (done, total) => {
    status.querySelector('p')!.textContent = `Preparing your lab… ${done}/${total}`
  })
  if (ctx.isDestroyed()) {
    cleanup()
    return () => {}
  }
  scene.start()
  sensorTracker.start(session, () => scene!.head, () => scene!.hand)
  status.remove()
  refresh()
  ;(window as unknown as Record<string, unknown>).__mmaxr = { exp, scene, telemetry, lesson, handlers }

  function cleanup() {
    if (idleTimer !== null) window.clearInterval(idleTimer)
    coach?.disconnect()
    hud?.destroy()
    scene?.dispose()
  }
  return cleanup
}

export type { MaterialKind }
